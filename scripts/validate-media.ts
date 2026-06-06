/**
 * validate:media — diagnóstico NO destructivo de los medios.
 *
 * Lee 01_Medios desde la Sheet (NO la modifica), omite inactivos y duplicados,
 * prueba las fuentes de cada medio (RSS/sitemap) SIN guardar noticias, recomienda
 * método de extracción y clasifica medios especiales. Escribe el diagnóstico en
 * 08_Validacion_Medios y los especiales en 09_Medios_Especiales (las crea si no
 * existen). Nunca toca la base histórica ni 01_Medios.
 *
 * Uso:
 *   npm run validate:media
 *   npm run validate:media -- --limit=10
 *   npm run validate:media -- --priority=Alta
 */
import { DateTime } from 'luxon';
import { checkEnv } from '../src/validation/checks.js';
import { readTabRows } from '../src/sheets/read.js';
import { SHEET_TABS } from '../src/sheets/client.js';
import { mapMedioRow } from '../src/types/schemas.js';
import { ensureTab } from '../src/sheets/ensureTab.js';
import { appendRows, type OutRow } from '../src/sheets/write.js';
import { probeMedio } from '../src/validation/probe.js';
import {
  particionarMedios,
  filtrarPorPrioridad,
  recomendarMetodo,
  estadoDiagnostico,
  clasificarMedio,
  type MedioInput,
} from '../src/validation/diagnostics.js';
import { logger } from '../src/utils/logger.js';

const TAB_VALIDACION = '08_Validacion_Medios';
const TAB_ESPECIALES = '09_Medios_Especiales';

const HEADERS_VALIDACION = [
  'medio_id', 'nombre_medio', 'activo', 'prioridad', 'metodo_actual',
  'metodo_recomendado', 'rss_ok', 'rss_items', 'sitemap_ok', 'sitemap_items',
  'estado_diagnostico', 'es_especial', 'motivo', 'fecha_validacion', 'error',
];
const HEADERS_ESPECIALES = [
  'medio_id', 'nombre_medio', 'motivo_especial', 'requiere_javascript',
  'requiere_proxy', 'sugerencia', 'fecha_deteccion',
];

function parseArgs(argv: string[]): { limit?: number; priority?: string } {
  const out: { limit?: number; priority?: string } = {};
  for (const arg of argv) {
    const m = /^--(limit|priority)=(.+)$/.exec(arg);
    if (!m) continue;
    if (m[1] === 'limit') out.limit = Number.parseInt(m[2]!, 10) || undefined;
    else out.priority = m[2];
  }
  return out;
}

async function main() {
  const env = checkEnv();
  if (!env.sheets) {
    const relevantes = env.faltantes.filter((k) => k.startsWith('GOOGLE_'));
    logger.error({ faltantes: relevantes }, 'validate:media requiere credenciales de Sheets.');
    process.exit(1);
  }

  const { limit, priority } = parseArgs(process.argv.slice(2));

  // 1. Leer 01_Medios (solo lectura) y mapear.
  const rows = await readTabRows(SHEET_TABS.MEDIOS);
  const medios: MedioInput[] = [];
  let invalidas = 0;
  for (const r of rows) {
    const res = mapMedioRow(r);
    if (!res.success) { invalidas += 1; continue; }
    const d = res.data;
    medios.push({
      medio_id: d.medio_id,
      nombre_medio: d.nombre_medio,
      activo: d.activo,
      prioridad: d.prioridad,
      metodo_extraccion: d.metodo_extraccion,
      rss_url: d.rss_url,
      sitemap_url: d.sitemap_url,
      secciones_urls: d.secciones_urls,
      buscador_url: d.buscador_url,
      requiere_javascript: d.requiere_javascript,
      requiere_proxy: d.requiere_proxy,
      url_base: d.url_base,
    });
  }

  // 2. Partir en procesables / inactivos / duplicados.
  const part = particionarMedios(medios);
  let objetivo = filtrarPorPrioridad(part.procesables, priority);
  if (limit && limit > 0) objetivo = objetivo.slice(0, limit);

  logger.info(
    {
      total: medios.length,
      invalidas,
      procesables: part.procesables.length,
      inactivos: part.inactivos.length,
      duplicados: part.duplicados.length,
      aDiagnosticar: objetivo.length,
      filtro_prioridad: priority ?? null,
      limite: limit ?? null,
    },
    'Medios leídos y particionados (01_Medios NO se modifica)',
  );

  // 3. Diagnosticar cada medio objetivo (probe sin guardar noticias).
  const filasValidacion: OutRow[] = [];
  const filasEspeciales: OutRow[] = [];
  const ahora = DateTime.utc().toISO() ?? '';

  for (const m of objetivo) {
    const probe = await probeMedio(m);
    const recomendado = recomendarMetodo(m, probe);
    const estado = estadoDiagnostico(probe);
    const clas = clasificarMedio(m, probe);

    filasValidacion.push({
      medio_id: m.medio_id,
      nombre_medio: m.nombre_medio,
      activo: m.activo,
      prioridad: m.prioridad,
      metodo_actual: m.metodo_extraccion,
      metodo_recomendado: recomendado,
      rss_ok: probe.rss_ok,
      rss_items: probe.rss_items,
      sitemap_ok: probe.sitemap_ok,
      sitemap_items: probe.sitemap_items,
      estado_diagnostico: estado,
      es_especial: clas.es_especial,
      motivo: clas.motivo,
      fecha_validacion: ahora,
      error: probe.error,
    });

    if (clas.es_especial) {
      filasEspeciales.push({
        medio_id: m.medio_id,
        nombre_medio: m.nombre_medio,
        motivo_especial: clas.motivo,
        requiere_javascript: m.requiere_javascript,
        requiere_proxy: m.requiere_proxy,
        sugerencia: clas.sugerencia,
        fecha_deteccion: ahora,
      });
    }

    logger.info(
      { medio_id: m.medio_id, recomendado, estado, especial: clas.es_especial },
      `Diagnóstico: ${m.nombre_medio}`,
    );
  }

  // 4. Escribir paneles auxiliares (crea pestañas si faltan; solo anexa).
  await ensureTab(TAB_VALIDACION, HEADERS_VALIDACION);
  const escritasV = await appendRows(TAB_VALIDACION, filasValidacion);

  let escritasE = 0;
  if (filasEspeciales.length > 0) {
    await ensureTab(TAB_ESPECIALES, HEADERS_ESPECIALES);
    escritasE = await appendRows(TAB_ESPECIALES, filasEspeciales);
  }

  logger.info(
    { diagnosticos: escritasV, especiales: escritasE },
    'validate:media completado (sin guardar noticias).',
  );
}

main().catch((err) => {
  logger.error(err, 'Error fatal en validate:media.');
  process.exit(1);
});
