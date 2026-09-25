/**
 * Lane TITLE_ONLY. No usa cuerpo y nunca marca menciones_procesado.
 *
 *   npm run detect-title-only -- --dry-run --hours=48 --limit=500
 */
import { getKeywordsActivas, getNoticiasTitleOnly, insertMenciones } from '../src/supabase/repositories.js';
import { splitTerminos, type KeywordRule, type TipoKeyword } from '../src/matchers/keyword.js';
import { evaluarTitleOnly, TITLE_ONLY_CLIENTES, TITLE_ONLY_TIPOS } from '../src/matching/titleOnlyLane.js';
import { logger } from '../src/utils/logger.js';
import { pathToFileURL } from 'node:url';

const TIPOS_VALIDOS: TipoKeyword[] = ['exacta', 'frase_exacta', 'contiene', 'booleana', 'exacta_contextual'];

export interface TitleOnlyArgs {
  dryRun: boolean;
  hours: number;
  limit: number;
}

export function parseTitleOnlyArgs(argv: string[]): TitleOnlyArgs {
  const out: TitleOnlyArgs = { dryRun: false, hours: 48, limit: 500 };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'dry-run') out.dryRun = true;
    if (key === 'hours') out.hours = Number(val) || 48;
    if (key === 'limit') out.limit = Number(val) || 500;
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
  const cutoffIso = new Date(Date.now() - args.hours * 3600e3).toISOString();
  const keywords = await getKeywordsActivas();
  const reglas = keywords
    .map(aRegla)
    .filter((r) => TITLE_ONLY_CLIENTES.includes(r.cliente_id as (typeof TITLE_ONLY_CLIENTES)[number]))
    .filter((r) => TITLE_ONLY_TIPOS.includes(r.tipo));

  const noticias = await getNoticiasTitleOnly({ limit: args.limit, cutoffIso });
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

  if (!args.dryRun && menciones.length > 0) {
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
