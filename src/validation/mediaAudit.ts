/**
 * Homologación técnica de medios — lógica PURA (sin red ni DB).
 *
 * A partir del medio y del resultado de probar sus fuentes (configurada +
 * alternativas), calcula un `confidence_score` y decide un estado técnico
 * estándar. Diseñada para NO reparar fuentes buenas (caso Forbes): si la fuente
 * configurada ya entrega noticias, se conserva (READY_KEEP_CURRENT) en vez de
 * sustituirla por una alternativa (p. ej. un sitemap index masivo).
 *
 * No hace crawl masivo: el script que la usa prueba unas pocas URLs por medio.
 */

/** Estados técnicos estándar de homologación (endurecidos). */
export type EstadoFuente =
  | 'READY_KEEP_CURRENT'                  // fuente configurada funciona: no tocar
  | 'READY_SITEMAP_INDEX'                 // fuente configurada es un sitemap index resuelto a noticias recientes
  | 'DO_NOT_TOUCH'                        // solo hay alternativa riesgosa (índice masivo): no auto-reparar
  | 'REPAIRABLE_RSS_HIGH_CONFIDENCE'      // RSS alterno validado, confidence>=0.90
  | 'REPAIRABLE_SITEMAP_HIGH_CONFIDENCE' // sitemap alterno validado, confidence>=0.90
  | 'REPAIRABLE_NEEDS_REVIEW'            // fuente alterna plausible pero confidence 0.70-0.89
  | 'DISCOVERY_GAP'                      // sin feed fiable, pero la página existe
  | 'DIRECT_EXTRACTION_ONLY'            // url directa extrae, sin discovery automatizable
  | 'JS_REQUIRED'                       // requiere render JS
  | 'PROXY_REQUIRED'                    // requiere proxy aprobado
  | 'BLOCKED'                           // 401/403
  | 'NO_FEED'                           // sin fuente ni página utilizable
  | 'TIMEOUT'                           // timeouts persistentes
  | 'LOW_VALUE_AGGREGATOR'              // agregador/replicador de bajo valor
  | 'PC_NOISE'                          // ruido de PressClipping
  | 'REVISAR_HUMANO';                   // caso ambiguo

/** Una fuente candidata probada con sus señales de calidad. */
export interface FuenteCandidata {
  url: string;
  tipo: 'rss' | 'sitemap';
  items: number;
  /** Items con fecha dentro de la ventana reciente (~30 días). */
  recientes: number;
  /** Había fechas disponibles para evaluar frescura. */
  fechasDisponibles: boolean;
  /** El host de la fuente coincide con el host de url_base. */
  dominioOk: boolean;
  /** Es un sitemap index masivo (muchos sub-sitemaps / miles de URLs). */
  esIndiceMasivo: boolean;
  /** Coincide con la fuente actualmente configurada en el medio. */
  esConfigurada: boolean;
  /** La fuente es un sitemap index que se resolvió a sus sub-sitemaps. */
  esIndice?: boolean;
}

/** Entrada al clasificador (resultado agregado de probar el medio). */
export interface AuditInput {
  metodo_extraccion: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  url_base: string | null;
  requiere_javascript: boolean;
  requiere_proxy: boolean;
  /** Fuente configurada ya probada (o null si no respondió / no hay). */
  configurada: FuenteCandidata | null;
  /** Fuentes alternativas viables encontradas (items>0). */
  candidatas: FuenteCandidata[];
  /** La url_base devolvió HTML 200 (extracción directa plausible). */
  directOk: boolean;
  anyTimeout: boolean;
  anyBlocked: boolean;
  esAgregador: boolean;
}

export interface AuditVeredicto {
  estado_fuente: EstadoFuente;
  fuente_viable: string | null;
  tipo_fuente_viable: 'rss' | 'sitemap' | null;
  noticias_recientes_estimadas: number;
  discovery_ok: boolean;
  confidence_score: number;
  accion_recomendada: string;
}

const MIN_ITEMS = 10;
const MIN_RECIENTES = 3;
const INDICE_MASIVO_ITEMS = 500;

/** Dominios agregadores / replicadores de bajo valor editorial. */
const AGREGADORES = [
  'msn.com', 'news.google', 'google.com', 'bing.com', 'yahoo.com',
  'flipboard', 'blogspot.', 'wordpress.com', 'medium.com',
];

