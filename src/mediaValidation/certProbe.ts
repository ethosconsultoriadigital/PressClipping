/**
 * Salud de fuente para certificación: probe DIAGNÓSTICO vs captura PRODUCTIVA.
 *
 * El probe de certificación es un GET de RSS/sitemap en el momento del audit
 * (timeout corto, 0 reintentos, UA de auditoría). Un TRANSIENT ahí NO es una
 * noticia productiva. ultimo_estado/ultimo_error del crawl sí lo son.
 */
export type SourceHealthClass = 'HEALTHY' | 'TRANSIENT' | 'PERSISTENT' | 'UNKNOWN' | 'PAYWALL';

export function productionCaptureHealth(
  lastEstado: string | null | undefined,
  lastError: string | null | undefined,
): SourceHealthClass {
  const estado = (lastEstado ?? '').trim().toLowerCase();
  const err = lastError ?? '';
  if (estado === 'ok' || estado === 'parcial') return 'HEALTHY';
  if (/403|401/.test(err) || estado === 'error' && /403|401/.test(err)) return 'PERSISTENT';
  if (/404|410/.test(err)) return 'PERSISTENT';
  if (/timeout/i.test(err) || /timeout/i.test(estado)) return 'TRANSIENT';
  if (estado === 'error' || estado === 'sin_fuente') return 'TRANSIENT';
  return 'UNKNOWN';
}

/**
 * ¿El TRANSIENT del probe debe entrar al A-gate editorial?
 * Solo si la captura productiva también está enferma.
 */
export function transientAffectsArticleClass(
  diagnosticProbe: SourceHealthClass,
  production: SourceHealthClass,
): boolean {
  if (diagnosticProbe !== 'TRANSIENT') return false;
  return production === 'TRANSIENT';
}
