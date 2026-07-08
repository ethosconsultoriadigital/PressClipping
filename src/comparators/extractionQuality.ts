/**
 * Heurísticas PURAS de calidad de extracción de noticias (sin red, sin IA).
 *
 * Usadas por `scripts/audit-extraction-quality.ts` para auditar (solo lectura)
 * `01_Noticias_Raw` / `02_Menciones`. Aisladas aquí para poder testearlas sin
 * ejecutar el script (que abre conexión a Supabase).
 */

const txt = (v: unknown): string => String(v ?? '').trim();

/** Encoding sospechoso: mojibake típico UTF-8 mal decodificado o carácter de reemplazo. */
const RE_MOJIBAKE = /(Ã[\x80-\xbf]|Â[\x80-\xbf]|â€|ï¿½|\uFFFD)/;
export function encodingSospechoso(s: string): boolean {
  return RE_MOJIBAKE.test(txt(s));
}

/** Boilerplate/nav: cuerpo corto dominado por tokens de navegación/promoción. */
const RE_BOILERPLATE = /(suscr[íi]bete|newsletter|iniciar sesi[óo]n|acepta(r)? cookies|pol[íi]tica de privacidad|lee tambi[ée]n|te puede interesar|s[íi]guenos en|compartir en|publicidad|men[úu] principal)/gi;
export function pareceBoilerplate(s: string): boolean {
  const v = txt(s);
  if (v.length === 0) return false;
  const matches = v.match(RE_BOILERPLATE);
  if (v.length < 300 && matches && matches.length >= 1) return true;
  return !!matches && matches.length >= 4;
}

/** URL de listado/sección (no nota individual). */
const RE_LISTING = /(\/tag\/|\/tags\/|\/seccion\/|\/secciones\/|\/categoria\/|\/category\/|\/author\/|\/autor\/|\/page\/|\/buscar|\/search)/i;
export function pareceListing(url: string): boolean {
  const u = txt(url);
  if (!u) return false;
  try {
    const path = new URL(u).pathname;
    if (path === '/' || path === '') return true;
    return RE_LISTING.test(path) && path.split('/').filter(Boolean).length <= 2;
  } catch { return false; }
}

export function fechaValida(s: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(txt(s));
}

export function urlValida(s: unknown): boolean {
  return /^https?:\/\//i.test(txt(s));
}

export type ClasifExtraccion =
  | 'EXTRACCION_EXCELENTE' | 'EXTRACCION_BUENA' | 'EXTRACCION_REGULAR'
  | 'EXTRACCION_MALA' | 'BOILERPLATE' | 'SIN_CUERPO' | 'REVISAR_MANUAL';

export interface EntradaClasifExtraccion {
  notas: number;
  pct_vacias: number;
  pct_boilerplate: number;
  pct_texto_600: number;
  pct_texto_1200: number;
  mediana_chars: number;
}

/** Clasifica la extracción de un medio a partir de sus porcentajes agregados. */
export function clasificarExtraccion(e: EntradaClasifExtraccion): ClasifExtraccion {
  if (e.notas === 0) return 'REVISAR_MANUAL';
  if (e.pct_vacias >= 60) return 'SIN_CUERPO';
  if (e.pct_boilerplate >= 40) return 'BOILERPLATE';
  if (e.pct_texto_1200 >= 70 && e.mediana_chars >= 1200) return 'EXTRACCION_EXCELENTE';
  if (e.pct_texto_600 >= 70 && e.mediana_chars >= 600) return 'EXTRACCION_BUENA';
  if (e.pct_texto_600 >= 40) return 'EXTRACCION_REGULAR';
  return 'EXTRACCION_MALA';
}

export function accionExtraccion(c: ClasifExtraccion): string {
  switch (c) {
    case 'EXTRACCION_EXCELENTE': return 'mantener';
    case 'EXTRACCION_BUENA':     return 'mantener';
    case 'EXTRACCION_REGULAR':   return 'revisar extractor';
    case 'EXTRACCION_MALA':      return 'reparar extractor (prioritario)';
    case 'BOILERPLATE':          return 'filtrar boilerplate / revisar selector';
    case 'SIN_CUERPO':           return 'reparar fuente (sin cuerpo)';
    case 'REVISAR_MANUAL':       return 'revisión manual';
  }
}

export function medianaChars(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}
