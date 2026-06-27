/**
 * Repositorios: acceso tipado a las tablas de Supabase.
 *
 * Concentran todo el SQL/PostgREST para que los scripts (sync, crawl, …) no
 * hablen directamente con el cliente. Las firmas devuelven datos planos.
 */
import { getSupabase } from './client.js';
import type { Medio, Cliente, Keyword, ConfigRow } from '../types/schemas.js';
import type { NoticiaInsert } from '../normalizers/noticia.js';
import {
  clasificarIngesta,
  construirUpdatePromocion,
  type ExistenteNoticia,
  type PromocionUpdate,
} from '../crawlers/promocion.js';
import { childLogger } from '../utils/logger.js';
import {
  type MencionExportRow,
  SELECT_MENCION_EXPORT,
  mapMencionExport,
} from '../types/mencion.js';
import {
  type NoticiaRawRow,
  SELECT_NOTICIA_RAW,
  mapNoticiaRaw,
} from '../types/noticia.js';
import type {
  NoticiaEnriquecibleRow,
  NoticiaEnriquecidaUpdate,
} from '../enrichers/enrichNews.js';

export type { MencionExportRow } from '../types/mencion.js';
export type { NoticiaRawRow } from '../types/noticia.js';

const CHUNK = 500;

async function upsertChunked<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  onConflict: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  const supabase = getSupabase();
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from(table)
      .upsert(slice as never[], { onConflict });
    if (error) {
      throw new Error(`Upsert en "${table}" falló: ${error.message}`);
    }
    written += slice.length;
  }
  return written;
}

export const upsertMedios = (rows: Medio[]) =>
  upsertChunked('medios', rows, 'medio_id');

export const upsertClientes = (rows: Cliente[]) =>
  upsertChunked('clientes', rows, 'cliente_id');

export const upsertKeywords = (rows: Keyword[]) =>
  upsertChunked('keywords', rows, 'keyword_id');

export const upsertConfiguracion = (rows: ConfigRow[]) =>
  upsertChunked('configuracion', rows, 'clave');

// --- Lectura ----------------------------------------------------------------

/** Lee toda la configuración como un mapa clave→valor. */
export async function getConfigMap(): Promise<Record<string, string>> {
  const { data, error } = await getSupabase()
    .from('configuracion')
    .select('clave, valor');
  if (error) throw new Error(`No se pudo leer configuracion: ${error.message}`);
  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.clave != null) map[row.clave as string] = (row.valor as string) ?? '';
  }
  return map;
}

export interface MedioRow {
  medio_id: string;
  nombre_medio: string;
  url_base: string | null;
  metodo_extraccion: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  secciones_urls: string | null;
  requiere_javascript: boolean;
  requiere_proxy: boolean;
  frecuencia_minutos: number | null;
  pais: string | null;
  estado: string | null;
  municipio: string | null;
  region: string | null;
  prioridad: string | null;
  ultimo_estado: string | null;
  ultimo_scrapeo: string | null;
}

/** Lee los medios activos para la corrida de ingesta. */
export async function getMediosActivos(): Promise<MedioRow[]> {
  const { data, error } = await getSupabase()
    .from('medios')
    .select(
      'medio_id, nombre_medio, url_base, metodo_extraccion, rss_url, sitemap_url, secciones_urls, requiere_javascript, requiere_proxy, frecuencia_minutos, pais, estado, municipio, region, prioridad, ultimo_estado, ultimo_scrapeo',
    )
    .eq('activo', true);
  if (error) throw new Error(`No se pudieron leer medios activos: ${error.message}`);
  return (data ?? []) as unknown as MedioRow[];
}

/** Actualiza el estado de scraping de un medio tras procesarlo. */
export async function updateMedioEstado(
  medioId: string,
  estado: string,
  error: string | null,
): Promise<void> {
  await getSupabase()
    .from('medios')
    .update({
      ultimo_scrapeo: new Date().toISOString(),
      ultimo_estado: estado,
      ultimo_error: error,
    })
    .eq('medio_id', medioId);
}

