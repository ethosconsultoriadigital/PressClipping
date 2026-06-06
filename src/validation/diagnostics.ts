/**
 * Lógica pura de diagnóstico de medios (sin red ni DB).
 *
 * Decide: qué medios procesar (activos, sin duplicados), qué método de
 * extracción recomendar, y si un medio es "especial" (requiere JS/proxy o no
 * tiene fuente accesible). Todo testeable de forma aislada.
 */
import { canonicalizeUrl } from '../normalizers/url.js';

/** Subconjunto de campos de un medio necesarios para diagnosticar. */
export interface MedioInput {
  medio_id: string;
  nombre_medio: string;
  activo: boolean;
  prioridad: string | null;
  metodo_extraccion: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  secciones_urls: string | null;
  buscador_url: string | null;
  requiere_javascript: boolean;
  requiere_proxy: boolean;
  url_base: string | null;
}

/** Resultado de probar las fuentes de un medio (lo produce probe.ts). */
export interface ProbeResult {
  rss_ok: boolean;
  rss_items: number;
  sitemap_ok: boolean;
  sitemap_items: number;
  error: string | null;
}

export interface Particion {
  procesables: MedioInput[]; // activos y únicos
  inactivos: MedioInput[];
  duplicados: MedioInput[]; // descartados por id o url_base repetida
}

/**
 * Separa los medios en procesables / inactivos / duplicados.
 * Duplicado = mismo medio_id o misma url_base canónica ya vista.
 * El primero gana; los siguientes se marcan como duplicados.
 */
export function particionarMedios(medios: MedioInput[]): Particion {
  const procesables: MedioInput[] = [];
  const inactivos: MedioInput[] = [];
  const duplicados: MedioInput[] = [];

  const idsVistos = new Set<string>();
  const basesVistas = new Set<string>();

  for (const m of medios) {
    const idKey = m.medio_id.trim().toLowerCase();
    const baseKey = m.url_base ? canonicalizeUrl(m.url_base).toLowerCase() : '';

    const dupId = idKey !== '' && idsVistos.has(idKey);
    const dupBase = baseKey !== '' && basesVistas.has(baseKey);

    if (dupId || dupBase) {
      duplicados.push(m);
      continue;
    }
    if (idKey) idsVistos.add(idKey);
    if (baseKey) basesVistas.add(baseKey);

    if (!m.activo) {
      inactivos.push(m);
      continue;
    }
    procesables.push(m);
  }

  return { procesables, inactivos, duplicados };
}

/** Filtra por prioridad (case-insensitive, exacta) si se especifica. */
export function filtrarPorPrioridad(
  medios: MedioInput[],
  prioridad?: string,
): MedioInput[] {
  if (!prioridad) return medios;
  const p = prioridad.trim().toLowerCase();
  return medios.filter((m) => (m.prioridad ?? '').trim().toLowerCase() === p);
}

/**
 * Recomienda el método de extracción a partir de la prueba real y la config.
 * Prioriza lo que efectivamente funcionó; degrada a fases posteriores si no.
 */
export function recomendarMetodo(m: MedioInput, p: ProbeResult): string {
  if (p.rss_ok && p.rss_items > 0) return 'rss';
  if (p.sitemap_ok && p.sitemap_items > 0) return 'sitemap';
  // Configurado pero no respondió: lo señalamos para revisión.
  if (m.rss_url && !p.rss_ok) return 'rss (revisar: no respondió)';
  if (m.sitemap_url && !p.sitemap_ok) return 'sitemap (revisar: no respondió)';
  if (m.requiere_javascript) return 'html_headless (fase posterior)';
  if (m.secciones_urls) return 'secciones (fase posterior)';
  if (m.buscador_url) return 'buscador (fase posterior)';
  return 'sin_metodo_viable';
}

/** Estado de diagnóstico global del medio. */
export function estadoDiagnostico(p: ProbeResult): 'ok' | 'parcial' | 'sin_fuente' | 'error' {
  const algo = (p.rss_ok && p.rss_items > 0) || (p.sitemap_ok && p.sitemap_items > 0);
  if (algo) {
    const ambas = p.rss_ok && p.sitemap_ok;
    return ambas ? 'ok' : 'parcial';
  }
  if (p.error) return 'error';
  return 'sin_fuente';
}

export interface Clasificacion {
  es_especial: boolean;
  motivo: string | null;
  sugerencia: string | null;
}

/** Determina si el medio es "especial" (fuera del MVP simple) y por qué. */
export function clasificarMedio(m: MedioInput, p: ProbeResult): Clasificacion {
  const motivos: string[] = [];
  if (m.requiere_javascript) motivos.push('requiere_javascript');
  if (m.requiere_proxy) motivos.push('requiere_proxy');
  if (!p.rss_ok && !p.sitemap_ok) motivos.push('sin fuente RSS/sitemap accesible');

  if (motivos.length === 0) {
    return { es_especial: false, motivo: null, sugerencia: null };
  }

  let sugerencia = 'Revisar manualmente.';
  if (m.requiere_javascript) sugerencia = 'Extracción headless en fase posterior.';
  else if (m.requiere_proxy) sugerencia = 'Habilitar proxy aprobado en fase posterior.';
  else if (m.secciones_urls) sugerencia = 'Probar scraping de secciones en fase posterior.';
  else if (m.buscador_url) sugerencia = 'Probar buscador interno en fase posterior.';

  return { es_especial: true, motivo: motivos.join('; '), sugerencia };
}
