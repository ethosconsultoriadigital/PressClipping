/**
 * Lista curada de medios ESTABLES para el cron en MODO SOMBRA.
 *
 * Módulo PURO de configuración: NO importa scripts, NO ejecuta nada, NO hace
 * crawl, NO toca DB ni Sheets. Importarlo es seguro y libre de efectos
 * colaterales (se puede usar desde scripts, tests y diagnósticos read-only).
 *
 * No incluye Reforma (paywall), 24 Horas / El Siglo de Torreón (403),
 * ni medios DIRECT_EXTRACTION_ONLY / NO_FEED / BLOCKED / TIMEOUT.
 */
export const SHADOW_MEDIOS: readonly string[] = [
  'MED-0001', // El Economista
  'MED-0017', // El Informador
  'MED-0145', // Forbes Mexico
  'MED-0148', // EdoMex Al Día
  'MED-0151', // Hospitalitas
  'MED-0152', // Xataka México
  'MED-0153', // Zócalo
  'MED-0154', // La Crónica de Hoy
  'MED-0155', // Vanguardia
  'MED-0156', // El Financiero
  'MED-0157', // El Heraldo de México
  'MED-0158', // El Sol de México
  'MED-0159', // Expansión
  'MED-0160', // El Diario de Chihuahua
  'MED-0161', // Amexi
  'MED-0162', // ContraRéplica
  'MED-0163', // Líder Empresarial
  'MED-0164', // Periódico Correo
  'MED-0165', // Notus Noticias
  'MED-0166', // Hidrocálido Digital
  'MED-0167', // Food And Pleasure
  'MED-0020', // El Imparcial
  'MED-0031', // Proceso
  'MED-0034', // La Razón
  'MED-0060', // Los Noticieristas
] as const;

// ============================================================================
// TIER NACIONAL B — medios nacionales de alto volumen, cron sombra cada 6h.
// ----------------------------------------------------------------------------
// Bloque SEPARADO de la lista base (SHADOW_MEDIOS). NO modifica el cron base de
// 25 medios. Solo entran medios nacionales con señal real validada (Reforma
// laboral) y precisión alta. Milenio y Aristegui NO entran todavía.
//   - Uno TV  (MED-0025): ~4.5 menciones útiles/100, sin prefiltro.
//   - Publimetro (MED-0053): ~3.0/100 pero 46% deportes/espectáculos → prefiltro título.
// ============================================================================

export type FrecuenciaShadow = '2h' | '6h' | 'diario';

export interface ShadowMedioNacional {
  medio_id: string;
  nombre: string;
  frecuencia_shadow: FrecuenciaShadow;
  /** Tope superior de notas por corrida para este medio (política de tier). */
  max_notas_shadow: number;
  /** Aplica prefiltro determinístico de título (anti deportes/espectáculos). */
  prefiltro_titulo: boolean;
  activo_shadow: boolean;
}

export const SHADOW_MEDIOS_NACIONALES_B: readonly ShadowMedioNacional[] = [
  {
    medio_id: 'MED-0025',
    nombre: 'Uno TV Noticias',
    frecuencia_shadow: '6h',
    max_notas_shadow: 50,
    prefiltro_titulo: false,
    activo_shadow: true,
  },
  {
    medio_id: 'MED-0053',
    nombre: 'Publimetro',
    frecuencia_shadow: '6h',
    max_notas_shadow: 40,
    prefiltro_titulo: true,
    activo_shadow: true,
  },
] as const;

/** medio_id activos del tier nacional indicado (hoy solo 'B'). */
export function mediosNacionalesActivos(tier: 'B' = 'B'): ShadowMedioNacional[] {
  if (tier !== 'B') return [];
  return SHADOW_MEDIOS_NACIONALES_B.filter((m) => m.activo_shadow);
}

