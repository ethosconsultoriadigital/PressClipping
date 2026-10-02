import { construirActualizacion } from '../enrichers/enrichNews.js';
import { normalizeNoticia, type NoticiaInsert } from '../normalizers/noticia.js';
import type { FetchExtractResult } from '../extractors/html.js';
import type { NoticiaEnriquecidaUpdate } from '../enrichers/enrichNews.js';
import { captureCanonicalUrl, primaryHash } from './urlIndex.js';

export interface RecoveredNewsPayload {
  insert: NoticiaInsert;
  enrichment: NoticiaEnriquecidaUpdate;
}

/**
 * Metadata via ingest contract. Trusted body via the SAME enrichment field map.
 * texto_extraido stays RAW. Clean/body fields are never stuffed into RAW.
 */
export function buildRecoveredNewsPayload(opts: {
  url: string;
  medioId: string;
  extract: FetchExtractResult;
  publishedAt?: string | null;
  discoveredTitle?: string | null;
  discoveredSummary?: string | null;
}): RecoveredNewsPayload {
  const titulo = opts.extract.titulo || opts.discoveredTitle || null;
  const resumen = opts.extract.resumen || opts.discoveredSummary || null;
  const fecha = opts.publishedAt ?? null;
  const base = normalizeNoticia(
    {
      url: opts.url,
      titulo,
      resumen,
      autor: opts.extract.autor,
      fecha,
      seccion: opts.extract.seccion,
      imagen: opts.extract.imagen,
    },
    { medio_id: opts.medioId, fuente: 'capture_recovery' },
  );
  if (!base) throw new Error(`normalizeNoticia rejected url ${opts.url}`);
  const insert: NoticiaInsert = {
    ...base,
    medio_id: opts.medioId,
    titulo,
    resumen,
    fecha_publicacion: fecha,
    url_canonica: captureCanonicalUrl(opts.url),
    hash_url: primaryHash(opts.url),
    texto_extraido: opts.extract.texto_extraido,
  };
  const { fields } = construirActualizacion(
    {
      noticia_id: 'pending',
      medio_id: opts.medioId,
      url_original: opts.url,
      titulo: null,
      resumen: null,
      texto_extraido: null,
      autor: null,
      seccion: null,
      imagen_principal: null,
      texto_nota_limpia: null,
      extracto_nota_1300: null,
      calidad_extraccion: null,
      texto_limpio_chars: null,
      texto_cuerpo_nota: null,
      extracto_cuerpo_1300: null,
      cuerpo_nota_chars: null,
      tipo_nota: null,
    },
    opts.extract,
    { forceRefreshCleanText: true },
  );
  return { insert, enrichment: fields };
}
