/**
 * Núcleo testeable de detección de menciones (body lane).
 *
 * OPTION A — detector GLOBAL: una noticia se evalúa contra todas las keywords
 * del scope del Control Plane y se marca menciones_procesado a nivel noticia.
 * --client(s) es canary: no marca procesado.
 */
import type { KeywordActivaRow, MencionInsert, NoticiaScanRow } from '../supabase/repositories.js';
import {
  matchKeyword,
  splitTerminos,
  PESOS_CAMPO,
  type KeywordRule,
  type CampoBuscable,
  type TipoKeyword,
} from '../matchers/keyword.js';
import { MENTION_QUEUE_DEFAULTS, type MentionQueueTelemetry } from './mentionQueue.js';
import { buildMentionScope, type MentionScope, type ScopeCliente } from './controlPlaneScope.js';
import { parseIntOrNull } from '../utils/parse.js';
import { buildTrustedMatchingFields, isBodyMatchingV2Enabled } from './trustedBody.js';

const TIPOS_VALIDOS: TipoKeyword[] = [
  'exacta',
  'frase_exacta',
  'contiene',
  'booleana',
  'exacta_contextual',
];

export interface DetectArgs {
  dryRun: boolean;
  limit?: number;
  onlyWithText?: boolean;
  includeDiagnostic?: boolean;
  medioIds?: string[];
  clientIds?: string[];
  maxInserts?: number;
  freshLane?: boolean;
  freshHours?: number;
  freshShare?: number;
}

export interface DetectIo {
  getClientes: () => Promise<ScopeCliente[]>;
  getKeywordsActivas: () => Promise<KeywordActivaRow[]>;
  getCola: (opts: {
    limit: number;
    onlyWithText?: boolean;
    excludeDiagnostic?: boolean;
    medioIds?: string[];
    freshLane?: boolean;
    freshHours?: number;
    freshShare?: number;
    anchor: Date;
  }) => Promise<{ rows: NoticiaScanRow[]; telemetry: MentionQueueTelemetry }>;
  insertMenciones: (rows: MencionInsert[]) => Promise<number>;
  markNoticiasProcesadas: (ids: string[]) => Promise<void>;
}

export interface DetectResult {
  dry_run: boolean;
  writes: number;
  marked_processed: number;
  termination_reason: string;
  scope: MentionScope;
  noticias: number;
  fresh_selected: number;
  backlog_selected: number;
  matches: number;
  inserted: number;
  duplicates_avoided: number;
  matches_by_client: Record<string, number>;
  matches_by_keyword: Record<string, number>;
}

function splitList(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

export function parseDetectArgs(argv: string[]): DetectArgs {
  const out: DetectArgs = { dryRun: false };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const value = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'dry-run') out.dryRun = true;
    if (key === 'only-with-text') out.onlyWithText = true;
    if (key === 'include-diagnostic') out.includeDiagnostic = true;
    if (key === 'limit') out.limit = parseIntOrNull(value) ?? undefined;
    if (key === 'medio-ids') out.medioIds = splitList(value);
    if (key === 'client' && value) out.clientIds = [value];
    if (key === 'clients' && value) out.clientIds = splitList(value);
    if (key === 'max-inserts') out.maxInserts = parseIntOrNull(value) ?? undefined;
    if (key === 'fresh-lane') out.freshLane = true;
    if (key === 'fresh-hours') out.freshHours = Number(value);
    if (key === 'fresh-share') out.freshShare = Number(value);
  }
  return out;
}