// ============================================================================
// TIER CRISIS — cron sombra dedicado a fuentes con señal de crisis validada.
// ----------------------------------------------------------------------------
// Bloque SEPARADO de SHADOW_MEDIOS y del tier nacional B. Pensado para medios
// donde el BACKFILL POR SITEMAP recuperó notas de crisis (tequila/alcohol
// adulterado) que el RSS ya había rotado, con precisión alta y FP ~0.
//
// Miembros:
//   - UNO MAS UNO (MED-0170): el sitemap recuperó crisis real, con 3 P1 y 0 FP.
//     Usa fuente=sitemap (no RSS) porque el RSS pierde las notas antes de crawlear.
//   - El Sol de Irapuato (MED-0169): red OEM/El Sol; el extractor storyline
//     recuperó cuerpos completos y el re-detect dirigido validó crisis CLI-0002
//     real (alcohol/tequila adulterado, +12 menciones, 11 P1 shadow, FP ~8%).
//     Usa fuente=RSS (OEM público); NO tiene sitemap propio → NUNCA forzar sitemap.
//   - El Otro Enfoque (MED-0171): tras el fix de extractor (contaminación/teasers)
//     quedó limpio (210 notas, 96% calidad alta, mediana 1677 chars) con señal
//     crisis real (12 menciones CLI-0002 tequila adulterado Guanajuato + 3 CLI-0003).
//     Usa fuente=RSS (?feed=rss2, feed de artículos limpio): evita reintroducir
//     listings/boilerplate que el sitemap_index podría traer dado su historial.
//   - Periódico Correo (MED-0164): re-enrich acotado (2026-07-08) reparó 216 notas
//     CRAWLED_BUT_NOT_ENRICHED (cuerpo 22%->0%, calidad alta, html_article, sin JS).
//     Detect real acotado insertó 9 menciones CLI-0002 (tequila x2, alcohol/tequila
//     adulterado P1, FP ~0%) y la crisis "tequila Centenario / intoxicaciones
//     Guanajuato" quedó como MATCH_REAL en 48h. Usa fuente=sitemap (metodo=SITEMAP,
//     sin RSS). YA está en SHADOW_MEDIOS (base daily); el alta al tier crisis lo
//     sube a 6h para capturar crisis regional de GTO antes de que rote el sitemap.
//
// Cada medio se crawlea con SU fuente_preferida (loop por medio); no se fuerza
// una única fuente global. NO integra alertas reales (solo observación
// shadow-alerts).
// ============================================================================

export type FuenteShadow = 'rss' | 'sitemap';

export interface ShadowMedioCrisis {
  medio_id: string;
  nombre: string;
  /** Fuente preferida para el backfill/crawl del tier (sitemap recupera crisis). */
  fuente_preferida: FuenteShadow;
  frecuencia_shadow: FrecuenciaShadow;
  /** Tope superior de notas por corrida para este medio. */
  max_notas_shadow: number;
  activo_shadow: boolean;
}

export const SHADOW_MEDIOS_CRISIS: readonly ShadowMedioCrisis[] = [
  {
    medio_id: 'MED-0170',
    nombre: 'UNO MAS UNO',
    fuente_preferida: 'sitemap',
    frecuencia_shadow: '6h',
    max_notas_shadow: 80,
    activo_shadow: true,
  },
  {
    medio_id: 'MED-0169',
    nombre: 'El Sol de Irapuato',
    fuente_preferida: 'rss',
    frecuencia_shadow: '6h',
    max_notas_shadow: 60,
    activo_shadow: true,
  },
  {
    medio_id: 'MED-0171',
    nombre: 'El Otro Enfoque',
    fuente_preferida: 'rss',
    frecuencia_shadow: '6h',
    max_notas_shadow: 60,
    activo_shadow: true,
  },
  {
    medio_id: 'MED-0164',
    nombre: 'Periódico Correo',
    fuente_preferida: 'sitemap',
    frecuencia_shadow: '6h',
    max_notas_shadow: 60,
    activo_shadow: true,
  },
] as const;

/** medio_id (config) activos del tier crisis. */
export function mediosCrisisActivos(): ShadowMedioCrisis[] {
  return SHADOW_MEDIOS_CRISIS.filter((m) => m.activo_shadow);
}