// --- Inserción de noticias con deduplicación --------------------------------

export interface IngestResult {
  insertadas: number;
  duplicados: number;
  /** Notas diagnósticas promovidas a orgánicas por redescubrimiento orgánico. */
  promovidas_diagnostico: number;
}

/**
 * Inserta noticias nuevas evitando duplicados exactos por hash_url.
 *
 * Estrategia (ver docs/operations.md y la sección 16 del brief):
 *  1. Dedup dentro del lote por hash_url.
 *  2. Filtra las que ya existen en DB (duplicado exacto → no se inserta).
 *  3. Asigna cluster_id best-effort por hash_contenido para agrupar
 *     republicaciones SIN borrar impactos (cada medio conserva su fila).
 *  4. Inserta el resto.
 */
export async function ingestNoticias(
  items: NoticiaInsert[],
): Promise<IngestResult> {
  if (items.length === 0) {
    return { insertadas: 0, duplicados: 0, promovidas_diagnostico: 0 };
  }
  const supabase = getSupabase();

  // 1. Dedup dentro del lote por hash_url (conserva el primero).
  const porHash = new Map<string, NoticiaInsert>();
  for (const it of items) {
    if (!porHash.has(it.hash_url)) porHash.set(it.hash_url, it);
  }
  const unicos = [...porHash.values()];

  // 2. ¿Cuáles ya existen en DB? Traemos también origen_cobertura/medio_id para
  //    poder promover notas diagnósticas redescubiertas orgánicamente.
  const hashes = unicos.map((u) => u.hash_url);
  const { data: existentes, error: selErr } = await supabase
    .from('noticias')
    .select('hash_url, origen_cobertura, medio_id, fecha_publicacion, titulo')
    .in('hash_url', hashes);
  if (selErr) throw new Error(`Chequeo de duplicados falló: ${selErr.message}`);

  const mapaExistentes = new Map<string, ExistenteNoticia>(
    (existentes ?? []).map((e: any) => [
      e.hash_url as string,
      {
        hash_url: e.hash_url as string,
        origen_cobertura: (e.origen_cobertura as string | null) ?? null,
        medio_id: (e.medio_id as string | null) ?? null,
        fecha_publicacion: (e.fecha_publicacion as string | null) ?? null,
        titulo: (e.titulo as string | null) ?? null,
      },
    ]),
  );

  // 3. Clasificar: nuevas vs promociones vs duplicados (lógica pura).
  const { nuevas, promociones, duplicados } = clasificarIngesta(unicos, mapaExistentes);

  // 4. Promover notas diagnósticas redescubiertas por fuente orgánica.
  const promovidas = await promoverDiagnosticos(promociones);

  if (nuevas.length === 0) {
    return { insertadas: 0, duplicados, promovidas_diagnostico: promovidas };
  }

  // 5. Clustering best-effort por hash_contenido.
  await asignarClusters(nuevas);

  // 6. Insertar (ignora colisiones por si hubo carrera con otra corrida).
  const { error: insErr } = await supabase
    .from('noticias')
    .upsert(nuevas, { onConflict: 'hash_url', ignoreDuplicates: true });
  if (insErr) throw new Error(`Inserción de noticias falló: ${insErr.message}`);

  return { insertadas: nuevas.length, duplicados, promovidas_diagnostico: promovidas };
}

/**
 * Aplica las promociones diagnóstico → orgánico en DB.
 *
 * Por cada nota promovida actualiza origen_cobertura, fuente_extraccion,
 * medio_id (al orgánico actual) y reactiva la detección de menciones
 * (`menciones_procesado = false`). NO toca url/url_canonica/created_at ni
 * `fuente_comparativo_url`. La nota de auditoría (`notas_cobertura`) es
 * best-effort: si la columna no existe aún (migración 0013 sin aplicar) se
 * omite sin romper la corrida. `updated_at` lo mantiene el trigger.
 */
