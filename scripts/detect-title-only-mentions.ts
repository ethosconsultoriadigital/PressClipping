/**
 * Lane TITLE_ONLY. No usa cuerpo y nunca marca menciones_procesado.
 *
 * Barrido completo de 48h. --limit se acepta y no recorta el universo.
 *   npm run detect-title-only -- --dry-run --hours=48 --page-size=500 --max-scan=10000
 */
import { getKeywordsActivas, getNoticiasTitleOnly, insertMenciones } from '../src/supabase/repositories.js';
import { splitTerminos, type KeywordRule, type TipoKeyword } from '../src/matchers/keyword.js';
import { evaluarTitleOnly, TITLE_ONLY_CLIENTES, TITLE_ONLY_TIPOS } from '../src/matching/titleOnlyLane.js';
import { puedeInsertarTitleOnly, TITLE_ONLY_MAX_SCAN, TITLE_ONLY_PAGE_SIZE } from '../src/matching/titleOnlySweep.js';
import { logger } from '../src/utils/logger.js';
import { pathToFileURL } from 'node:url';

const TIPOS_VALIDOS: TipoKeyword[] = ['exacta', 'frase_exacta', 'contiene', 'booleana', 'exacta_contextual'];

export interface TitleOnlyArgs {
  dryRun: boolean;
  hours: number;
  pageSize: number;
  maxScan: number;
  /** Compatibilidad. No recorta el barrido; el tope es maxScan. */
  legacyLimit: number | null;
}

export function parseTitleOnlyArgs(argv: string[]): TitleOnlyArgs {
  const out: TitleOnlyArgs = {
    dryRun: false,
    hours: 48,
    pageSize: TITLE_ONLY_PAGE_SIZE,
    maxScan: TITLE_ONLY_MAX_SCAN,
    legacyLimit: null,
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'dry-run') out.dryRun = true;
    if (key === 'hours') out.hours = Number(val) || 48;
    if (key === 'page-size') out.pageSize = Number(val) || TITLE_ONLY_PAGE_SIZE;
    if (key === 'max-scan') out.maxScan = Number(val) || TITLE_ONLY_MAX_SCAN;
    if (key === 'limit') out.legacyLimit = Number(val) || null;
  }
  return out;
}

function aRegla(row: {
  keyword_id: string;
  cliente_id: string | null;
  keyword: string;
  alias_o_variantes: string | null;
  tipo_keyword: string;
  regla: string | null;
  contexto_incluir: string | null;
  contexto_excluir: string | null;
}): KeywordRule {
  const tipo = (TIPOS_VALIDOS as string[]).includes(row.tipo_keyword)
    ? (row.tipo_keyword as TipoKeyword)
    : 'contiene';
  return {
    keyword_id: row.keyword_id,
    cliente_id: row.cliente_id,
    keyword: row.keyword,
    terminos: splitTerminos(row.keyword, row.alias_o_variantes),
    tipo,
    regla: row.regla,
    contextoIncluir: splitTerminos(row.contexto_incluir),
    contextoExcluir: splitTerminos(row.contexto_excluir),
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const args = parseTitleOnlyArgs(argv);
  const started = Date.now();
  const cutoffIso = new Date(Date.now() - args.hours * 3600e3).toISOString();
  const keywords = await getKeywordsActivas();
  const reglas = keywords
    .map(aRegla)
    .filter((r) => TITLE_ONLY_CLIENTES.includes(r.cliente_id as (typeof TITLE_ONLY_CLIENTES)[number]))
    .filter((r) => TITLE_ONLY_TIPOS.includes(r.tipo));

  const barrido = await getNoticiasTitleOnly({
    cutoffIso,
    pageSize: args.pageSize,
    maxScanRows: args.maxScan,
  });
  const noticias = barrido.rows;
  const menciones = noticias.flatMap((n) => evaluarTitleOnly(n, reglas));
  const porCliente: Record<string, number> = {};
  const porKeyword: Record<string, number> = {};
  const porCampo: Record<string, number> = { titulo: 0, subtitulo: 0, resumen: 0 };
  for (const m of menciones) {
    const cid = m.cliente_id ?? '(sin_cliente)';
    porCliente[cid] = (porCliente[cid] ?? 0) + 1;
    porKeyword[m.keyword_id] = (porKeyword[m.keyword_id] ?? 0) + 1;
    porCampo[m.field_match] = (porCampo[m.field_match] ?? 0) + 1;
  }

  logger.info(
    {
      source_lane: 'TITLE_ONLY',
      eligible: barrido.eligible,
      scanned: barrido.scanned,
      pages: barrido.pages,
      page_size: barrido.pageSize,
      max_scan: barrido.maxScanRows,
      title_only_truncated: barrido.truncated,
      eligible_over_cap: barrido.eligibleOverCap,
      duration_ms: Date.now() - started,
      legacy_limit_ignored: args.legacyLimit,
      selected: noticias.length,
      keywords: reglas.length,
      menciones_potenciales: menciones.length,
      por_cliente: porCliente,
      por_keyword: porKeyword,
      por_campo: porCampo,
      mark_processed: false,
      dry_run: args.dryRun,
      otros_tipos: 0,
    },
    args.dryRun ? '[dry-run] Title-only lane — no se insertó ni se marcó nada' : 'Title-only lane',
  );

  if (barrido.truncated) {
    logger.error(
      { eligible_over_cap: barrido.eligibleOverCap, scanned: barrido.scanned, max_scan: barrido.maxScanRows },
      'Title-only truncado: no se insertan menciones.',
    );
  }

  if (puedeInsertarTitleOnly({ dryRun: args.dryRun, truncated: barrido.truncated }) && menciones.length > 0) {
    const insertadas = await insertMenciones(
      menciones.map((m) => ({
        noticia_id: m.noticia_id,
        cliente_id: m.cliente_id,
        keyword_id: m.keyword_id,
        keyword: m.keyword,
        texto_match: m.texto_match,
        tipo_match: m.tipo_match,
        score_relevancia: m.score,
        requiere_alerta: false,
        estado_revision: 'pendiente',
      })),
    );
    logger.info({ insertadas, mark_processed: false, source_lane: 'TITLE_ONLY' }, 'Title-only insertadas');
  }
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((err) => {
    logger.error(err, 'Error fatal en detect-title-only-mentions.');
    process.exit(1);
  });
}
