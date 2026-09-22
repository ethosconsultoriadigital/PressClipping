/**
 * Mention Lab V1 — orquestación de retrieval paginado + matching.
 * Solo lectura de News Lake / keywords / clientes. Las escrituras a Sheets
 * (tabs LAB) las hace el CLI, nunca `menciones`.
 */
import { getSupabase } from '../supabase/client.js';
import { retryPostgrest, describeSupabaseError, hintForSupabaseError } from '../supabase/errors.js';
import {
  LAB_CLIENT_IDS,
  PAGE_SIZE_DEFAULT,
  SAFETY_LIMIT_DEFAULT,
  extraerTerminosBusquedaLab,
  emptyCandidateIndex,
  ingestCandidates,
  toKeywordRule,
  consolidateClient,
  completenessOf,
  escapeIlikeTerm,
  freezeWindow,
  type LabClientId,
  type LabKeywordRow,
  type LabNewsRow,
  type ClientCompleteness,
  type ConsolidatedMention,
  type RetrievedTerm,
  type CandidateIndex,
} from './mentionLabCore.js';

export interface PageQuery {
  term: string;
  modo: 'fts' | 'ilike';
  afterId: string | null;
  pageSize: number;
  windowStart: string;
  cutoff: string;
}

export type PageFetcher = (q: PageQuery) => Promise<LabNewsRow[]>;

const SELECT_LAB =
  'noticia_id, medio_id, titulo, subtitulo, resumen, autor, seccion,' +
  ' url_original, url_canonica, created_at, fecha_publicacion, texto_extraido,' +
  ' texto_nota_limpia, texto_cuerpo_nota, calidad_extraccion, texto_limpio_chars,' +
  ' cuerpo_nota_chars, tipo_nota, fuente_extraccion,' +
  ' medios(nombre_medio, grupo_medio, region, categoria, pais, estado)';

function mapLabRow(row: any): LabNewsRow {
  const medio = row.medios ?? {};
  return {
    noticia_id: row.noticia_id,
    medio_id: row.medio_id ?? null,
    medio_nombre: medio.nombre_medio ?? null,
    grupo_medio: medio.grupo_medio ?? null,
    region: medio.region ?? null,
    categoria: medio.categoria ?? null,
    pais: medio.pais ?? null,
    estado: medio.estado ?? null,
    fecha_publicacion: row.fecha_publicacion ?? null,
    fecha_captura: row.created_at ?? null,
    created_at: row.created_at ?? null,
    titulo: row.titulo ?? null,
    subtitulo: row.subtitulo ?? null,
    resumen: row.resumen ?? null,
    autor: row.autor ?? null,
    seccion: row.seccion ?? null,
    url_original: row.url_original ?? null,
    url_canonica: row.url_canonica ?? null,
    fuente_extraccion: row.fuente_extraccion ?? null,
    calidad_extraccion: row.calidad_extraccion ?? null,
    texto_limpio_chars: row.texto_limpio_chars ?? null,
    cuerpo_nota_chars: row.cuerpo_nota_chars ?? null,
    tipo_nota: row.tipo_nota ?? null,
    texto_extraido: row.texto_extraido ?? null,
    texto_nota_limpia: row.texto_nota_limpia ?? null,
    texto_cuerpo_nota: row.texto_cuerpo_nota ?? null,
  };
}

export async function fetchLabPage(q: PageQuery): Promise<LabNewsRow[]> {
  let query = getSupabase()
    .from('noticias')
    .select(SELECT_LAB)
    .lte('created_at', q.cutoff)
    .gte('fecha_publicacion', q.windowStart)
    .lte('fecha_publicacion', q.cutoff)
    .order('noticia_id', { ascending: true })
    .limit(q.pageSize);

  if (q.afterId) query = query.gt('noticia_id', q.afterId);

  if (q.modo === 'fts') {
    query = query.textSearch('fts', q.term, { type: 'websearch', config: 'spanish' });
  } else {
    const like = `%${escapeIlikeTerm(q.term)}%`;
    // Metadatos cortos: el OR de 6 columnas (incluye cuerpos) dispara
    // statement timeout 57014 en ventanas de 30d. El FTS ya cubre
    // titulo+subtitulo+resumen+texto_extraido.
    query = query.or(
      [
        `titulo.ilike.${like}`,
        `subtitulo.ilike.${like}`,
        `resumen.ilike.${like}`,
      ].join(','),
    );
  }

  const intentos = q.modo === 'ilike' ? 1 : 2;
  const { data, error } = await retryPostgrest('fetchLabPage', () => query, intentos);
  if (error) {
    throw new Error(
      `News Lake page failed: ${describeSupabaseError(error)}. ${hintForSupabaseError(error)}`,
    );
  }
  return (data ?? []).map(mapLabRow);
}

