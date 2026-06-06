/**
 * Fase 6 — Generación de XML propio tipo PressClipping.
 *
 * Lee menciones desde Supabase, aplica filtros opcionales y escribe un archivo
 * XML <pressclipping_ethos>. Pensado como base del futuro endpoint /read-xml.
 *
 * Uso:
 *   npm run generate-xml -- [opciones]
 *
 * Opciones (todas opcionales):
 *   --cliente=Jumex
 *   --keyword=tequila
 *   --medio="El Universal"
 *   --region=Occidente
 *   --estado-revision=pendiente
 *   --desde=2026-06-01
 *   --hasta=2026-06-05
 *   --out=output/mi-archivo.xml      (por defecto output/pressclipping-<ts>.xml)
 *   --limit=5000                     (máximo de menciones a considerar)
 *   --marcar                         (marca las menciones incluidas como exportado_xml)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  getMencionesParaXml,
  markMencionesExportadasXml,
} from '../src/supabase/repositories.js';
import { generarXml, type FiltrosXml } from '../src/exporters/xml.js';
import { logger } from '../src/utils/logger.js';

/** Parsea argumentos --clave=valor y --flag (booleano). */
function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq === -1) out[body] = true;
    else out[body.slice(0, eq)] = body.slice(eq + 1);
  }
  return out;
}

function asStr(v: string | boolean | undefined): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const filtros: FiltrosXml = {
    cliente: asStr(args['cliente']),
    keyword: asStr(args['keyword']),
    medio: asStr(args['medio']),
    region: asStr(args['region']),
    estadoRevision: asStr(args['estado-revision']),
    desde: asStr(args['desde']),
    hasta: asStr(args['hasta']),
  };

  const limit = Number.parseInt(asStr(args['limit']) ?? '5000', 10) || 5000;
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const out = asStr(args['out']) ?? `output/pressclipping-${ts}.xml`;
  const marcar = args['marcar'] === true;

  logger.info({ filtros, limit, out }, 'Generando XML…');

  const rows = await getMencionesParaXml(limit);
  const { xml, total, ids } = generarXml(rows, filtros);

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, xml, 'utf8');

  if (marcar && ids.length > 0) {
    await markMencionesExportadasXml(ids);
    logger.info({ marcadas: ids.length }, 'Menciones marcadas como exportado_xml');
  }

  logger.info(
    { notas: total, archivo: out, consideradas: rows.length },
    'XML generado correctamente.',
  );
}

main().catch((err) => {
  logger.error(err, 'Error fatal en generate-xml.');
  process.exit(1);
});
