/**
 * Núcleo del enriquecimiento de noticias.
 *
 * Visita la URL de cada noticia, extrae campos útiles (título, resumen, texto,
 * imagen, autor, sección) y construye la actualización para Supabase. Las
 * dependencias (lectura, extracción, escritura) se inyectan para poder probar
 * sin red ni DB, igual que `exportRawNews`.
 *
 * Garantías:
 *   - En modo dry-run NO escribe nada (solo arma el plan de cambios).
 *   - Nunca sobrescribe un valor real existente: solo rellena campos vacíos.
 *   - Una nota que falla (red/timeout) NO detiene la corrida (se reporta y se
 *     sigue con la siguiente).
 *   - NO exporta a Sheets, NO toca exportado_sheet_raw, NO corre detección/IA.
 */
import type { FetchExtractResult } from '../extractors/html.js';
import { resolverTitulo, MARCADOR_TITULO_DESDE_URL } from '../extractors/titleFromUrl.js';

/** Fila mínima de `noticias` necesaria para decidir el enriquecimiento. */
export interface NoticiaEnriquecibleRow {
  noticia_id: string;
  url_original: string | null;
  titulo: string | null;
  resumen: string | null;
  texto_extraido: string | null;
  autor: string | null;
  seccion: string | null;
  imagen_principal: string | null;
}

/** Campos que el enriquecimiento puede actualizar en `noticias`. */
export interface NoticiaEnriquecidaUpdate {
  titulo?: string | null;
  resumen?: string | null;
  texto_extraido?: string | null;
  autor?: string | null;
  seccion?: string | null;
  imagen_principal?: string | null;
  estado_extraccion?: string;
  error_extraccion?: string | null;
  notas?: string;
}

export interface EnrichOpts {
  limit?: number;
  onlyMissingTitle?: boolean;
  onlyMissingText?: boolean;
  dryRun: boolean;
  maxChars?: number;
}

export interface EnrichDeps {
  fetchNoticias: (opts: {
    limit?: number;
    onlyMissingTitle?: boolean;
    onlyMissingText?: boolean;
  }) => Promise<NoticiaEnriquecibleRow[]>;
  extract: (url: string) => Promise<FetchExtractResult>;
  updateNoticia: (id: string, fields: NoticiaEnriquecidaUpdate) => Promise<void>;
}

export interface EnrichItemResult {
  noticia_id: string;
  url: string | null;
  ok: boolean;
  error: string | null;
  campos_actualizados: string[];
  marcadores: string[];
  fields: NoticiaEnriquecidaUpdate;
}

export interface EnrichResult {
  leidas: number;
  actualizadas: number;
  sinCambios: number;
  fallidas: number;
  dryRun: boolean;
  detalle: EnrichItemResult[];
}

function vacio(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim().length === 0;
}

/**
 * Decide los cambios para una noticia dado el resultado de extracción.
 * PURA: no escribe nada. Solo rellena campos vacíos y arma los marcadores.
 */
export function construirActualizacion(
  noticia: NoticiaEnriquecibleRow,
  extracto: FetchExtractResult,
): { fields: NoticiaEnriquecidaUpdate; campos: string[]; marcadores: string[] } {
  const fields: NoticiaEnriquecidaUpdate = {};
  const campos: string[] = [];
  const marcadores: string[] = [];

  // Título: respeta el real; si falta, usa extracción y, en su defecto, slug.
  if (vacio(noticia.titulo)) {
    const tituloHtml = extracto.titulo;
    const { titulo, generadoDesdeUrl } = resolverTitulo(
      tituloHtml,
      noticia.url_original ?? '',
    );
    if (titulo) {
      fields.titulo = titulo;
      campos.push('titulo');
      if (generadoDesdeUrl || extracto.metodo_titulo === 'fallback_url_slug') {
        marcadores.push(MARCADOR_TITULO_DESDE_URL);
      } else if (extracto.metodo_titulo) {
        marcadores.push(`titulo:${extracto.metodo_titulo}`);
      }
    }
  }

  if (vacio(noticia.resumen) && extracto.resumen) {
    fields.resumen = extracto.resumen;
    campos.push('resumen');
  }

  if (vacio(noticia.texto_extraido) && extracto.texto_extraido) {
    fields.texto_extraido = extracto.texto_extraido;
    campos.push('texto_extraido');
    if (extracto.metodo_texto) marcadores.push(`texto:${extracto.metodo_texto}`);
  }

  if (vacio(noticia.autor) && extracto.autor) {
    fields.autor = extracto.autor;
    campos.push('autor');
  }

  if (vacio(noticia.seccion) && extracto.seccion) {
    fields.seccion = extracto.seccion;
    campos.push('seccion');
  }

  if (vacio(noticia.imagen_principal) && extracto.imagen) {
    fields.imagen_principal = extracto.imagen;
    campos.push('imagen_principal');
  }

  // Trazabilidad del estado de extracción tras el enriquecimiento.
  if (!extracto.ok) {
    fields.estado_extraccion = 'error';
    fields.error_extraccion = extracto.error;
    marcadores.push(`enrich_error:${extracto.error ?? 'desconocido'}`);
  } else if (campos.length > 0) {
    fields.estado_extraccion = 'enriquecido';
  }

  if (marcadores.length > 0) {
    fields.notas = marcadores.join('; ');
  }

  return { fields, campos, marcadores };
}

/**
 * Orquesta el enriquecimiento de un lote de noticias. En dry-run arma el plan
 * sin escribir; en modo real actualiza Supabase nota por nota (errores de una
 * nota no detienen el resto).
 */
export async function enrichNews(
  deps: EnrichDeps,
  opts: EnrichOpts,
): Promise<EnrichResult> {
  const noticias = await deps.fetchNoticias({
    limit: opts.limit,
    onlyMissingTitle: opts.onlyMissingTitle,
    onlyMissingText: opts.onlyMissingText,
  });

  const detalle: EnrichItemResult[] = [];
  let actualizadas = 0;
  let sinCambios = 0;
  let fallidas = 0;

  for (const noticia of noticias) {
    const url = noticia.url_original;
    if (!url) {
      fallidas += 1;
      detalle.push({
        noticia_id: noticia.noticia_id,
        url: null,
        ok: false,
        error: 'sin url_original',
        campos_actualizados: [],
        marcadores: [],
        fields: {},
      });
      continue;
    }

    const extracto = await deps.extract(url);
    const { fields, campos, marcadores } = construirActualizacion(noticia, extracto);

    const item: EnrichItemResult = {
      noticia_id: noticia.noticia_id,
      url,
      ok: extracto.ok,
      error: extracto.error,
      campos_actualizados: campos,
      marcadores,
      fields,
    };
    detalle.push(item);

    if (!extracto.ok) fallidas += 1;

    const hayCambios = Object.keys(fields).length > 0;
    if (!hayCambios) {
      sinCambios += 1;
      continue;
    }

    if (!opts.dryRun) {
      await deps.updateNoticia(noticia.noticia_id, fields);
    }
    if (campos.length > 0) actualizadas += 1;
    else sinCambios += 1;
  }

  return {
    leidas: noticias.length,
    actualizadas,
    sinCambios,
    fallidas,
    dryRun: opts.dryRun,
    detalle,
  };
}
