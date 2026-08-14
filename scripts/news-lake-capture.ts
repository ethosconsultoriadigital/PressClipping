/**
 * News Lake — orquestador de captura general (crawl → enrich) por chunks.
 *
 * NO reimplementa crawl ni enrich: es un orquestador delgado que invoca
 * `scripts/crawl.ts` y `scripts/enrich-news.ts` como subprocesos, exactamente
 * igual que ya hace `scripts/mery-priority-media-capture.ts` para su propio
 * cliente. La diferencia es que este orquestador NO está atado a ningún
 * cliente ni keyword: recorre el catálogo de medios activos en bloques
 * ("chunks") y encadena crawl→enrich por bloque, para que la captura general
 * (noticias limpias, sin filtrar por cliente) avance de forma sistemática en
 * vez de depender de auditorías manuales puntuales.
 *
 * Selección de medios: reutiliza `getMediosActivos()` + `seleccionarMedios()`
 * (la MISMA política conservadora ya usada por `crawl.ts`) — excluye por
 * defecto medios inactivos, `requiere_javascript`, `requiere_proxy` y
 * duplicados. NO se relaja ningún filtro de seguridad aquí.
 *
 * NO detecta menciones (eso sigue siendo trabajo de detect-mentions.ts, por
 * cliente). NO escribe en Google Sheets. NO envía alertas/email/WhatsApp/
 * Twilio/SMTP. NO usa proxy/Playwright/paywall-bypass (la selección ya los
 * excluye). NO exporta resultados, NO genera XML, NO corre classify-ia.
 *
 * Uso:
 *   npm run news-lake:capture -- --dry-run                          # plan, no descarga nada (default)
 *   npm run news-lake:capture -- --max-medios=20 --chunk-size=5
 *   npm run news-lake:capture -- --medio-ids=MED-0001,MED-0002       # dirigido, ignora --max-medios
 *   npm run news-lake:capture -- --max-notas=5 --enrich-limit=20 --window-days=30
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  getMediosActivos,
  getConfigMap,
  type MedioRow,
} from '../src/supabase/repositories.js';
import {
  seleccionarMedios,
  type MedioSeleccionable,
  type DiagnosticoMedio,
} from '../src/crawlers/selection.js';
import { readDiagnosticosMedios } from '../src/validation/diagnosticosSheet.js';
import { chunkArray } from '../src/utils/chunk.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

// ─────────────────────────────────────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────────────────────────────────────

export interface NewsLakeCaptureArgs {
  dryRun: boolean;
  maxMedios: number;
  medioIds?: string[];
  maxNotas: number;
  enrichLimit: number;
  windowDays: number;
  chunkSize: number;
}

function splitList(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

export function parseArgs(argv: string[]): NewsLakeCaptureArgs {
  const out: NewsLakeCaptureArgs = {
    dryRun: true,
    maxMedios: 20,
    maxNotas: 5,
    enrichLimit: 20,
    windowDays: 30,
    chunkSize: 5,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    if (arg === '--no-dry-run') { out.dryRun = false; continue; }
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'dry-run':
        // `--dry-run=false` apaga el modo seguro explícitamente.
        out.dryRun = val === '' ? true : val !== 'false';
        break;
      case 'max-medios':
        out.maxMedios = parseIntOrNull(val) ?? out.maxMedios;
        break;
      case 'medio-ids':
        out.medioIds = splitList(val);
        break;
      case 'max-notas':
        out.maxNotas = parseIntOrNull(val) ?? out.maxNotas;
        break;
      case 'enrich-limit':
        out.enrichLimit = parseIntOrNull(val) ?? out.enrichLimit;
        break;
      case 'window-days':
        out.windowDays = parseIntOrNull(val) ?? out.windowDays;
        break;
      case 'chunk-size':
        out.chunkSize = parseIntOrNull(val) ?? out.chunkSize;
        break;
      default:
        logger.warn({ flag: arg }, 'Flag desconocido ignorado');
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Selección de medios (reutiliza la política conservadora de crawl.ts)
// ─────────────────────────────────────────────────────────────────────────────

function toSeleccionable(m: MedioRow): MedioSeleccionable {
  return {
    medio_id: m.medio_id,
    nombre_medio: m.nombre_medio,
    url_base: m.url_base,
    metodo_extraccion: m.metodo_extraccion,
    rss_url: m.rss_url,
    sitemap_url: m.sitemap_url,
    secciones_urls: m.secciones_urls,
    requiere_javascript: m.requiere_javascript,
    requiere_proxy: m.requiere_proxy,
    prioridad: m.prioridad,
    estado: m.estado,
    region: m.region,
    ultimo_estado: m.ultimo_estado,
    activo: true, // getMediosActivos ya filtra activo = true
  };
}

export interface PlanCaptura {
  medioIds: string[];
  chunks: string[][];
  totalActivos: number;
  totalSeleccionados: number;
  totalExcluidos: number;
  excluidosPorMotivo: Record<string, number>;
  dirigido: boolean;
}

/** Calcula el plan de captura (medios + chunks) sin descargar ni escribir nada. */
export async function calcularPlan(args: NewsLakeCaptureArgs): Promise<PlanCaptura> {
  const medios = await getMediosActivos();

  // Dirigido por --medio-ids: se procesan exactamente esos (si están activos),
  // ignorando --max-medios (igual semántica que crawl.ts).
  if (args.medioIds && args.medioIds.length > 0) {
    const set = new Set(args.medioIds.map((id) => id.trim().toUpperCase()));
    const encontrados = medios.filter((m) => set.has(m.medio_id.toUpperCase()));
    const medioIds = encontrados.map((m) => m.medio_id);
    return {
      medioIds,
      chunks: chunkArray(medioIds, Math.max(1, args.chunkSize)),
      totalActivos: medios.length,
      totalSeleccionados: medioIds.length,
      totalExcluidos: args.medioIds.length - medioIds.length,
      excluidosPorMotivo: medioIds.length < args.medioIds.length
        ? { no_activo_o_no_encontrado: args.medioIds.length - medioIds.length }
        : {},
      dirigido: true,
    };
  }

  // Selección segura general: misma política que crawl.ts (excluye
  // inactivo/JS/proxy/duplicado, y por diagnóstico error/sin_fuente/especial
  // si hay 08_Validacion_Medios disponible).
  let diagnosticos = new Map<string, DiagnosticoMedio>();
  try {
    diagnosticos = await readDiagnosticosMedios();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'No se pudo leer 08_Validacion_Medios; se continúa solo con filtros duros',
    );
  }

  const { incluidos, excluidos } = seleccionarMedios(
    medios.map(toSeleccionable),
    diagnosticos,
    {},
  );

  const seleccion = args.maxMedios > 0 ? incluidos.slice(0, args.maxMedios) : incluidos;
  const medioIds = seleccion.map((d) => d.medio.medio_id);

  const excluidosPorMotivo: Record<string, number> = {};
  for (const d of excluidos) {
    excluidosPorMotivo[d.motivo] = (excluidosPorMotivo[d.motivo] ?? 0) + 1;
  }

  return {
    medioIds,
    chunks: chunkArray(medioIds, Math.max(1, args.chunkSize)),
    totalActivos: medios.length,
    totalSeleccionados: medioIds.length,
    totalExcluidos: excluidos.length,
    excluidosPorMotivo,
    dirigido: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Orquestación (spawn de crawl.ts / enrich-news.ts)
// ─────────────────────────────────────────────────────────────────────────────

function spawnAsync(cmd: string, args: string[]): Promise<{ code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', shell: true });
    child.on('close', (code) => resolve({ code: code ?? 1 }));
    child.on('error', () => resolve({ code: 1 }));
  });
}