async function promoverDiagnosticos(
  promociones: PromocionUpdate[],
): Promise<number> {
  if (promociones.length === 0) return 0;
  const supabase = getSupabase();
  const log = childLogger({ accion: 'promocion_diagnostico' });
  let promovidas = 0;

  const NOTA =
    'Promovida de diagnóstico PressClipping a orgánica por redescubrimiento en fuente RSS/SITEMAP.';

  for (const p of promociones) {
    const baseUpdate = {
      ...construirUpdatePromocion(p),
      updated_at: new Date().toISOString(),
    };

    // Intento con nota de auditoría; si la columna no existe, reintento sin ella.
    let { error } = await supabase
      .from('noticias')
      .update({ ...baseUpdate, notas_cobertura: NOTA })
      .eq('hash_url', p.hash_url)
      .eq('origen_cobertura', 'pressclipping_diagnostico'); // guarda anti-carrera

    if (error && /notas_cobertura/.test(error.message)) {
      ({ error } = await supabase
        .from('noticias')
        .update(baseUpdate)
        .eq('hash_url', p.hash_url)
        .eq('origen_cobertura', 'pressclipping_diagnostico'));
    }

    if (error) {
      log.warn({ hash_url: p.hash_url, err: error.message }, 'No se pudo promover nota diagnóstica');
      continue;
    }
    promovidas += 1;
  }

  if (promovidas > 0) {
    log.info({ promovidas }, 'Notas diagnósticas promovidas a orgánicas');
  }
  return promovidas;
}

/**
 * Asigna cluster_id a noticias nuevas que comparten hash_contenido con notas
 * ya almacenadas (republicaciones/sindicaciones), o entre sí dentro del lote.
 * Muta `nuevos` en sitio. Es best-effort: si algo falla, se inserta sin cluster.
 */
async function asignarClusters(nuevos: NoticiaInsert[]): Promise<void> {
  const supabase = getSupabase();
  const conHash = nuevos.filter((n) => n.hash_contenido);
  if (conHash.length === 0) return;

  const hashes = [...new Set(conHash.map((n) => n.hash_contenido as string))];

  // Notas existentes que comparten contenido: reutilizamos su cluster.
  const { data: existentes, error } = await supabase
    .from('noticias')
    .select('hash_contenido, cluster_id')
    .in('hash_contenido', hashes);
  if (error) return; // best-effort

  const clusterPorHash = new Map<string, string>();
  const existeEnDb = new Set<string>();
  for (const row of existentes ?? []) {
    const h = row.hash_contenido as string | null;
    if (!h) continue;
    existeEnDb.add(h);
    if (row.cluster_id && !clusterPorHash.has(h)) {
      clusterPorHash.set(h, row.cluster_id as string);
    }
  }

  // Conteo dentro del lote por hash.
  const conteoLote = new Map<string, number>();
  for (const n of conHash) {
    const h = n.hash_contenido as string;
    conteoLote.set(h, (conteoLote.get(h) ?? 0) + 1);
  }

  for (const hash of hashes) {
    let clusterId = clusterPorHash.get(hash);
    const hayRepublicacion =
      existeEnDb.has(hash) || (conteoLote.get(hash) ?? 0) > 1;

    // Solo creamos cluster cuando hay más de un impacto del mismo contenido.
    if (!clusterId && hayRepublicacion) {
      const rep = conHash.find((n) => n.hash_contenido === hash);
      const { data: created, error: cErr } = await supabase
        .from('clusters')
        .insert({
          hash_contenido: hash,
          titulo_representante: rep?.titulo ?? null,
        })
        .select('cluster_id')
        .single();
      if (cErr || !created) continue; // best-effort
      clusterId = created.cluster_id as string;

      // Si ya había notas en DB con ese contenido sin cluster, las vinculamos.
      if (existeEnDb.has(hash)) {
        await supabase
          .from('noticias')
          .update({ cluster_id: clusterId })
          .eq('hash_contenido', hash)
          .is('cluster_id', null);
      }
    }

    if (clusterId) {
      for (const n of conHash) {
        if (n.hash_contenido === hash) n.cluster_id = clusterId;
      }
    }
  }
}

