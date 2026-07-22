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
// laboral) y precisión alta.
//   - Uno TV  (MED-0025): ~4.5 menciones útiles/100, sin prefiltro.
//   - Publimetro (MED-0053): ~3.0/100 pero 46% deportes/espectáculos → prefiltro título.
//   - Milenio (MED-0030): alta 2026-07-17 (lote PATRON P1 MEDIA GAP CLOSURE),
//     REVIERTE la exclusión previa "NO_TOCAR (ruido/volumen)" de
//     `docs/MEDIA_PARITY_MATRIX.md`/`docs/PATRON_IMPORTANT_MEDIA_READINESS.md` §4,
//     por autorización explícita del usuario informada por auditoría editorial
//     externa (P1 crítico para Patrón, CATALOGO_NO_CRON). Viabilidad técnica
//     reconfirmada (`audit-media-sources`: READY_SITEMAP_INDEX, conf=1.0, sin
//     proxy/JS). El hallazgo previo de ruido (~230 notas/lote, 7 menciones,
//     "crimen/FIFA") es de VOLUMEN de `01_Noticias_Raw`, no de falsos positivos
//     de detección (las menciones siguen gateadas por keyword real); se acota
//     con prefiltro_titulo=true (bloquea mundial/fútbol/deportes existentes en
//     `nationalPrefilter.ts`) y max_notas_shadow=30 (por debajo de Publimetro).
//   - Aristegui Noticias (MED-0008): alta 2026-07-20 (lote NATIONAL MEDIA
//     COVERAGE RAMP), sub-lote de 4 candidatos evaluado (Animal Político,
//     Aristegui, 24 Horas, NTR Guadalajara) — solo Aristegui pasó viabilidad
//     técnica limpia (`news-sitemap.xml` verificado en vivo, artículos del
//     mismo día, sin proxy/JS, ya READY en catálogo). Los otros 3 NO se
//     agregaron: 24 Horas sigue bloqueada (403, confirmado otra vez), Animal
//     Político devuelve una página "offline"/placeholder en su sitemap (no
//     confirmable sin más investigación), NTR Guadalajara solo tiene secciones
//     en su sitemap.xml (no URLs de artículos — requeriría extracción directa,
//     no el patrón estándar). Mismo perfil que Milenio: sitio nacional
//     político de alto volumen → prefiltro_titulo=true, max_notas_shadow=30.
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
  {
    medio_id: 'MED-0030',
    nombre: 'Milenio',
    frecuencia_shadow: '6h',
    max_notas_shadow: 30,
    prefiltro_titulo: true,
    activo_shadow: true,
  },
  {
    medio_id: 'MED-0008',
    nombre: 'Aristegui Noticias',
    frecuencia_shadow: '6h',
    max_notas_shadow: 30,
    prefiltro_titulo: true,
    activo_shadow: true,
  },
  {
    // Lote NATIONAL MEDIA COVERAGE RAMP (2026-07-20): El Universal estaba
    // BLOQUEADO (404 en /sitemap.xml, activo=false) desde hace semanas.
    // Reparado vía `scripts/repair-el-universal-source.ts`: robots.txt expone
    // el feed real de Arc Publishing (`/arc/outboundfeeds/news/?outputType=xml`),
    // verificado en vivo y con crawl real (20/20 notas nuevas, 0 errores).
    // Sin proxy/JS. Mismo perfil que Milenio/Aristegui (nacional alto volumen).
    medio_id: 'MED-0011',
    nombre: 'El Universal',
    frecuencia_shadow: '6h',
    max_notas_shadow: 30,
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
  {
    // Lote Paridad (2026-07-08): EN_CATALOGO_NO_CRON con el mayor gap PC (28 notas,
    // 3 clientes, sobre todo CLI-0002 Bebidas alcohólicas). Auditoría READY_KEEP_CURRENT
    // (conf 1.0, RSS), extracción EXCELENTE (102/102 con texto, 100%). Detect dry-run
    // limpio (0 FP de cliente real, sin flood). Net-new: no estaba en ningún cron.
    // Alta como cobertura forward (shadow, sin envíos); captura contenido de cliente
    // conforme se publique.
    medio_id: 'MED-0005',
    nombre: 'lado.mx',
    fuente: 'auto',
    max_notas_shadow: 30,
    activo_shadow: true,
  },
  {
    // Lote Paridad (2026-07-08): EN_CATALOGO_NO_CRON, 2º mayor gap PC (14 notas,
    // 3 clientes). Auditoría READY_SITEMAP_INDEX (conf 1.0), extracción EXCELENTE
    // (70/70 con texto, 100%). Detect dry-run limpio (sin flood, sin FP de cliente
    // real). Net-new. Alta como cobertura forward (shadow, sin envíos).
    medio_id: 'MED-0049',
    nombre: 'Telediario Monterrey',
    fuente: 'auto',
    max_notas_shadow: 30,
    activo_shadow: true,
  },
  {
    // Lote Fast-Track P1 (2026-07-11): EN_CATALOGO_NO_CRON, mayor gap PC del lote
    // (9 notas). Reparado de estado=error a REPAIRABLE_RSS_HIGH_CONFIDENCE (conf 1.0,
    // https://www.excelsior.com.mx/rss) vía audit-media-sources --update-db. Sin
    // historial de crawl aún (0 noticias en Ethos): validación de FP pendiente del
    // primer ciclo shadow-daily-validated-tier (gate detect dry-run).
    medio_id: 'MED-0028',
    nombre: 'Excelsior',
    fuente: 'auto',
    max_notas_shadow: 30,
    activo_shadow: true,
  },
  {
    // Lote Fast-Track P1 (2026-07-11): EN_CATALOGO_NO_CRON, gap PC=1. Reparado a
    // REPAIRABLE_SITEMAP_HIGH_CONFIDENCE (conf 1.0, sitemap outboundfeeds) vía
    // audit-media-sources --update-db. Sin historial de crawl aún; validación de
    // FP pendiente del primer ciclo shadow-daily-validated-tier (gate detect dry-run).
    medio_id: 'MED-0084',
    nombre: 'Frontera',
    fuente: 'auto',
    max_notas_shadow: 30,
    activo_shadow: true,
  },
  {
    // Lote Fast-Track P1 (2026-07-11): EN_CATALOGO_NO_CRON, gap PC=4 (2 clientes).
    // Auditoría READY_KEEP_CURRENT (conf 1.0, RSS ya validado). Sin historial de
    // crawl aún; validación de FP pendiente del primer ciclo shadow-daily-validated-tier.
    medio_id: 'MED-0055',
    nombre: 'Noroeste',
    fuente: 'auto',
    max_notas_shadow: 30,
    activo_shadow: true,
  },
  {
    // Lote PATRON P1 MEDIA GAP CLOSURE (2026-07-17): NO_CATALOGADO → catalogado vía
    // `scripts/catalog-patron-p1-gap-media.ts` (MED-0172). P2 Guanajuato (zona de
    // crisis tequilera), news-sitemap.xml (Yoast/Jetpack) verificado en vivo con
    // artículos recientes. Sin proxy/JS. Net-new (no cubierto por ningún otro cron).
    medio_id: 'MED-0172',
    nombre: 'AM León',
    fuente: 'auto',
    max_notas_shadow: 30,
    activo_shadow: true,
  },
  {
    // Lote PATRON P1 MEDIA GAP CLOSURE (2026-07-17): NO_CATALOGADO → catalogado vía
    // `scripts/catalog-patron-p1-gap-media.ts` (MED-0173). Fuente primaria sectorial
    // (Consejo Regulador del Tequila, boletines/comunicados oficiales) — NO es
    // "CRT tech" (ver guard editorial en `consolidation.ts`). Sitemap de posts
    // verificado en vivo (wp-sitemap-posts-post-1.xml). Volumen bajo (institucional):
    // max_notas_shadow reducido. Sin proxy/JS. Net-new.
    medio_id: 'MED-0173',
    nombre: 'Consejo Regulador del Tequila (CRT)',
    fuente: 'auto',
    max_notas_shadow: 20,
    activo_shadow: true,
  },
  // ── Lote ETHOS 200 MEDIA NEWS LAKE (2026-07-20) ────────────────────────────
  // 10 de 12 medios catalogados en `scripts/catalog-national-expansion-lote1.ts`
  // entran a cron inmediato (máx. 10 por fase, per la regla de esta fase).
  // Merca2.0 (MED-0184) y El CEO (MED-0185) quedan catalogados pero SIN cron
  // (prioridad baja para Jumex/Patrón) — candidatos a un lote futuro.
  // Todos verificados en vivo (sitemap real, artículos recientes) antes de
  // catalogar. Validación de FP pendiente del primer ciclo real (gate detect
  // dry-run de este mismo tier), igual que todos los altas anteriores.
  {
    medio_id: 'MED-0175', nombre: 'SDP Noticias', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true,
  },
  {
    medio_id: 'MED-0176', nombre: 'Bloomberg Línea México', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true,
  },
  {
    medio_id: 'MED-0177', nombre: 'DPL News', fuente: 'auto', max_notas_shadow: 20, activo_shadow: true,
  },
  {
    medio_id: 'MED-0178', nombre: 'N+', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true,
  },
  {
    medio_id: 'MED-0179', nombre: 'ADN40', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true,
  },
  {
    medio_id: 'MED-0180', nombre: 'TV Azteca Noticias', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true,
  },
  {
    medio_id: 'MED-0181', nombre: 'MVS Noticias', fuente: 'auto', max_notas_shadow: 20, activo_shadow: true,
  },
  {
    medio_id: 'MED-0182', nombre: 'Diario de Yucatán', fuente: 'auto', max_notas_shadow: 20, activo_shadow: true,
  },
  {
    medio_id: 'MED-0183', nombre: 'Contralínea', fuente: 'auto', max_notas_shadow: 20, activo_shadow: true,
  },
  {
    medio_id: 'MED-0174', nombre: 'Alto Nivel', fuente: 'auto', max_notas_shadow: 20, activo_shadow: true,
  },
  // ── Lote ETHOS 200 MEDIA NEWS LAKE — 2da expansión (2026-07-20) ────────────
  // Solo 2 candidatos nuevos pasaron viabilidad limpia esta vez (la mayoría de
  // los ~30 candidatos revisados ya estaban catalogados con otro nombre o ya
  // se habían descartado en la fase anterior). Ambos verificados en vivo.
  {
    medio_id: 'MED-0186', nombre: 'Político MX', fuente: 'auto', max_notas_shadow: 20, activo_shadow: true,
  },
  {
    medio_id: 'MED-0187', nombre: 'AF Medios', fuente: 'auto', max_notas_shadow: 20, activo_shadow: true,
  },
  // ── NEWS LAKE 200 FINAL PUSH (2026-07-22) ──────────────────────────────────
  // Merca2.0 y El CEO estaban catalogados desde el lote 2026-07-20 pero SIN
  // cron (prioridad baja). Se activan ahora para ampliar cobertura operativa.
  // Catálogo NO aumenta (ya eran MED-0184 / MED-0185); solo aumentan medios
  // leídos por cron. Límite bajo (15 notas) para validar calidad antes de
  // subir. sitemap_index.xml verificado en vivo, sin proxy, sin JavaScript.
  {
    medio_id: 'MED-0184', nombre: 'Merca2.0', fuente: 'auto', max_notas_shadow: 15, activo_shadow: true,
  },
  {
    medio_id: 'MED-0185', nombre: 'El CEO', fuente: 'auto', max_notas_shadow: 15, activo_shadow: true,
  },
  // PorEsto (MED-0189) — A_PUBLICO_FACIL, RSS verificado en vivo 2026-07-22.
  // Cobertura: Yucatán/Sureste. Catálogo AUMENTA en 1 (lote3 + cron simultáneo).
  {
    medio_id: 'MED-0189', nombre: 'PorEsto', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true,
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
