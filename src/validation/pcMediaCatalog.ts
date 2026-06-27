/**
 * Cruce del catálogo de medios de PressClipping contra la tabla `medios` de
 * Ethos — lógica PURA (sin red ni DB).
 *
 * Normaliza nombres y dominios, calcula similitud, decide el tipo de match y la
 * prioridad de alta/reparación. El script de import provee la red (diagnóstico
 * de fuentes) y la DB (medios Ethos).
 */
import { foldText } from '../matchers/text.js';

// ─────────────────────────────────────────────────────────────────────────────
// Encoding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Repara mojibake típico de UTF-8 leído como Latin-1 (p. ej. "MÃ©xico" → "México").
 * Best-effort: solo actúa si detecta secuencias sospechosas.
 */
export function repararMojibake(s: string): string {
  if (!/[ÃÂâ€]/.test(s)) return s;
  try {
    const reparado = Buffer.from(s, 'latin1').toString('utf8');
    // Si la reparación introduce el carácter de reemplazo, conservamos el original.
    return reparado.includes('\uFFFD') ? s : reparado;
  } catch {
    return s;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dominios
// ─────────────────────────────────────────────────────────────────────────────

/** Normaliza un dominio: minúsculas, sin protocolo, sin www., sin barra final. */
export function normalizarDominio(d: string | null | undefined): string {
  if (!d) return '';
  let s = d.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split('/')[0] ?? s;
  s = s.replace(/:\d+$/, '');
  return s.trim();
}

/** Extrae el dominio (host sin www.) desde una URL de nota. */
export function extraerDominioDesdeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const raw = url.trim();
  if (!/^https?:\/\//i.test(raw)) {
    // Puede venir sin protocolo: intentar como host directo.
    const host = normalizarDominio(raw);
    return host.includes('.') ? host : null;
  }
  try {
    return new URL(raw).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** ¿Parece una URL válida (http/https)? */
export function pareceUrl(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^https?:\/\/\S+\.\S+/i.test(s.trim());
}

/** ¿Dos dominios coinciden (mismo registrable o subdominio)? */
export function dominiosCoinciden(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizarDominio(a);
  const y = normalizarDominio(b);
  if (!x || !y) return false;
  return x === y || x.endsWith('.' + y) || y.endsWith('.' + x);
}

// ─────────────────────────────────────────────────────────────────────────────
// Nombres
// ─────────────────────────────────────────────────────────────────────────────

const SUFIJOS_GENERICOS = ['noticias', 'online', 'digital', 'mexico', 'mx'];

/**
 * Normalización conservadora del nombre de medio (para match exacto/visual).
 * minúsculas, sin acentos/signos, espacios colapsados; quita .com/.com.mx/.mx
 * finales del nombre cuando viene como dominio.
 */
export function normalizarNombreMedio(nombre: string | null | undefined): string {
  if (!nombre) return '';
  let s = foldText(repararMojibake(nombre));
  s = s.replace(/\.com\.mx\b/g, ' ').replace(/\.com\b/g, ' ').replace(/\.mx\b/g, ' ');
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Normalización AGRESIVA para fuzzy: además quita sufijos genéricos finales
 * (noticias, online, digital, mexico, mx) sin tocar prefijos como el/la/diario.
 */
export function normalizarNombreFuzzy(nombre: string | null | undefined): string {
  let s = normalizarNombreMedio(nombre);
  let tokens = s.split(' ').filter(Boolean);
  while (tokens.length > 1 && SUFIJOS_GENERICOS.includes(tokens[tokens.length - 1]!)) {
    tokens = tokens.slice(0, -1);
  }
  return tokens.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Similitud
// ─────────────────────────────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 0; i < a.length; i++) {
    cur[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i] === b[j] ? 0 : 1;
      cur[j + 1] = Math.min(prev[j + 1]! + 1, cur[j]! + 1, prev[j]! + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j]!;
  }
  return prev[b.length]!;
}

function ratioLevenshtein(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

function jaccardTokens(a: string, b: string): number {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/**
 * Similitud 0-1 entre dos nombres de medio (usa forma fuzzy). Combina ratio de
 * Levenshtein y Jaccard de tokens, devolviendo el máximo (tolerante a orden).
 */
export function similitudNombre(a: string | null | undefined, b: string | null | undefined): number {
  const fa = normalizarNombreFuzzy(a);
  const fb = normalizarNombreFuzzy(b);
  if (!fa || !fb) return 0;
  if (fa === fb) return 1;
  return Number(Math.max(ratioLevenshtein(fa, fb), jaccardTokens(fa, fb)).toFixed(3));
}

// ─────────────────────────────────────────────────────────────────────────────
// Matching
// ─────────────────────────────────────────────────────────────────────────────

export type TipoMatch =
  | 'MATCH_URL'
  | 'MATCH_EXACTO_NOMBRE'
  | 'MATCH_FUZZY_ALTO'
  | 'MATCH_FUZZY_MEDIO'
  | 'SIN_MATCH';

export interface MedioEthosLite {
  medio_id: string;
  nombre_medio: string;
  url_base: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  metodo_extraccion: string | null;
  ultimo_estado: string | null;
}

export interface ResultadoMatch {
  tipo: TipoMatch;
  medio: MedioEthosLite | null;
  similitud: number;
}

/**
 * Elige el mejor match de un medio PressClipping contra la lista Ethos, con la
 * prioridad: URL > nombre exacto > fuzzy alto (>=0.90) > fuzzy medio (>=0.80).
 */
export function mejorMatch(
  pcNombre: string,
  pcDominio: string | null,
  ethos: MedioEthosLite[],
): ResultadoMatch {
  const pcNorm = normalizarNombreMedio(pcNombre);

  // 1. MATCH_URL: dominio igual contra url_base/rss/sitemap.
  if (pcDominio) {
    for (const m of ethos) {
      const dominios = [m.url_base, m.rss_url, m.sitemap_url]
        .map((u) => extraerDominioDesdeUrl(u))
        .filter(Boolean) as string[];
      if (dominios.some((d) => dominiosCoinciden(d, pcDominio))) {
        return { tipo: 'MATCH_URL', medio: m, similitud: similitudNombre(pcNombre, m.nombre_medio) };
      }
    }
  }

  // 2. MATCH_EXACTO_NOMBRE.
  for (const m of ethos) {
    if (normalizarNombreMedio(m.nombre_medio) === pcNorm && pcNorm !== '') {
      return { tipo: 'MATCH_EXACTO_NOMBRE', medio: m, similitud: 1 };
    }
  }

  // 3/4. Fuzzy: tomar el de mayor similitud.
  let best: MedioEthosLite | null = null;
  let bestSim = 0;
  for (const m of ethos) {
    const sim = similitudNombre(pcNombre, m.nombre_medio);
    if (sim > bestSim) { bestSim = sim; best = m; }
  }
  if (best && bestSim >= 0.9) return { tipo: 'MATCH_FUZZY_ALTO', medio: best, similitud: bestSim };
  if (best && bestSim >= 0.8) return { tipo: 'MATCH_FUZZY_MEDIO', medio: best, similitud: bestSim };
  return { tipo: 'SIN_MATCH', medio: null, similitud: best ? bestSim : 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Prioridad de alta / reparación
// ─────────────────────────────────────────────────────────────────────────────

export type PrioridadReparacion = 'ALTA' | 'MEDIA' | 'BAJA' | 'NO_AGREGAR' | 'REVISAR';

export interface PrioridadInput {
  existeEnEthos: boolean;
  frecuencia: number;
  esAgregador: boolean;
  tieneFuenteViable: boolean;
  esMexico: boolean;
  sinUrl: boolean;
}

export interface PrioridadResultado {
  prioridad_alta: boolean;
  prioridad_reparacion: PrioridadReparacion;
  razon: string;
}

/** Decide prioridad de alta/reparación de un medio PressClipping faltante. */
export function calcularPrioridad(p: PrioridadInput): PrioridadResultado {
  if (p.existeEnEthos) {
    return { prioridad_alta: false, prioridad_reparacion: 'NO_AGREGAR', razon: 'Ya existe en Ethos.' };
  }
  if (p.esAgregador) {
    return { prioridad_alta: false, prioridad_reparacion: 'NO_AGREGAR', razon: 'Agregador/replicador de bajo valor.' };
  }
  if (p.sinUrl) {
    return { prioridad_alta: false, prioridad_reparacion: 'REVISAR', razon: 'Sin URL de ejemplo: requiere búsqueda manual de fuente.' };
  }
  if (!p.tieneFuenteViable) {
    if (p.frecuencia >= 5 && p.esMexico) {
      return { prioridad_alta: false, prioridad_reparacion: 'REVISAR', razon: 'Frecuencia alta pero sin fuente viable; evaluar extracción directa.' };
    }
    return { prioridad_alta: false, prioridad_reparacion: 'NO_AGREGAR', razon: 'Sin fuente viable y frecuencia baja.' };
  }
  // Tiene fuente viable y no es agregador.
  if (p.esMexico && p.frecuencia >= 5) {
    return { prioridad_alta: true, prioridad_reparacion: 'ALTA', razon: 'Medio mexicano relevante, frecuencia alta y fuente viable.' };
  }
  if (p.esMexico && p.frecuencia >= 2) {
    return { prioridad_alta: false, prioridad_reparacion: 'MEDIA', razon: 'Medio mexicano con fuente viable y frecuencia moderada.' };
  }
  return { prioridad_alta: false, prioridad_reparacion: 'BAJA', razon: 'Fuente viable pero frecuencia baja.' };
}
