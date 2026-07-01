/**
 * Fase 3 — Ingesta RSS / Sitemap (con selección segura de medios).
 *
 * Lee los medios activos desde Supabase, los filtra con una política
 * conservadora (ver src/crawlers/selection.ts), los recorre (RSS → sitemap),
 * normaliza, deduplica por hash_url e inserta noticias nuevas. Respeta
 * `max_notas_por_medio_por_corrida` y `modo_mvp`, escribe un log por medio y
 * actualiza el estado de scraping.
 *
 * Por DEFECTO NO procesa medios riesgosos: inactivos, duplicados,
 * requiere_javascript/proxy, ni los diagnosticados como error/sin_fuente/especial
 * en 08_Validacion_Medios.
 *
 * Uso:
 *   npm run crawl                                   # selección segura por defecto
 *   npm run crawl -- --dry-run                      # lista qué procesaría, sin descargar
 *   npm run crawl -- --limit=5                      # como máximo 5 medios
 *   npm run crawl -- --priority=Alta                # solo prioridad "Alta"
 *   npm run crawl -- --estado=Jalisco               # por estado/region
 *   npm run crawl -- --solo-validados               # solo ok/parcial de 08_Validacion_Medios
 *   npm run crawl -- --only-status=parcial          # solo cierto diagnóstico (acepta "partial")
 *   npm run crawl -- --only-status=ok,parcial
 *   npm run crawl -- --exclude-status=error,sin_fuente,especial
 *   npm run crawl -- --medio-ids=MED-0001,MED-0029  # solo estos medios (sobrescribe otros filtros)
 *
 * Backfill dirigido por sitemap (requiere --medio-ids; no afecta cron ni crawl normal):
 *   npm run crawl -- --medio-ids=MED-0033,MED-0171 --source=sitemap --max-notas=200 --sitemap-max-subs=40
 *   --source=rss|sitemap|news-sitemap  fuerza la fuente ignorando la cascada RSS→sitemap
 *   --max-notas=N                      tope de notas por medio en esta corrida
 *   --sitemap-max-subs=N               sub-sitemaps a resolver en índices
 *   --sitemap-max-depth=N              profundidad de recursión de índices
 *
 * Los flags se pueden combinar, p.ej.:
 *   npm run crawl -- --dry-run --limit=10 --solo-validados
 */
import {
  getConfigMap,
  getMediosActivos,
  ingestNoticias,
  updateMedioEstado,
  type MedioRow,
} from '../src/supabase/repositories.js';
import { crawlMedio, type CrawlMedioOpts } from '../src/crawlers/index.js';
import {
  seleccionarMedios,
  type CrawlFiltros,
  type MedioSeleccionable,
  type Decision,
  type DiagnosticoMedio,
} from '../src/crawlers/selection.js';
import { readDiagnosticosMedios } from '../src/validation/diagnosticosSheet.js';
import { writeIngestaLog } from '../src/logs/ingestaLogger.js';
import { logger } from '../src/utils/logger.js';
import { parseBool, parseIntOrNull } from '../src/utils/parse.js';

interface CrawlArgs extends CrawlFiltros {
  limit?: number;
  dryRun: boolean;
  medioIds?: string[];
  /** Backfill dirigido: fuerza la fuente (rss|sitemap) ignorando la cascada. */
  source?: 'rss' | 'sitemap';
  /** Presupuesto de sub-sitemaps para índices (solo con --source=sitemap). */
  sitemapMaxSubs?: number;
  /** Profundidad de recursión de índices (solo con --source=sitemap). */
  sitemapMaxDepth?: number;
  /** Sobrescribe el tope de notas por medio (config max_notas_por_medio_por_corrida). */
  maxNotas?: number;
}

