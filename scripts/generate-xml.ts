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
import { randomUUID } from 'node:crypto';
import {
  getMencionesParaXml,
  markMencionesExportadasXml,
} from '../src/supabase/repositories.js';
import { generarXml, aplicarFiltros, type FiltrosXml } from '../src/exporters/xml.js';
import { OUTPUT_TABS } from '../src/sheets/client.js';
import { appendOutputRows } from '../src/sheets/write.js';
import {
  xmlExportToOutputRow,
  resumenInclusion,
} from '../src/exporters/sheetRows.js';
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

  // Registro best-effort en 03_XML_Export. NUNCA debe tumbar la generación del
  // XML: si no hay Sheets de salida o la pestaña no existe, solo se avisa.
  await registrarEnSheet(rows, filtros, out, total, marcar);

  logger.info(
    { notas: total, archivo: out, consideradas: rows.length },
    'XML generado correctamente.',
  );
}

/** Anexa una fila de bitácora a 03_XML_Export sin romper la corrida si falla. */
async function registrarEnSheet(
  rows: Awaited<ReturnType<typeof getMencionesParaXml>>,
  filtros: FiltrosXml,
  out: string,
  total: number,
  marcar: boolean,
): Promise<void> {
  try {
    const { clientes, keywords } = resumenInclusion(aplicarFiltros(rows, filtros));
    const fila = xmlExportToOutputRow({
      xmlId: randomUUID(),
      fechaGeneracion: new Date().toISOString(),
      archivoXml: out.split(/[/\\]/).pop() ?? out,
      rutaOUrl: out,
      totalMenciones: total,
      clientesIncluidos: clientes,
      keywordsIncluidas: keywords,
      desdeFecha: filtros.desde ?? null,
      hastaFecha: filtros.hasta ?? null,
      marcadoExportadoXml: marcar,
      estatus: 'ok',
      notas: filtros.cliente || filtros.keyword || filtros.medio ? 'con filtros' : null,
    });
    const escritas = await appendOutputRows(OUTPUT_TABS.XML_EXPORT, [fila]);
    logger.info({ escritas }, 'Registro de XML añadido a 03_XML_Export');
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'No se pudo registrar en 03_XML_Export (se continúa; XML ya generado)',
    );
  }
}

main().catch((err) => {
  logger.error(err, 'Error fatal en generate-xml.');
  process.exit(1);
});