// =============================================================================
// Fase 4 — Detección de menciones
// =============================================================================

export interface KeywordActivaRow {
  keyword_id: string;
  cliente_id: string | null;
  keyword: string;
  alias_o_variantes: string | null;
  tipo_keyword: string;
  regla: string | null;
  contexto_incluir: string | null;
  contexto_excluir: string | null;
  alerta: boolean;
}

/** Lee las keywords activas para la detección. */
export async function getKeywordsActivas(): Promise<KeywordActivaRow[]> {
  const { data, error } = await getSupabase()
    .from('keywords')
    .select(
      'keyword_id, cliente_id, keyword, alias_o_variantes, tipo_keyword, regla, contexto_incluir, contexto_excluir, alerta',
    )
    .eq('activa', true);
  if (error) throw new Error(`No se pudieron leer keywords activas: ${error.message}`);
  return (data ?? []) as unknown as KeywordActivaRow[];
}

export interface NoticiaScanRow {
  noticia_id: string;
  medio_id: string | null;
  titulo: string | null;
  subtitulo: string | null;
  resumen: string | null;
  texto_extraido: string | null;
  /** Cuerpo limpio sin nav/promo/relacionados. Preferido sobre texto_extraido. */
  texto_nota_limpia: string | null;
  /** Cuerpo puro sin encabezado editorial (autor, fecha). Preferido para IA/menciones. */
  texto_cuerpo_nota: string | null;
  seccion: string | null;
  medio_nombre: string | null;
}

export interface NoticiasPendientesOpts {
  /** Limitar el lote. */
  limit: number;
  /**
   * Solo noticias que ya tienen texto_cuerpo_nota.
   * Útil cuando el backlog tiene muchas noticias sin enriquecer y queremos
   * procesar primero las que ya tienen texto, sin marcar las demás.
   */
  onlyWithText?: boolean;
  /**
   * Excluir notas diagnósticas (origen_cobertura=pressclipping_diagnostico).
   * Por defecto NO se filtran aquí; el caller decide. Las notas diagnósticas
   * provienen de URLs de PressClipping y NO deben generar cobertura orgánica.
   */
  excludeDiagnostic?: boolean;
}

/** Lee noticias aún no analizadas para menciones (las pendientes). */
export async function getNoticiasPendientes(
  limitOrOpts: number | NoticiasPendientesOpts,
): Promise<NoticiaScanRow[]> {
  const opts: NoticiasPendientesOpts =
    typeof limitOrOpts === 'number' ? { limit: limitOrOpts } : limitOrOpts;

  let query = getSupabase()
    .from('noticias')
    .select(
      'noticia_id, medio_id, titulo, subtitulo, resumen, texto_extraido,' +
      ' texto_nota_limpia, texto_cuerpo_nota, seccion, medios(nombre_medio)',
    )
    .eq('menciones_procesado', false)
    .order('created_at', { ascending: true })
    .limit(opts.limit);

  if (opts.onlyWithText) {
    query = query.not('texto_cuerpo_nota', 'is', null);
  }

  if (opts.excludeDiagnostic) {
    query = query.neq('origen_cobertura', 'pressclipping_diagnostico');
  }

  const { data, error } = await query;
  if (error) throw new Error(`No se pudieron leer noticias pendientes: ${error.message}`);

  return (data ?? []).map((row: any) => ({
    noticia_id: row.noticia_id,
    medio_id: row.medio_id,
    titulo: row.titulo,
    subtitulo: row.subtitulo,
    resumen: row.resumen,
    texto_extraido: row.texto_extraido,
    texto_nota_limpia: row.texto_nota_limpia ?? null,
    texto_cuerpo_nota: row.texto_cuerpo_nota ?? null,
    seccion: row.seccion,
    medio_nombre: row.medios?.nombre_medio ?? null,
  }));
}