export interface ChunkResult {
  chunk: string[];
  crawlCode: number | null;
  enrichCode: number | null;
  ok: boolean;
  error?: string;
}

/** Procesa un chunk: crawl → enrich. Nunca lanza: reporta el error en el resultado. */
export async function procesarChunk(
  chunk: string[],
  args: NewsLakeCaptureArgs,
  index: number,
  total: number,
): Promise<ChunkResult> {
  const medioIdsArg = `--medio-ids=${chunk.join(',')}`;
  logger.info({ chunk, index: index + 1, total }, `[chunk ${index + 1}/${total}] Crawl…`);
  try {
    const crawl = await spawnAsync('npx', [
      'tsx', 'scripts/crawl.ts',
      medioIdsArg,
      `--max-notas=${args.maxNotas}`,
    ]);
    if (crawl.code !== 0) {
      logger.error({ chunk, code: crawl.code }, `[chunk ${index + 1}/${total}] Crawl falló — se omite enrich de este chunk`);
      return { chunk, crawlCode: crawl.code, enrichCode: null, ok: false, error: `crawl exit=${crawl.code}` };
    }

    logger.info({ chunk, index: index + 1, total }, `[chunk ${index + 1}/${total}] Enrich…`);
    const enrich = await spawnAsync('npx', [
      'tsx', 'scripts/enrich-news.ts',
      medioIdsArg,
      `--limit=${args.enrichLimit}`,
      `--window-days=${args.windowDays}`,
      '--recent-first',
      '--only-missing-clean-text',
    ]);
    if (enrich.code !== 0) {
      logger.warn({ chunk, code: enrich.code }, `[chunk ${index + 1}/${total}] Enrich finalizó con código distinto de 0`);
    }

    return { chunk, crawlCode: crawl.code, enrichCode: enrich.code, ok: enrich.code === 0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ chunk, error: msg }, `[chunk ${index + 1}/${total}] Error inesperado — se continúa con el siguiente chunk`);
    return { chunk, crawlCode: null, enrichCode: null, ok: false, error: msg };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  logger.info(
    {
      dry_run: args.dryRun,
      max_medios: args.maxMedios,
      medio_ids: args.medioIds ?? null,
      max_notas: args.maxNotas,
      enrich_limit: args.enrichLimit,
      window_days: args.windowDays,
      chunk_size: args.chunkSize,
    },
    '=== News Lake Capture (crawl → enrich general, sin clientes/keywords) ===',
  );

  // Config best-effort: solo para dejar constancia en el log de la ventana
  // operativa configurada globalmente, si existiera. NUNCA bloquea la corrida.
  try {
    const config = await getConfigMap();
    if (config['news_lake_window_dias']) {
      logger.info(
        { news_lake_window_dias: config['news_lake_window_dias'] },
        'Ventana operativa configurada en `configuracion` (informativo, no se aplica automáticamente aquí)',
      );
    }
  } catch {
    // best-effort: si configuracion no responde, seguimos con el default del flag.
  }

  const plan = await calcularPlan(args);

  logger.info(
    {
      total_activos: plan.totalActivos,
      total_seleccionados: plan.totalSeleccionados,
      total_excluidos: plan.totalExcluidos,
      excluidos_por_motivo: plan.excluidosPorMotivo,
      chunks: plan.chunks.length,
      chunk_size: args.chunkSize,
      dirigido: plan.dirigido,
    },
    'Plan de captura calculado',
  );

  if (plan.medioIds.length === 0) {
    logger.warn({}, 'Ningún medio seleccionado. Nada que hacer.');
    return;
  }

  if (args.dryRun) {
    logger.info({}, '[dry-run] Plan completo (NO se descarga ni se escribe nada):');
    plan.chunks.forEach((chunk, i) => {
      logger.info({ chunk_index: i + 1, medios: chunk }, `[dry-run] Chunk ${i + 1}/${plan.chunks.length}`);
    });
    logger.info(
      {
        total_medios: plan.medioIds.length,
        total_chunks: plan.chunks.length,
        se_ejecutaria_por_chunk: [
          `crawl.ts --medio-ids=<chunk> --max-notas=${args.maxNotas}`,
          `enrich-news.ts --medio-ids=<chunk> --limit=${args.enrichLimit} --window-days=${args.windowDays} --recent-first --only-missing-clean-text`,
        ],
      },
      '[dry-run] Resumen — nada se ejecutó',
    );
    return;
  }

  const resultados: ChunkResult[] = [];
  for (let i = 0; i < plan.chunks.length; i++) {
    const resultado = await procesarChunk(plan.chunks[i]!, args, i, plan.chunks.length);
    resultados.push(resultado);
  }

  const exitosos = resultados.filter((r) => r.ok).length;
  const fallidos = resultados.filter((r) => !r.ok);

  logger.info(
    {
      chunks_totales: resultados.length,
      chunks_ok: exitosos,
      chunks_con_error: fallidos.length,
      medios_procesados: plan.medioIds.length,
      chunks_fallidos: fallidos.map((r) => ({ chunk: r.chunk, error: r.error ?? `enrich exit=${r.enrichCode}` })),
    },
    '=== News Lake Capture completado ===',
  );
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((err) => {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en news-lake-capture');
    process.exit(1);
  });
}

export { main };