// ============================================================================
// TIER DAILY VALIDATED — cron sombra diario de medios VALIDADOS net-new.
// ----------------------------------------------------------------------------
// Bloque SEPARADO de SHADOW_MEDIOS (base), nacional B y crisis. Solo entran
// medios que en un lote de extracción tuvieron:
//   - READY + texto BUENO/EXCELENTE
//   - detección real limpia (FP estimado aceptable, sin flood, sin boilerplate)
//   - y que NO están cubiertos por ningún otro cron (net-new).
//
// La función `mediosDailyNetNew()` deduplica ESTRUCTURALMENTE contra las tres
// capas existentes: aunque alguien liste aquí un medio ya cubierto, el tier lo
// filtra y nunca lo crawlea dos veces por cron.
//
// Origen (Lote B, 2026-07-03): Zeta Tijuana (MED-0083) y Revista Espejo
// (MED-0066) — ambos net-new, EXCELENTE, detección CLI-0003 laboral limpia.
// ============================================================================

export type FuenteDaily = 'auto' | 'rss' | 'sitemap';

export interface ShadowMedioDaily {
  medio_id: string;
  nombre: string;
  /** Fuente para el crawl del tier. 'auto' = cascada configurada del medio. */
  fuente: FuenteDaily;
  /** Tope superior de notas por corrida para este medio (política de tier). */
  max_notas_shadow: number;
  activo_shadow: boolean;
}

export const SHADOW_MEDIOS_DAILY_VALIDATED: readonly ShadowMedioDaily[] = [
  {
    medio_id: 'MED-0083',
    nombre: 'Zeta Tijuana',
    fuente: 'auto',
    max_notas_shadow: 30,
    activo_shadow: true,
  },
  {
    medio_id: 'MED-0066',
    nombre: 'Revista Espejo',
    fuente: 'auto',
    max_notas_shadow: 30,
    activo_shadow: true,
  },
  {
    // Lote C (2026-07-06): net-new, calidad alta (mediana ~3499 chars),
    // detección real limpia (3 CLI-0003 laboral, FP 0). Fuente sitemap propio.
    medio_id: 'MED-0006',
    nombre: 'marcomares.com.mx',
    fuente: 'auto',
    max_notas_shadow: 30,
    activo_shadow: true,
  },
  {
    // Lote C (2026-07-06): net-new, calidad alta (128/129), detección real
    // limpia (1 CLI-0003 laboral). Fuente sitemap propio.
    medio_id: 'MED-0012',
    nombre: 'Paralelo 19',
    fuente: 'auto',
    max_notas_shadow: 30,
    activo_shadow: true,
  },
] as const;

/**
 * Conjunto de medio_id YA cubiertos por algún cron sombra existente
 * (base + nacional B + crisis). Fuente de verdad para el dedupe.
 */
export function mediosYaCubiertosPorCron(): Set<string> {
  const s = new Set<string>(SHADOW_MEDIOS);
  for (const m of SHADOW_MEDIOS_NACIONALES_B) s.add(m.medio_id);
  for (const m of SHADOW_MEDIOS_CRISIS) s.add(m.medio_id);
  return s;
}

/** medio_id (config) activos del tier daily-validated. */
export function mediosDailyValidatedActivos(): ShadowMedioDaily[] {
  return SHADOW_MEDIOS_DAILY_VALIDATED.filter((m) => m.activo_shadow);
}

/**
 * Medios NET-NEW del tier daily-validated: activos y NO cubiertos por ningún
 * otro cron. Deduplicación estructural: garantiza que el tier nunca crawlee por
 * cron un medio ya cubierto por base/nacional B/crisis.
 */
export function mediosDailyNetNew(): ShadowMedioDaily[] {
  const cubiertos = mediosYaCubiertosPorCron();
  return mediosDailyValidatedActivos().filter((m) => !cubiertos.has(m.medio_id));
}
