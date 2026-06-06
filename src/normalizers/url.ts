/**
 * Normalización de URLs para obtener una forma canónica estable.
 *
 * Objetivo: que dos enlaces que apuntan a la misma noticia produzcan el mismo
 * hash_url. Quitamos parámetros de tracking, fragmentos y barras finales, y
 * normalizamos esquema/host a minúsculas.
 */

/** Parámetros de query que no identifican el recurso (tracking/analytics). */
const TRACKING_PARAMS = [
  /^utm_/i,
  /^fbclid$/i,
  /^gclid$/i,
  /^mc_/i,
  /^ref$/i,
  /^ref_src$/i,
  /^igshid$/i,
  /^spm$/i,
];

function esTracking(param: string): boolean {
  return TRACKING_PARAMS.some((re) => re.test(param));
}

/**
 * Devuelve la URL canónica. Si la entrada no es una URL válida, devuelve la
 * cadena original recortada (mejor conservar algo que perder la noticia).
 */
export function canonicalizeUrl(input: string): string {
  const raw = input.trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }

  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  u.hash = '';

  // Elimina parámetros de tracking conservando el orden de los demás.
  const keep: [string, string][] = [];
  for (const [k, v] of u.searchParams.entries()) {
    if (!esTracking(k)) keep.push([k, v]);
  }
  u.search = '';
  for (const [k, v] of keep) u.searchParams.append(k, v);

  // Quita barra final salvo cuando el path es la raíz.
  let pathname = u.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  u.pathname = pathname;

  return u.toString();
}