function splitList(v: string): string[] {
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parsea flags --clave=valor y banderas (--dry-run, --solo-validados). */
function parseArgs(argv: string[]): CrawlArgs {
  const out: CrawlArgs = { dryRun: false };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const value = eq === -1 ? '' : body.slice(eq + 1);

    switch (key) {
      case 'dry-run':
        out.dryRun = true;
        break;
      case 'solo-validados':
        out.soloValidados = true;
        break;
      case 'limit':
        out.limit = parseIntOrNull(value) ?? undefined;
        break;
      case 'priority':
        out.priority = value || undefined;
        break;
      case 'estado':
        out.estado = value || undefined;
        break;
      case 'only-status':
        out.onlyStatus = splitList(value);
        break;
      case 'exclude-status':
        out.excludeStatus = splitList(value);
        break;
      case 'medio-ids':
        out.medioIds = splitList(value);
        break;
      case 'source':
      case 'prefer-source': {
        // news-sitemap se trata como sitemap (usa sitemap_url del medio).
        const v = value.trim().toLowerCase();
        if (v === 'sitemap' || v === 'news-sitemap') out.source = 'sitemap';
        else if (v === 'rss') out.source = 'rss';
        else logger.warn({ value }, 'Valor --source no reconocido (usa rss|sitemap|news-sitemap)');
        break;
      }
      case 'sitemap-max-subs':
        out.sitemapMaxSubs = parseIntOrNull(value) ?? undefined;
        break;
      case 'sitemap-max-depth':
        out.sitemapMaxDepth = parseIntOrNull(value) ?? undefined;
        break;
      case 'max-notas':
        out.maxNotas = parseIntOrNull(value) ?? undefined;
        break;
      default:
        logger.warn({ flag: arg }, 'Flag desconocido ignorado');
    }
  }
  return out;
}

/** Proyecta una fila de medio al subconjunto que entiende la selección. */
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

