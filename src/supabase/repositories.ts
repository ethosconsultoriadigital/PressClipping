/**
 * Repositorios: acceso tipado a las tablas de Supabase.
 *
 * Concentran todo el SQL/PostgREST para que los scripts (sync, crawl, …) no
 * hablen directamente con el cliente. Las firmas devuelven datos planos.
 */
import { getSupabase } from './client.js';
import type { Medio, Cliente, Keyword, ConfigRow } from '../types/schemas.js';
import type { NoticiaInsert } from '../normalizers/noticia.js';

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
  ultimo_scrapeo: string | null;
}

/** Lee los medios activos para la corrida de ingesta. */
export async function getMediosActivos(): Promise<MedioRow[]> {
  const { data, error } = await getSupabase()
    .from('medios')
    .select(
      'medio_id, nombre_medio, url_base, metodo_extraccion, rss_url, sitemap_url, secciones_urls, requiere_javascript, requiere_proxy, frecuencia_minutos, pais, estado, municipio, ultimo_scrapeo',
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
  if (items.length === 0) return { insertadas: 0, duplicados: 0 };
  const supabase = getSupabase();

  // 1. Dedup dentro del lote por hash_url (conserva el primero).
  const porHash = new Map<string, NoticiaInsert>();
  for (const it of items) {
    if (!porHash.has(it.hash_url)) porHash.set(it.hash_url, it);
  }
  const unicos = [...porHash.values()];

  // 2. ¿Cuáles ya existen en DB?
  const hashes = unicos.map((u) => u.hash_url);
  const { data: existentes, error: selErr } = await supabase
    .from('noticias')
    .select('hash_url')
    .in('hash_url', hashes);
  if (selErr) throw new Error(`Chequeo de duplicados falló: ${selErr.message}`);

  const yaExisten = new Set((existentes ?? []).map((e) => e.hash_url as string));
  const nuevos = unicos.filter((u) => !yaExisten.has(u.hash_url));
  const duplicados = unicos.length - nuevos.length;

  if (nuevos.length === 0) return { insertadas: 0, duplicados };

  // 3. Clustering best-effort por hash_contenido.
  await asignarClusters(nuevos);

  // 4. Insertar (ignora colisiones por si hubo carrera con otra corrida).
  const { error: insErr } = await supabase
    .from('noticias')
    .upsert(nuevos, { onConflict: 'hash_url', ignoreDuplicates: true });
  if (insErr) throw new Error(`Inserción de noticias falló: ${insErr.message}`);

  return { insertadas: nuevos.length, duplicados };
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