export interface MencionInsert {
  noticia_id: string;
  cliente_id: string | null;
  keyword_id: string;
  keyword: string;
  texto_match: string | null;
  tipo_match: string;
  score_relevancia: number | null;
  requiere_alerta: boolean;
  estado_revision: string;
}

/** Inserta menciones evitando duplicados (UNIQUE noticia_id, keyword_id). */
export async function insertMenciones(rows: MencionInsert[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { error } = await getSupabase()
    .from('menciones')
    .upsert(rows as never[], { onConflict: 'noticia_id,keyword_id', ignoreDuplicates: true });
  if (error) throw new Error(`Inserción de menciones falló: ${error.message}`);
  return rows.length;
}

/** Marca noticias como ya analizadas para menciones. */
export async function markNoticiasProcesadas(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await getSupabase()
    .from('noticias')
    .update({ menciones_procesado: true })
    .in('noticia_id', ids);
  if (error) throw new Error(`No se pudo marcar noticias procesadas: ${error.message}`);
}

// =============================================================================
// Fase 5 — Exportación a Sheets
// =============================================================================

/** Lee menciones aún no exportadas a 06_Resultados, con datos de la noticia. */
export async function getMencionesPendientesExport(limit: number): Promise<MencionExportRow[]> {
  const { data, error } = await getSupabase()
    .from('menciones')
    .select(SELECT_MENCION_EXPORT)
    .eq('exportado_sheets', false)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`No se pudieron leer menciones a exportar: ${error.message}`);
  return (data ?? []).map(mapMencionExport);
}

/** Marca menciones como ya exportadas a la pestaña de resultados. */
export async function markMencionesExportadas(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await getSupabase()
    .from('menciones')
    .update({ exportado_sheets: true })
    .in('mencion_id', ids);
  if (error) throw new Error(`No se pudo marcar menciones exportadas: ${error.message}`);
}

export interface LogExportRow {
  log_id: string;
  fecha_hora: string;
  fuente_id: string | null;
  medio_id: string | null;
  accion: string | null;
  nivel: string | null;
  mensaje: string | null;
  urls_detectadas: number | null;
  notas_nuevas: number | null;
  duplicados: number | null;
  errores: number | null;
  duracion_ms: number | null;
  ejecutado_por: string | null;
}

/**
 * Lee menciones para generar XML. No filtra por exportación (el XML es una
 * vista que puede regenerarse). Los filtros finos se aplican en memoria
 * (ver src/exporters/xml.ts) para mantener la consulta simple y verificable.
 */
export async function getMencionesParaXml(limit: number): Promise<MencionExportRow[]> {
  const { data, error } = await getSupabase()
    .from('menciones')
    .select(SELECT_MENCION_EXPORT)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`No se pudieron leer menciones para XML: ${error.message}`);
  return (data ?? []).map(mapMencionExport);
}

/** Marca menciones como exportadas a XML. */
export async function markMencionesExportadasXml(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await getSupabase()
    .from('menciones')
    .update({ exportado_xml: true })
    .in('mencion_id', ids);
  if (error) throw new Error(`No se pudo marcar menciones exportadas a XML: ${error.message}`);
}

/** Lee logs aún no volcados a 05_Logs. */
export async function getLogsPendientesExport(limit: number): Promise<LogExportRow[]> {
  const { data, error } = await getSupabase()
    .from('logs_ingesta')
    .select(
      'log_id, fecha_hora, fuente_id, medio_id, accion, nivel, mensaje, urls_detectadas, notas_nuevas, duplicados, errores, duracion_ms, ejecutado_por',
    )
    .eq('exportado_sheets', false)
    .order('fecha_hora', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`No se pudieron leer logs a exportar: ${error.message}`);
  return (data ?? []) as unknown as LogExportRow[];
}

