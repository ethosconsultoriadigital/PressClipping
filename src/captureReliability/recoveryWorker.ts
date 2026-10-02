import { admitDiscoveredArticle } from './articleAdmission.js';
import { decideFetchError } from './reconcile.js';
import { nextBackoffSeconds } from './retry.js';
import { captureCanonicalUrl, primaryHash } from './urlIndex.js';
import { normalizeNoticia } from '../normalizers/noticia.js';
import type { FetchExtractResult } from '../extractors/html.js';
import type { NoticiaInsert } from '../normalizers/noticia.js';
import type { CaptureReliabilityStore } from './captureRecoveryRepository.js';
import type { RecoveryRecord } from './types.js';

export interface RecoveryFetchExtract {
  (url: string): Promise<FetchExtractResult>;
}

export interface RecoveryPersist {
  (item: NoticiaInsert): Promise<{ noticiaId: string | null; inserted: boolean }>;
}

export function extractToNoticia(opts: {
  url: string;
  medioId: string;
  extract: FetchExtractResult;
  publishedAt?: string | null;
}): NoticiaInsert {
  const base = normalizeNoticia(
    {
      url: opts.url,
      titulo: opts.extract.titulo,
      resumen: opts.extract.resumen,
      autor: opts.extract.autor,
      fecha: opts.publishedAt ?? null,
      seccion: opts.extract.seccion,
      imagen: opts.extract.imagen,
    },
    { medio_id: opts.medioId, fuente: 'capture_recovery' },
  );
  if (!base) {
    throw new Error(`normalizeNoticia rejected url ${opts.url}`);
  }
  const body = opts.extract.texto_cuerpo_nota || opts.extract.texto_nota_limpia || opts.extract.texto_extraido;
  const out: NoticiaInsert = {
    medio_id: opts.medioId,
    url_original: base.url_original,
    url_canonica: captureCanonicalUrl(opts.url),
    titulo: opts.extract.titulo,
    subtitulo: base.subtitulo,
    autor: base.autor,
    fecha_publicacion: base.fecha_publicacion,
    seccion: base.seccion,
    texto_extraido: body,
    resumen: opts.extract.resumen,
    imagen_principal: base.imagen_principal,
    idioma: base.idioma,
    pais: base.pais,
    estado: base.estado,
    municipio: base.municipio,
    hash_url: primaryHash(opts.url),
    hash_contenido: base.hash_contenido,
    cluster_id: base.cluster_id,
    fuente_extraccion: 'capture_recovery',
    estado_extraccion: base.estado_extraccion,
    error_extraccion: base.error_extraccion,
  };
  return out;
}

export async function processRecoveryRecord(opts: {
  record: RecoveryRecord;
  store: CaptureReliabilityStore;
  fetchExtract: RecoveryFetchExtract;
  persistNews?: RecoveryPersist;
  writesAllowed: boolean;
  nowIso: string;
  maxAttempts?: number;
}): Promise<RecoveryRecord> {
  const rec = opts.record;
  const maxAttempts = opts.maxAttempts ?? 8;
  await opts.store.markFetching(rec.hash_url, rec.claimed_by ?? 'worker', opts.nowIso);

  const extracted = await opts.fetchExtract(rec.discovered_url);
  if (!extracted.ok) {
    const dec = decideFetchError(
      rec,
      {
        httpStatus: extracted.httpError?.status ?? null,
        timeout: extracted.httpError?.kind === 'timeout',
        networkError: extracted.httpError?.kind === 'network',
      },
      maxAttempts,
    );
    if (dec.record.status === 'BLOCKED') {
      return (await opts.store.markBlocked(rec.hash_url, dec.record.last_error ?? 'blocked')) ?? dec.record;
    }
    if (dec.record.status === 'FAILED_RETRY_EXHAUSTED') {
      return (await opts.store.markFailed(rec.hash_url, dec.record.last_error ?? 'exhausted')) ?? dec.record;
    }
    if (dec.record.status === 'MANUAL_REVIEW') {
      return (await opts.store.markStatus(rec.hash_url, 'MANUAL_REVIEW', { last_error: dec.record.last_error })) ?? dec.record;
    }
    const backoff = nextBackoffSeconds(dec.record.attempt_count, maxAttempts) ?? 15;
    const next = new Date(Date.parse(opts.nowIso) + backoff * 1000).toISOString();
    return (
      (await opts.store.markRetry(rec.hash_url, next, dec.record.last_error ?? 'retry', dec.record.attempt_count)) ?? dec.record
    );
  }

  await opts.store.markStatus(rec.hash_url, 'FETCHED');
  const body = extracted.texto_cuerpo_nota || extracted.texto_nota_limpia || extracted.texto_extraido;
  const admission = admitDiscoveredArticle({
    url: rec.discovered_url,
    medioId: rec.medio_id,
    titulo: extracted.titulo,
    resumen: extracted.resumen,
    body,
  });
  if (!admission.admit) {
    return (await opts.store.markRejected(rec.hash_url, admission.reason)) ?? rec;
  }
  await opts.store.markStatus(rec.hash_url, 'EXTRACTED');
  if (!rec.medio_id) {
    return (await opts.store.markStatus(rec.hash_url, 'UNKNOWN_SOURCE')) ?? rec;
  }

  const item = extractToNoticia({
    url: rec.discovered_url,
    medioId: rec.medio_id,
    extract: extracted,
  });

  if (!opts.writesAllowed) {
    return (await opts.store.markWouldPersist(rec.hash_url)) ?? rec;
  }
  if (!opts.persistNews) {
    return (await opts.store.markWouldPersist(rec.hash_url)) ?? rec;
  }
  const persisted = await opts.persistNews(item);
  return (await opts.store.markPersisted(rec.hash_url, persisted.noticiaId, opts.nowIso)) ?? rec;
}