/** Imprime el plan de ingesta sin descargar ni guardar nada. */
function imprimirDryRun(seleccion: Decision[], excluidos: Decision[]): void {
  logger.info(
    { aProcesar: seleccion.length, excluidos: excluidos.length },
    '[dry-run] Plan de ingesta (no se descarga ni se guarda nada)',
  );

  for (const d of seleccion) {
    const m = d.medio;
    logger.info(
      {
        medio_id: m.medio_id,
        nombre_medio: m.nombre_medio,
        metodo_extraccion: m.metodo_extraccion,
        url_base: m.url_base,
        rss_url: m.rss_url,
        sitemap_url: m.sitemap_url,
        secciones_urls: m.secciones_urls,
        motivo: d.motivo,
      },
      `[dry-run] INCLUIDO: ${m.nombre_medio}`,
    );
  }

  // Resumen de exclusiones agrupado por motivo (para no inundar la consola).
  const porMotivo = new Map<string, number>();
  for (const d of excluidos) {
    porMotivo.set(d.motivo, (porMotivo.get(d.motivo) ?? 0) + 1);
  }
  if (porMotivo.size > 0) {
    logger.info(
      { exclusiones: Object.fromEntries(porMotivo) },
      '[dry-run] Exclusiones por motivo',
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Salvaguarda: forzar fuente (backfill) solo es válido en crawl dirigido por
  // --medio-ids; nunca sobre el catálogo completo ni el cron.
  if (args.source && !(args.medioIds && args.medioIds.length > 0)) {
    logger.error('--source solo se permite junto con --medio-ids (crawl dirigido). Abortando.');
    process.exit(1);
  }

  const config = await getConfigMap();
  const modoMvp = parseBool(config['modo_mvp'], true);
  const maxNotas =
    args.maxNotas ?? parseIntOrNull(config['max_notas_por_medio_por_corrida']) ?? 25;

  let medios = await getMediosActivos();

  // Si se pasó --medio-ids, filtramos antes de cualquier otra lógica.
  if (args.medioIds && args.medioIds.length > 0) {
    const set = new Set(args.medioIds.map((id) => id.trim().toUpperCase()));
    const antes = medios.length;
    medios = medios.filter((m) => set.has(m.medio_id.toUpperCase()));
    logger.info(
      { medioIds: args.medioIds, encontrados: medios.length, de: antes },
      'Filtro --medio-ids aplicado',
    );
    if (medios.length === 0) {
      logger.warn('Ninguno de los medio_id indicados está activo. Abortando.');
      return;
    }
  }

  // Diagnósticos best-effort: si la pestaña no existe o falla, seguimos con
  // los filtros duros (la selección lo maneja con diagnóstico null).
  let diagnosticos = new Map<string, DiagnosticoMedio>();
  try {
    diagnosticos = await readDiagnosticosMedios();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'No se pudo leer 08_Validacion_Medios; se continúa solo con filtros duros',
    );
  }

  const filtros: CrawlFiltros = {
    priority: args.priority,
    estado: args.estado,
    onlyStatus: args.onlyStatus,
    excludeStatus: args.excludeStatus,
    soloValidados: args.soloValidados,
    // Crawl dirigido: si se pasó --medio-ids, la DB/auditoría actual manda
    // (un diagnóstico histórico viejo no debe bloquear medios READY).
    dirigido: Boolean(args.medioIds && args.medioIds.length > 0),
  };

  const { incluidos, excluidos } = seleccionarMedios(
    medios.map(toSeleccionable),
    diagnosticos,
    filtros,
  );

  const seleccion =
    args.limit && args.limit > 0 ? incluidos.slice(0, args.limit) : incluidos;

  logger.info(
    {
      totalActivos: medios.length,
      conDiagnostico: diagnosticos.size,
      incluidos: incluidos.length,
      excluidos: excluidos.length,
      aProcesar: seleccion.length,
      filtros,
      limite: args.limit ?? null,
      modoMvp,
      maxNotas,
      dryRun: args.dryRun,
    },
    'Selección de medios para ingesta',
  );

  if (args.dryRun) {
    imprimirDryRun(seleccion, excluidos);
    return;
  }

  if (seleccion.length === 0) {
    logger.warn('No hay medios seleccionados con los filtros dados. Nada que procesar.');
    return;
  }

  // Índice para recuperar la fila completa (crawlMedio necesita MedioRow).
  const porId = new Map(medios.map((m) => [m.medio_id, m]));

  let totalNuevas = 0;
  let totalDuplicados = 0;
  let totalErrores = 0;
  let totalPromovidas = 0;

  for (const decision of seleccion) {
    const medio = porId.get(decision.medio.medio_id);
    if (!medio) continue;

    const started = Date.now();
    const crawlOpts: CrawlMedioOpts = {
      forceFuente: args.source,
      sitemapMaxSubs: args.sitemapMaxSubs,
      sitemapMaxDepth: args.sitemapMaxDepth,
    };
    const result = await crawlMedio(medio, maxNotas, crawlOpts);

    let insertadas = 0;
    let duplicados = 0;
    let promovidas = 0;
    let estadoFinal = result.estado as string;
    let errorFinal = result.error;

    if (result.estado === 'ok' && result.items.length > 0) {
      try {
        const ingest = await ingestNoticias(result.items);
        insertadas = ingest.insertadas;
        duplicados = ingest.duplicados;
        promovidas = ingest.promovidas_diagnostico;
        totalNuevas += insertadas;
        totalDuplicados += duplicados;
        totalPromovidas += promovidas;
      } catch (err) {
        estadoFinal = 'error';
        errorFinal = err instanceof Error ? err.message : String(err);
        totalErrores += 1;
      }
    } else if (result.estado === 'error') {
      totalErrores += 1;
    }

    await updateMedioEstado(medio.medio_id, estadoFinal, errorFinal);
    await writeIngestaLog({
      medio_id: medio.medio_id,
      fuente_id: result.fuente,
      accion: 'crawl',
      nivel: estadoFinal === 'error' ? 'error' : 'info',
      mensaje: `${estadoFinal} via ${result.fuente ?? 'n/a'}${errorFinal ? `: ${errorFinal}` : ''}`,
      urls_detectadas: result.urls_detectadas,
      notas_nuevas: insertadas,
      duplicados,
      errores: estadoFinal === 'error' ? 1 : 0,
      duracion_ms: Date.now() - started,
    });

    logger.info(
      { medio_id: medio.medio_id, estado: estadoFinal, insertadas, duplicados, promovidas_diagnostico: promovidas },
      `Medio procesado: ${medio.nombre_medio}`,
    );
  }

  logger.info(
    { procesados: seleccion.length, nuevas: totalNuevas, duplicados: totalDuplicados, promovidas_diagnostico: totalPromovidas, totalErrores },
    'Corrida de ingesta completada.',
  );
}

main().catch((err) => {
  logger.error(err, 'Error fatal en crawl.');
  process.exit(1);
});