/** Marca logs como ya volcados a la pestaña de logs. */
export async function markLogsExportados(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await getSupabase()
    .from('logs_ingesta')
    .update({ exportado_sheets: true })
    .in('log_id', ids);
  if (error) throw new Error(`No se pudo marcar logs exportados: ${error.message}`);
}

// =============================================================================
// Exportación RAW de noticias → 01_Noticias_Raw (base amplia de captura)
// =============================================================================

export interface RawExportOpts {
  limit?: number;
  /** Fecha ISO; filtra noticias capturadas (created_at) desde ese momento. */
  since?: string;
  /** Si true (default), solo trae las aún no exportadas a raw. */
  onlyNew?: boolean;
}

/**
 * Lee noticias para exportar a 01_Noticias_Raw. Por defecto solo las que
 * aún no se han exportado (exportado_sheet_raw = false). Incluye TODAS las
 * noticias del rango, tengan o no mención.
 */
export async function getNoticiasParaExportRaw(
  opts: RawExportOpts = {},
): Promise<NoticiaRawRow[]> {
  let query = getSupabase()
    .from('noticias')
    .select(SELECT_NOTICIA_RAW)
    .order('created_at', { ascending: true });

  if (opts.onlyNew !== false) {
    query = query.eq('exportado_sheet_raw', false);
  }
  if (opts.since) {
    query = query.gte('created_at', opts.since);
  }
  if (opts.limit && opts.limit > 0) {
    query = query.limit(opts.limit);
  }

  const { data, error } = await query;
  if (error) throw new Error(`No se pudieron leer noticias para export raw: ${error.message}`);
  return (data ?? []).map(mapNoticiaRaw);
}

/** Marca noticias como ya exportadas a 01_Noticias_Raw (anti-duplicado). */
export async function markNoticiasExportadasRaw(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await getSupabase()
    .from('noticias')
    .update({
      exportado_sheet_raw: true,
      fecha_exportado_sheet_raw: new Date().toISOString(),
    })
    .in('noticia_id', ids);
  if (error) throw new Error(`No se pudo marcar noticias exportadas raw: ${error.message}`);
}

// =============================================================================
// Enriquecimiento de noticias (visita la URL y completa campos faltantes)
// =============================================================================

export interface EnriquecerOpts {
  limit?: number;
  /** Solo noticias con titulo IS NULL. */
  onlyMissingTitle?: boolean;
  /** Solo noticias con texto_extraido IS NULL. */
  onlyMissingText?: boolean;
  /** Solo noticias con texto_nota_limpia IS NULL. */
  onlyMissingCleanText?: boolean;
  /** Solo noticias con texto_nota_limpia lleno pero texto_cuerpo_nota IS NULL. */
  onlyMissingBodyText?: boolean;
  /** Solo noticias con menciones_procesado = false (pendientes de detección). */
  onlyPendingMentions?: boolean;
}

/**
 * Lee noticias candidatas a enriquecer (visitar su URL y completar campos).
 * Por defecto trae todas; con los flags filtra por campo faltante.
 */
export async function getNoticiasParaEnriquecer(
  opts: EnriquecerOpts = {},
): Promise<NoticiaEnriquecibleRow[]> {
  let query = getSupabase()
    .from('noticias')
    .select(
      'noticia_id, url_original, titulo, resumen, texto_extraido, autor, seccion, imagen_principal,' +
      ' texto_nota_limpia, extracto_nota_1300, calidad_extraccion, texto_limpio_chars,' +
      ' texto_cuerpo_nota, extracto_cuerpo_1300, cuerpo_nota_chars, tipo_nota',
    )
    .order('created_at', { ascending: true });

  if (opts.onlyMissingTitle) query = query.is('titulo', null);
  if (opts.onlyMissingText) query = query.is('texto_extraido', null);
  if (opts.onlyMissingCleanText) query = query.is('texto_nota_limpia', null);
  if (opts.onlyMissingBodyText) {
    query = query
      .not('texto_nota_limpia', 'is', null)
      .is('texto_cuerpo_nota', null);
  }
  if (opts.onlyPendingMentions) {
    query = query.eq('menciones_procesado', false);
  }
  if (opts.limit && opts.limit > 0) query = query.limit(opts.limit);

  const { data, error } = await query;
  if (error) throw new Error(`No se pudieron leer noticias para enriquecer: ${error.message}`);
  return (data ?? []) as unknown as NoticiaEnriquecibleRow[];
}