export async function loadLabClient(clientId: LabClientId): Promise<{
  client_id: LabClientId;
  client_name: string;
  keywords: LabKeywordRow[];
}> {
  const sb = getSupabase();
  const { data: cli, error: cErr } = await sb
    .from('clientes')
    .select('cliente_id, nombre_cliente')
    .eq('cliente_id', clientId)
    .maybeSingle();
  if (cErr) throw new Error(`No se pudo leer cliente ${clientId}: ${cErr.message}`);
  if (!cli) throw new Error(`cliente ${clientId} no existe`);

  const { data: kws, error: kErr } = await sb
    .from('keywords')
    .select(
      'keyword_id, cliente_id, keyword, alias_o_variantes, tipo_keyword, regla, contexto_incluir, contexto_excluir, alerta, prioridad, activa',
    )
    .eq('cliente_id', clientId);
  if (kErr) throw new Error(`No se pudieron leer keywords de ${clientId}: ${kErr.message}`);

  return {
    client_id: clientId,
    client_name: String(cli.nombre_cliente ?? clientId),
    keywords: (kws ?? []) as LabKeywordRow[],
  };
}

export interface RetrieveResult {
  index: CandidateIndex;
  terms: RetrievedTerm[];
  pages: number;
  rawFetched: number;
  safetyHit: boolean;
  infraError: string | null;
}

export async function retrieveCandidatesPaged(
  keywords: LabKeywordRow[],
  window: { cutoff: string; windowStart: string },
  opts: {
    pageSize?: number;
    safetyLimit?: number;
    fetchPage?: PageFetcher;
  } = {},
): Promise<RetrieveResult> {
  const pageSize = opts.pageSize ?? PAGE_SIZE_DEFAULT;
  const safetyLimit = opts.safetyLimit ?? SAFETY_LIMIT_DEFAULT;
  const fetchPage = opts.fetchPage ?? fetchLabPage;
  const terms = extraerTerminosBusquedaLab(keywords);
  const index = emptyCandidateIndex();
  let pages = 0;
  let rawFetched = 0;
  let safetyHit = false;
  let infraError: string | null = null;

  outer: for (const t of terms) {
    let ftsOk = false;
    let ftsRows = 0;
    let afterId: string | null = null;
    for (;;) {
      let rows: LabNewsRow[] = [];
      try {
        rows = await fetchPage({
          term: t.term,
          modo: 'fts',
          afterId,
          pageSize,
          windowStart: window.windowStart,
          cutoff: window.cutoff,
        });
        ftsOk = true;
      } catch {
        break;
      }
      pages += 1;
      rawFetched += rows.length;
      ftsRows += rows.length;
      const r = ingestCandidates(index, rows, t.term, safetyLimit);
      safetyHit = safetyHit || r.safetyHit;
      if (safetyHit) break outer;
      if (rows.length === 0) break;
      afterId = rows[rows.length - 1]!.noticia_id;
      if (rows.length < pageSize) break;
    }

    // ILIKE: fallback de recall (acentos/frases) SOLO si FTS falló o no trajo nada.
    // Correrlo siempre + 6 columnas OR agota el statement timeout de Postgres.
    if (ftsOk && ftsRows > 0) continue;

    afterId = null;
    for (;;) {
      let rows: LabNewsRow[] = [];
      try {
        rows = await fetchPage({
          term: t.term,
          modo: 'ilike',
          afterId,
          pageSize,
          windowStart: window.windowStart,
          cutoff: window.cutoff,
        });
      } catch (err) {
        if (!ftsOk) {
          infraError = err instanceof Error ? err.message : String(err);
          break outer;
        }
        break;
      }
      pages += 1;
      rawFetched += rows.length;
      const r = ingestCandidates(index, rows, t.term, safetyLimit);
      safetyHit = safetyHit || r.safetyHit;
      if (safetyHit) break outer;
      if (rows.length === 0) break;
      afterId = rows[rows.length - 1]!.noticia_id;
      if (rows.length < pageSize) break;
    }
  }

  return { index, terms, pages, rawFetched, safetyHit, infraError };
}

export interface ClientLabOutcome {
  client_id: LabClientId;
  client_name: string;
  keywords: LabKeywordRow[];
  mentions: ConsolidatedMention[];
  metrics: ClientCompleteness;
}

export async function runClientLab(
  clientId: LabClientId,
  cutoffIso: string,
  windowDays: number,
  opts: { pageSize?: number; safetyLimit?: number; fetchPage?: PageFetcher } = {},
): Promise<ClientLabOutcome> {
  const loaded = await loadLabClient(clientId);
  const window = freezeWindow(cutoffIso, windowDays);
  const active = loaded.keywords.filter((k) => k.activa);
  const retrieved = await retrieveCandidatesPaged(active, window, opts);
  const rules = active.map(toKeywordRule);
  const mentions = consolidateClient(clientId, loaded.client_name, retrieved.index, rules);
  const metrics = completenessOf(
    clientId,
    loaded.client_name,
    loaded.keywords,
    retrieved.terms,
    retrieved.pages,
    retrieved.rawFetched,
    retrieved.index,
    mentions,
    retrieved.safetyHit,
    retrieved.infraError,
  );
  return {
    client_id: clientId,
    client_name: loaded.client_name,
    keywords: loaded.keywords,
    mentions,
    metrics,
  };
}

export function defaultLabClients(): LabClientId[] {
  return [...LAB_CLIENT_IDS];
}