export function toKeywordRule(row: KeywordActivaRow): KeywordRule {
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

export function camposDe(n: NoticiaScanRow): CampoBuscable[] {
  if (isBodyMatchingV2Enabled()) {
    const packed = buildTrustedMatchingFields(n, { mode: 'body_high' });
    return [
      ...packed.campos,
      { nombre: 'medio', texto: n.medio_nombre ?? '', peso: PESOS_CAMPO.medio! },
    ];
  }
  const textoEfectivo = n.texto_cuerpo_nota ?? n.texto_nota_limpia ?? n.texto_extraido ?? '';
  return [
    { nombre: 'titulo', texto: n.titulo ?? '', peso: PESOS_CAMPO.titulo! },
    { nombre: 'subtitulo', texto: n.subtitulo ?? '', peso: PESOS_CAMPO.subtitulo! },
    { nombre: 'resumen', texto: n.resumen ?? '', peso: PESOS_CAMPO.resumen! },
    { nombre: 'seccion', texto: n.seccion ?? '', peso: PESOS_CAMPO.seccion! },
    { nombre: 'texto_extraido', texto: textoEfectivo, peso: PESOS_CAMPO.texto_extraido! },
    { nombre: 'medio', texto: n.medio_nombre ?? '', peso: PESOS_CAMPO.medio! },
  ];
}

export function scanNoticiasForMentions(
  noticias: readonly NoticiaScanRow[],
  reglas: readonly KeywordRule[],
  alertaPorKeyword: ReadonlyMap<string, boolean>,
): MencionInsert[] {
  const menciones: MencionInsert[] = [];
  const seen = new Set<string>();
  for (const noticia of noticias) {
    const campos = camposDe(noticia);
    for (const regla of reglas) {
      const res = matchKeyword(regla, campos);
      if (!res) continue;
      const clave = `${noticia.noticia_id}|${regla.keyword_id}`;
      if (seen.has(clave)) continue;
      seen.add(clave);
      menciones.push({
        noticia_id: noticia.noticia_id,
        cliente_id: regla.cliente_id,
        keyword_id: regla.keyword_id,
        keyword: regla.keyword,
        texto_match: res.texto_match,
        tipo_match: res.tipo_match,
        score_relevancia: res.score,
        requiere_alerta: alertaPorKeyword.get(regla.keyword_id) ?? false,
        estado_revision: 'pendiente',
      });
    }
  }
  return menciones;
}

function countBy(rows: readonly MencionInsert[], key: 'cliente_id' | 'keyword_id'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of rows) {
    const id = String(m[key] ?? '(null)');
    out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

export async function runDetectMentions(args: DetectArgs, io: DetectIo, limitDefault = 500): Promise<DetectResult> {
  const limit = args.limit ?? limitDefault;
  const runAnchor = new Date();
  const clientes = await io.getClientes();
  const keywordRows = await io.getKeywordsActivas();
  const scope = buildMentionScope({
    clientes,
    keywords: keywordRows.map((k) => ({
      keyword_id: k.keyword_id,
      cliente_id: k.cliente_id,
      keyword: k.keyword,
      tipo_keyword: k.tipo_keyword,
      activa: true,
    })),
    clientFilter: args.clientIds,
  });

  const empty = (reason: string): DetectResult => ({
    dry_run: args.dryRun,
    writes: 0,
    marked_processed: 0,
    termination_reason: reason,
    scope,
    noticias: 0,
    fresh_selected: 0,
    backlog_selected: 0,
    matches: 0,
    inserted: 0,
    duplicates_avoided: 0,
    matches_by_client: {},
    matches_by_keyword: {},
  });

  if (scope.detection_client_ids.length === 0 || scope.detection_keywords.length === 0) {
    return empty(
      scope.detection_client_ids.length === 0 ? 'NO_ACTIVE_CLIENTS' : 'NO_ELIGIBLE_KEYWORDS',
    );
  }

  const allowedKw = new Set(scope.detection_keywords.map((k) => k.keyword_id));
  const scopedRows = keywordRows.filter((k) => allowedKw.has(k.keyword_id));
  const reglas = scopedRows.map(toKeywordRule);
  const alertaPorKeyword = new Map(scopedRows.map((k) => [k.keyword_id, k.alerta]));

  const cola = await io.getCola({
    limit,
    onlyWithText: args.onlyWithText,
    excludeDiagnostic: !args.includeDiagnostic,
    medioIds: args.medioIds,
    freshLane: args.freshLane,
    freshHours: args.freshLane ? (args.freshHours ?? MENTION_QUEUE_DEFAULTS.freshHours) : undefined,
    freshShare: args.freshLane ? (args.freshShare ?? MENTION_QUEUE_DEFAULTS.freshShare) : undefined,
    anchor: runAnchor,
  });
  const noticias = cola.rows;
  const menciones = scanNoticiasForMentions(noticias, reglas, alertaPorKeyword);
  const matches_by_client = countBy(menciones, 'cliente_id');
  const matches_by_keyword = countBy(menciones, 'keyword_id');

  const filtered = args.clientIds && args.clientIds.length > 0;
  const base = {
    dry_run: args.dryRun,
    writes: 0,
    marked_processed: 0,
    termination_reason: 'OK',
    scope,
    noticias: noticias.length,
    fresh_selected: cola.telemetry.fresh_selected,
    backlog_selected: cola.telemetry.backlog_selected,
    matches: menciones.length,
    inserted: 0,
    duplicates_avoided: 0,
    matches_by_client,
    matches_by_keyword,
  };

  if (args.dryRun) {
    return { ...base, termination_reason: 'DRY_RUN' };
  }

  const mencionesAInsertar = args.maxInserts != null ? menciones.slice(0, args.maxInserts) : menciones;
  let inserted = 0;
  try {
    inserted = await io.insertMenciones(mencionesAInsertar);
  } catch (err) {
    return {
      ...base,
      termination_reason: 'INSERT_FAILED',
      inserted: 0,
    };
  }

  let marked = 0;
  if (!filtered) {
    await io.markNoticiasProcesadas(noticias.map((n) => n.noticia_id));
    marked = noticias.length;
  }

  return {
    ...base,
    writes: inserted,
    marked_processed: marked,
    inserted,
    duplicates_avoided: Math.max(0, mencionesAInsertar.length - inserted),
    termination_reason: filtered ? 'OK_CLIENT_FILTER_NO_MARK' : 'OK',
  };
}

export { MENTION_QUEUE_DEFAULTS };