/**
 * Actualiza los campos enriquecidos de una noticia. NO toca exportado_sheet_raw
 * ni menciones_procesado: solo completa metadata/contenido de la fila.
 */
export async function updateNoticiaEnriquecida(
  noticiaId: string,
  fields: NoticiaEnriquecidaUpdate,
): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  const { error } = await getSupabase()
    .from('noticias')
    .update(fields)
    .eq('noticia_id', noticiaId);
  if (error) {
    throw new Error(`No se pudo enriquecer la noticia ${noticiaId}: ${error.message}`);
  }
}

// =============================================================================
// Fase 7 — Clasificación con IA
// =============================================================================

export interface MencionIaRow {
  mencion_id: string;
  keyword: string | null;
  alerta_keyword: boolean;
  titulo: string | null;
  resumen: string | null;
  medio: string | null;
  cliente: string | null;
  industria: string | null;
  marcas: string | null;
  competidores: string | null;
  temas_sensibles: string | null;
  prioridad_ia: string | null;
}

/**
 * Lee menciones aún no clasificadas por IA, con el contexto de noticia y
 * cliente. Si `soloPrioridadAlta`, filtra a clientes con prioridad_ia alta.
 */
export async function getMencionesParaIa(
  limit: number,
  soloPrioridadAlta = false,
): Promise<MencionIaRow[]> {
  const { data, error } = await getSupabase()
    .from('menciones')
    .select(
      `mencion_id, keyword,
       keywords(alerta),
       clientes(nombre_cliente, industria, marcas, competidores, temas_sensibles, prioridad_ia),
       noticias!inner(titulo, resumen, medios(nombre_medio))`,
    )
    .eq('ia_procesado', false)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`No se pudieron leer menciones para IA: ${error.message}`);

  const rows: MencionIaRow[] = (data ?? []).map((m: any) => ({
    mencion_id: m.mencion_id,
    keyword: m.keyword ?? null,
    alerta_keyword: m.keywords?.alerta ?? false,
    titulo: m.noticias?.titulo ?? null,
    resumen: m.noticias?.resumen ?? null,
    medio: m.noticias?.medios?.nombre_medio ?? null,
    cliente: m.clientes?.nombre_cliente ?? null,
    industria: m.clientes?.industria ?? null,
    marcas: m.clientes?.marcas ?? null,
    competidores: m.clientes?.competidores ?? null,
    temas_sensibles: m.clientes?.temas_sensibles ?? null,
    prioridad_ia: m.clientes?.prioridad_ia ?? null,
  }));

  if (!soloPrioridadAlta) return rows;
  return rows.filter((r) => ['alta', 'high'].includes((r.prioridad_ia ?? '').toLowerCase()));
}

export interface MencionIaUpdate {
  sentimiento: string;
  relevancia_ia: string;
  tema: string;
  subtema: string;
  resumen_ia: string;
  riesgo_reputacional: string;
  recomendacion_pr: string;
  requiere_alerta: boolean;
  ia_modelo: string;
}

/** Guarda la clasificación de IA en una mención y la marca como procesada. */
export async function updateMencionIa(
  mencionId: string,
  fields: MencionIaUpdate,
): Promise<void> {
  const { error } = await getSupabase()
    .from('menciones')
    .update({
      ...fields,
      ia_procesado: true,
      ia_procesado_at: new Date().toISOString(),
    })
    .eq('mencion_id', mencionId);
  if (error) throw new Error(`No se pudo actualizar la mención ${mencionId}: ${error.message}`);
}