export function esDominioAgregador(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase();
  return AGREGADORES.some((d) => u.includes(d));
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/**
 * Calcula el confidence_score (0-1) de una fuente candidata.
 * Penaliza pocos items, baja frescura, dominio incorrecto e índices masivos.
 */
export function confianzaFuente(f: FuenteCandidata, hayNewsSitemapMejor: boolean): number {
  let s = 0.6;
  s += f.items >= MIN_ITEMS ? 0.15 : -0.25;
  if (f.fechasDisponibles) s += f.recientes >= MIN_RECIENTES ? 0.15 : -0.15;
  else s -= 0.05; // frescura desconocida: leve penalización
  s += f.dominioOk ? 0.1 : -0.35;
  if (f.esIndiceMasivo) s -= hayNewsSitemapMejor ? 0.4 : 0.25;
  if (f.esConfigurada) s += 0.05;
  return Number(clamp01(s).toFixed(2));
}

/** ¿La fuente cumple los criterios estrictos para reparar sin revisión? */
export function cumpleEstricto(f: FuenteCandidata): boolean {
  if (f.items < MIN_ITEMS) return false;
  if (f.fechasDisponibles && f.recientes < MIN_RECIENTES) return false;
  if (!f.dominioOk) return false;
  if (f.esIndiceMasivo) return false; // nunca reparar a un índice masivo automáticamente
  return true;
}

/** La fuente configurada entrega contenido suficiente (no tocar). */
function configuradaEntrega(f: FuenteCandidata | null): boolean {
  if (!f) return false;
  if (f.items < MIN_ITEMS) return false;
  if (f.fechasDisponibles && f.recientes < 1) return false;
  return true;
}

function veredicto(
  estado: EstadoFuente,
  accion: string,
  conf: number,
  f?: FuenteCandidata | null,
): AuditVeredicto {
  return {
    estado_fuente: estado,
    fuente_viable: f?.url ?? null,
    tipo_fuente_viable: f?.tipo ?? null,
    noticias_recientes_estimadas: f?.recientes ?? 0,
    discovery_ok: !!f,
    confidence_score: Number(conf.toFixed(2)),
    accion_recomendada: `${accion} (confidence ${conf.toFixed(2)})`,
  };
}

/**
 * Clasifica el medio en un estado técnico estándar con confidence_score.
 */
export function clasificarFuenteMedio(input: AuditInput): AuditVeredicto {
  // 0. Agregador / ruido.
  if (input.esAgregador) {
    return veredicto('LOW_VALUE_AGGREGATOR', 'Agregador/replicador de bajo valor. No agregar como medio individual.', 0);
  }

  // 1. ¿La fuente configurada ya entrega contenido? → conservar (anti-Forbes).
  if (configuradaEntrega(input.configurada)) {
    const cfg = input.configurada!;
    const conf = confianzaFuente(cfg, false);
    // La fuente configurada es un sitemap index que se resolvió a noticias.
    if (cfg.esIndice) {
      return veredicto('READY_SITEMAP_INDEX',
        `Fuente configurada es un sitemap index resuelto a noticias recientes (SITEMAP_INDEX_RESOLVED). Sin acción.`,
        conf, cfg);
    }
    // ¿Existe una alternativa "tentadora" pero peor (índice masivo)? Avisar.
    const trampa = input.candidatas.some((c) => c.esIndiceMasivo);
    if (trampa) {
      return veredicto('READY_KEEP_CURRENT',
        `Fuente configurada (${cfg.tipo}) funciona y entrega noticias recientes; existe alternativa de índice masivo que NO debe usarse.`,
        conf, cfg);
    }
    return veredicto('READY_KEEP_CURRENT', `Fuente configurada (${cfg.tipo}) operativa con noticias recientes. Sin acción.`, conf, cfg);
  }

  // 2. Requiere proxy / JS (sin fuente configurada operativa).
  if (input.requiere_proxy) return veredicto('PROXY_REQUIRED', 'Requiere proxy aprobado. Fuera del MVP.', 0.2);
  if (input.requiere_javascript) return veredicto('JS_REQUIRED', 'Requiere render JS (headless). Fuera del MVP.', 0.2);

  // 3. Mejor alternativa entre candidatas (prefiriendo NO-índice).
  const noIndex = input.candidatas.filter((c) => !c.esIndiceMasivo);
  const pool = noIndex.length > 0 ? noIndex : input.candidatas;
  const hayNewsSitemapMejor = input.candidatas.some(
    (c) => c.tipo === 'sitemap' && !c.esIndiceMasivo && /news/i.test(c.url),
  );
  let best: FuenteCandidata | null = null;
  let bestConf = -1;
  for (const c of pool) {
    const conf = confianzaFuente(c, hayNewsSitemapMejor);
    if (conf > bestConf) { bestConf = conf; best = c; }
  }

  if (best) {
    // Solo hay índices masivos disponibles: no auto-reparar.
    if (noIndex.length === 0 && best.esIndiceMasivo) {
      return veredicto('DO_NOT_TOUCH',
        'Única fuente disponible es un sitemap index masivo. No auto-reparar; requiere decisión humana/sub-sitemap específico.',
        bestConf, best);
    }
    if (cumpleEstricto(best) && bestConf >= 0.9) {
      const estado: EstadoFuente = best.tipo === 'rss'
        ? 'REPAIRABLE_RSS_HIGH_CONFIDENCE' : 'REPAIRABLE_SITEMAP_HIGH_CONFIDENCE';
      return veredicto(estado, `Reparar a ${best.tipo.toUpperCase()} validado: ${best.url}.`, bestConf, best);
    }
    if (bestConf >= 0.7) {
      return veredicto('REPAIRABLE_NEEDS_REVIEW',
        `Fuente ${best.tipo} plausible (${best.url}) pero requiere revisión humana antes de reparar.`, bestConf, best);
    }
    // Confianza baja: no es fiable como fuente de discovery.
    if (input.directOk) {
      return veredicto('DIRECT_EXTRACTION_ONLY',
        'Feed de baja confianza. Extracción directa por URL posible; falta discovery fiable.', bestConf);
    }
    return veredicto('DISCOVERY_GAP', 'Feed de baja confianza y sin extracción directa confiable. Diagnosticar.', bestConf);
  }

  // 4. Sin candidatas viables.
  if (input.directOk) {
    return veredicto('DIRECT_EXTRACTION_ONLY',
      'La página responde pero no hay RSS/sitemap de descubrimiento. Extracción directa posible; falta discovery.', 0.4);
  }
  if (input.anyBlocked) return veredicto('BLOCKED', 'Acceso bloqueado (401/403). Requiere proxy/headers o queda como gap.', 0.1);
  if (input.anyTimeout) return veredicto('TIMEOUT', 'Timeouts persistentes. Reintentar con timeout mayor o sub-sitemap estable.', 0.1);
  return veredicto('NO_FEED', 'Sin RSS/sitemap accesible y sin página utilizable. Diagnosticar manualmente.', 0.1);
}

/** Estados operativos que ya capturan (no tocar). */
export const ESTADOS_OPERATIVOS: ReadonlySet<EstadoFuente> = new Set([
  'READY_KEEP_CURRENT', 'READY_SITEMAP_INDEX', 'DO_NOT_TOUCH',
]);

/** Estados reparables con alta confianza (aptos para --update-db). */
export const ESTADOS_REPARABLES_HIGH: ReadonlySet<EstadoFuente> = new Set([
  'REPAIRABLE_RSS_HIGH_CONFIDENCE', 'REPAIRABLE_SITEMAP_HIGH_CONFIDENCE',
]);

/**
 * Prioridad de reparación (1=máxima … 4=ruido; 0=no aplica).
 *  1 = high-confidence + gap real + alto valor
 *  2 = high-confidence (o gap real con extracción directa)
 *  3 = needs-review / JS / proxy con gap
 *  4 = agregador/ruido
 */
export function prioridadReparacion(
  estado: EstadoFuente,
  gapCount: number,
  altoValor: boolean,
): number {
  if (estado === 'LOW_VALUE_AGGREGATOR' || estado === 'PC_NOISE') return 4;
  if (estado === 'READY_KEEP_CURRENT' || estado === 'READY_SITEMAP_INDEX' || estado === 'DO_NOT_TOUCH') return 0;
  if (ESTADOS_REPARABLES_HIGH.has(estado)) {
    if (gapCount > 0) return altoValor ? 1 : 2;
    return 2; // reparable validado aunque no haya gap PC todavía
  }
  if (estado === 'REPAIRABLE_NEEDS_REVIEW') return 3;
  if (estado === 'JS_REQUIRED' || estado === 'PROXY_REQUIRED') return gapCount > 0 ? 3 : 0;
  if (estado === 'DIRECT_EXTRACTION_ONLY' || estado === 'DISCOVERY_GAP') {
    return gapCount > 0 ? (altoValor ? 1 : 2) : 0;
  }
  return 0;
}

/** Detecta si una URL apunta a un sitemap de noticias (preferible al índice). */
export function esNewsSitemap(url: string): boolean {
  return /news[-_]?sitemap|sitemap[-_]?news|googlenews/i.test(url);
}

/**
 * Genera las URLs candidatas a probar para un medio (orden de preferencia).
 * Incluye las configuradas primero y luego rutas comunes sobre url_base.
 */
export function urlsCandidatas(input: {
  url_base: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
}): { rss: string[]; sitemap: string[]; robots: string | null; page: string | null } {
  const base = (input.url_base ?? '').replace(/\/+$/, '');
  const rss: string[] = [];
  const sitemap: string[] = [];

  if (input.rss_url) rss.push(input.rss_url);
  if (input.sitemap_url) sitemap.push(input.sitemap_url);

  if (base) {
    for (const p of ['/feed', '/rss', '/rss.xml', '/index.xml', '/feedburner.xml', '/?feed=rss2']) {
      const u = base + p;
      if (!rss.includes(u)) rss.push(u);
    }
    for (const p of [
      '/news-sitemap.xml', '/sitemaps/googlenews.xml', '/sitemap-news.xml',
      '/post-sitemap.xml', '/sitemap.xml', '/sitemap_index.xml',
    ]) {
      const u = base + p;
      if (!sitemap.includes(u)) sitemap.push(u);
    }
  }

  return {
    rss,
    sitemap,
    robots: base ? `${base}/robots.txt` : null,
    page: base || null,
  };
}

/** Marca el umbral de items para considerar un sitemap "índice masivo". */
export const UMBRAL_INDICE_MASIVO = INDICE_MASIVO_ITEMS;
