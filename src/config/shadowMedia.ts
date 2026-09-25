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

export const DAILY_VALIDATED_SHARDS = ['A', 'B', 'C'] as const;
export type DailyValidatedShard = (typeof DAILY_VALIDATED_SHARDS)[number];

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
  // ── 200 MEDIA MILESTONE (2026-07-22) ────────────────────────────────────────
  // 8 nuevos en cron: ZonaDocs, Pie de Página, Chiapas Paralelo, Quadratín
  // Nacional, Tabasco Hoy, El Imparcial Oaxaca, 8 Columnas, DesInformémonos.
  // Todos A_PUBLICO_FACIL RSS verificados en vivo. Eje Central (MED-0200)
  // NO se incluye aquí — ALTO VOLUMEN (1357+/mes), evaluar antes de activar.
  { medio_id: 'MED-0192', nombre: 'ZonaDocs', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0193', nombre: 'Pie de Página', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0194', nombre: 'Chiapas Paralelo', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0195', nombre: 'Quadratín Nacional', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0196', nombre: 'Tabasco Hoy', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0197', nombre: 'El Imparcial Oaxaca', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0198', nombre: '8 Columnas', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0199', nombre: 'DesInformémonos', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  // ── Mery Jalisco Priority (2026-07-29) ─────────────────────────────────────
  // Medios Jalisco/regional con señal histórica de Mery Pozos — nuevos en catálogo.
  // Los 5 medios ACTIVAR_EN_CRON (UDG TV/Canal 44, Notisistema, Tráfico ZMG,
  // Vallarta Independiente, Partidero) ya existen en Supabase; ejecutar:
  //   npm run catalog-mery-jalisco-priority -- --upsert --patch-shadowmedia
  // para descubrir sus IDs y agregar sus entradas a este bloque automáticamente.
  //
  // MED-0204 (Página 24 Jalisco) se RETIRA del cron (2026-09-18): quedó como
  // PLANNED_NOT_ONBOARDED — el alta del lote nunca insertó su fila en `medios`
  // (RSS y sitio base con timeout 3/3, ver docs/MERY_GAP_CLOSURE_2026-08-24.md
  // §3.2). Configurarlo sin fila de catálogo hacía que el tier pidiera 48 IDs y
  // resolviera 47 en silencio. Reonboardearlo exige alta de fuente aprobada, no
  // reponer la entrada aquí.
  { medio_id: 'MED-0201', nombre: 'Semanario Conciencia Pública', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0202', nombre: 'A Fondo Jalisco', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0203', nombre: 'Siker', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  // ── OPERATIONALIZATION-BATCH-01 (2026-09-17) ───────────────────────────────
  // 10 medios B2 PASS Validator V1, RSS, evidence COMPLETE, ELIGIBLE_FOR_PROMOTION,
  // human-reviewed, NOT_IN_CRON. Alta neta al daily-validated (máx. 10 por fase).
  // No toca base / nacional B / crisis. max_notas_shadow=15 igual que el lote RSS
  // 200 MEDIA MILESTONE. Captura real queda pendiente del próximo schedule diario.
  { medio_id: 'MED-0029', nombre: 'La Jornada', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0039', nombre: 'El Occidental', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0057', nombre: 'Linea Directa Portal', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0069', nombre: 'El Sol de San Luis', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0099', nombre: 'BCS Noticias', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0115', nombre: 'DK 1250', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0126', nombre: 'Noticias PV', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0149', nombre: 'Líderes Mexicanos', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0150', nombre: 'Coolhuntermx', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0168', nombre: 'López Dóriga Digital', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
] as const;

// ============================================================================
// TIER DAILY VALIDATED — SHARD B (ramp controlado, 2026-09-22).
// ----------------------------------------------------------------------------
// Bloque SEPARADO de SHADOW_MEDIOS_DAILY_VALIDATED (shard A, 47 IDs). El motor
// es el mismo (`run-shadow-daily-validated-tier.ts --shard=B`).
// Ramp 8→16→21→24: lote 1 + lote 2 + wave-05 LOW_RISK (5 IDs) + repair
// sprint 06 (La Brecha, Punto MX, Radar Político BCS). MED-0118
// (boilerplate) queda fuera. Net-new respecto de base / nacional B / crisis /
// shard A. Nombres desde catálogo live.
// ============================================================================

export const SHADOW_MEDIOS_DAILY_VALIDATED_B: readonly ShadowMedioDaily[] = [
  { medio_id: 'MED-0019', nombre: 'Noticias de Cuautla', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0024', nombre: 'Revista 360 Grados', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0026', nombre: 'Exclusivas Puebla', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0040', nombre: 'UDG TV Canal 44', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0041', nombre: 'Quadratin Jalisco', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0042', nombre: 'Partidero', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0051', nombre: 'Posta', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0103', nombre: 'El Peninsular Digital', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0107', nombre: 'Diario Humano', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0191', nombre: 'La Silla Rota', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0007', nombre: 'Fortuna y Poder', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0058', nombre: 'Luz Noticias', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0092', nombre: 'Radar BC', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0111', nombre: 'MetrópoliMx BCS', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0064', nombre: 'Mazatlan Interactivo', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0109', nombre: 'Canal 8 BCS', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0113', nombre: 'Jalisco TV', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0044', nombre: 'Lider Informativo', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0014', nombre: 'Ola Noticias', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0086', nombre: 'El Mexicano', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0130', nombre: 'Letra Fria', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0081', nombre: 'La Brecha', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0063', nombre: 'Punto MX', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
  { medio_id: 'MED-0105', nombre: 'Radar Político BCS', fuente: 'auto', max_notas_shadow: 30, activo_shadow: true },
] as const;

export const IDS_DAILY_VALIDATED_B: readonly string[] = SHADOW_MEDIOS_DAILY_VALIDATED_B.map(
  (m) => m.medio_id,
);

// ============================================================================
// TIER DAILY VALIDATED — SHARD C (C90, 2026-09-25). Schedule 13:55 UTC.
// ----------------------------------------------------------------------------
// Bloque SEPARADO de A (47) y B (24). C79 (79) + 11 READY STRICT de Batch05.
// MED-0224 Cúspide México se EXCLUYE (403 LIVE en predeploy; no se sustituye).
// MED-0225/0232 REVIEW_THRESHOLD no entran. MED-0213 CONTENT_HOLD no entra.
// Batch03 holds NO entran: 0235/0238/0239 CONTENT/REVIEW, 0243/0249/0254 REVIEW.
// Batch04 holds NO entran: 0260/0264/0272/0274 REVIEW, 0276/0278 SOURCE_HOLD,
// 0282/0287 CONTENT_HOLD.
// Batch05 holds NO entran: 0288/0301/0303/0304/0307 CONTENT_HOLD,
// 0289/0296/0299 REVIEW, 0300 SOURCE_HOLD.
// MED-0043 ZonaDocs DUPLICATE_HOLD. MED-0118 El Respetable CONTENT_HOLD.
// Colima Digital es alias de MED-0242 Colima Noticias (un solo ID).
// fuente=rss o sitemap según catálogo. max_notas_shadow=15.
// ============================================================================

export const SHADOW_MEDIOS_DAILY_VALIDATED_C: readonly ShadowMedioDaily[] = [
  { medio_id: 'MED-0106', nombre: 'El Informante BCS', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0124', nombre: 'Vallarta Independiente', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0072', nombre: 'San Luis Hoy', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0080', nombre: 'Astrolabio Diario Digital', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0093', nombre: 'Periodismo Negro', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0122', nombre: 'Tribuna de la Bahia', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0018', nombre: 'Reporte18', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0022', nombre: 'Potosi Noticias', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0009', nombre: 'Alcance Diario', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0116', nombre: 'Trafico ZMG', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0091', nombre: 'Punto Norte', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0138', nombre: 'TV4 Lagos / Altos', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0036', nombre: 'Chilango', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0101', nombre: 'Diario El Independiente BCS', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0052', nombre: 'Hora Cero', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0062', nombre: 'Cafe Negro Portal', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0095', nombre: 'Cadena Noticias', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0205', nombre: 'Hoy En Perspectiva', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0206', nombre: 'Jalisco Hoy', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0210', nombre: 'Hoja De Ruta Digital', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0211', nombre: 'Cadena Política', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0212', nombre: 'Punto por Punto', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0214', nombre: 'Jlanoticias', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0215', nombre: 'El Tiempo de Monclova', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0216', nombre: 'AlMomento.mx', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0217', nombre: 'La Jornada Aguascalientes', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0218', nombre: 'Nuevolaredo.tv', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0219', nombre: 'Marcrix Noticias', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0220', nombre: 'Ovaciones', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0221', nombre: 'El Liberal Metropolitano', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0222', nombre: 'La Prensa De Monclova', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0223', nombre: 'Talajalisco noticias', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0226', nombre: 'Mass Informacion', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0227', nombre: 'Tigmx', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0228', nombre: 'La Jornada Estado de México', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0229', nombre: 'La Jornada de Oriente', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0230', nombre: 'Libertador', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0231', nombre: 'Es Noticia Veracruz', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0233', nombre: 'Periodismo Y Ambiente', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0234', nombre: 'Expreso.press', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0236', nombre: 'LA JORNADA BAJA CALIFORNIA', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0237', nombre: 'Juárez Noticias', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0240', nombre: 'Reto Diario', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0241', nombre: 'Notiver', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0242', nombre: 'Colima Noticias', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0244', nombre: 'Tus Buenas Noticias', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0245', nombre: 'Eldespertadorqr.com', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0246', nombre: 'El Momento Quintana Roo', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0247', nombre: 'Mayacomunicacion.com.mx', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0248', nombre: 'Noticiero Altavoz', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0250', nombre: 'Candelero', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0251', nombre: 'Cco Noticias Corporación Comunicativa Ojeda', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0252', nombre: 'La Gazzetta DF', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0253', nombre: 'Tribuna del Yaqui', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0255', nombre: 'Plaza de Armas', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0256', nombre: 'Segundo a Segundo', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0257', nombre: 'Dominiopublico', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0258', nombre: 'La Región Tula', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0259', nombre: 'Arsenal Diario Digital', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0261', nombre: 'Dereporteros', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0262', nombre: 'La Jiribilla', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0263', nombre: 'Sociedad Noticias', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0265', nombre: 'Quintana Roo Hoy', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0266', nombre: 'Al Chile Poblano', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0267', nombre: 'EstamosAquí MX', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0268', nombre: 'El Diario de Delicias', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0269', nombre: 'El Diariodel Noroeste', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0270', nombre: 'El Diario de Parral', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0271', nombre: 'El Diario de Juárez', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0273', nombre: 'Vox Populi Noticias', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0275', nombre: 'Luces del Siglo Diario', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0277', nombre: 'Hoy Tamaulipas', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0279', nombre: 'Tutucuman', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0280', nombre: 'TV Azteca Jalisco', fuente: 'sitemap', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0281', nombre: 'Notigram', fuente: 'sitemap', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0283', nombre: 'Mimorelia', fuente: 'sitemap', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0284', nombre: 'Novedades Quintana Roo', fuente: 'sitemap', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0285', nombre: 'Canal 13', fuente: 'sitemap', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0286', nombre: 'Netnoticias', fuente: 'sitemap', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0290', nombre: 'La Voz de Michoacán', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0291', nombre: 'La Jornada San Luis', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0292', nombre: 'Diario de Morelos', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0293', nombre: 'Contramuro Noticias de Michoacán', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0294', nombre: 'NotiMx', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0295', nombre: 'Diario de México', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0297', nombre: 'Codigo Qro', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0298', nombre: 'Sobre T', fuente: 'rss', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0302', nombre: 'Noventa Grados', fuente: 'sitemap', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0305', nombre: 'Grupomarmor Informa', fuente: 'sitemap', max_notas_shadow: 15, activo_shadow: true },
  { medio_id: 'MED-0306', nombre: 'El Gráfico', fuente: 'sitemap', max_notas_shadow: 15, activo_shadow: true },
] as const;

export const IDS_DAILY_VALIDATED_C: readonly string[] = SHADOW_MEDIOS_DAILY_VALIDATED_C.map(
  (m) => m.medio_id,
);

/** Parsea `--shard`. Ausente → A. Vacío u otro valor (incl. D) → inválido. */
export function parseDailyValidatedShard(
  raw: string | undefined,
): { ok: true; shard: DailyValidatedShard } | { ok: false; raw: string } {
  if (raw === undefined) return { ok: true, shard: 'A' };
  const v = raw.trim().toUpperCase();
  if (v === 'A' || v === 'B' || v === 'C') return { ok: true, shard: v };
  return { ok: false, raw };
}

/**
 * Config del shard. Switch EXHAUSTIVO: C NUNCA cae en A.
 * Un shard nuevo sin case debe fallar en compile (`never`).
 */
export function configDailyValidated(shard: DailyValidatedShard = 'A'): readonly ShadowMedioDaily[] {
  switch (shard) {
    case 'A':
      return SHADOW_MEDIOS_DAILY_VALIDATED;
    case 'B':
      return SHADOW_MEDIOS_DAILY_VALIDATED_B;
    case 'C':
      return SHADOW_MEDIOS_DAILY_VALIDATED_C;
    default: {
      const _exhaustivo: never = shard;
      throw new Error(`Shard daily-validated no soportado: ${String(_exhaustivo)}`);
    }
  }
}

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

/** medio_id (config) activos de un shard daily-validated. Default: A. */
export function mediosDailyValidatedActivos(shard: DailyValidatedShard = 'A'): ShadowMedioDaily[] {
  return configDailyValidated(shard).filter((m) => m.activo_shadow);
}

/** Todos los medios activos de todos los shards daily-validated. */
export function mediosDailyValidatedTodosActivos(): ShadowMedioDaily[] {
  const out: ShadowMedioDaily[] = [];
  for (const shard of DAILY_VALIDATED_SHARDS) out.push(...mediosDailyValidatedActivos(shard));
  return out;
}

export interface DailyShardOverlap {
  medio_id: string;
  shards: DailyValidatedShard[];
}

/** Un medio en más de un shard daily activo. */
export function solapesEntreDailyShards(): DailyShardOverlap[] {
  const visto = new Map<string, DailyValidatedShard[]>();
  for (const shard of DAILY_VALIDATED_SHARDS) {
    for (const m of mediosDailyValidatedActivos(shard)) {
      const arr = visto.get(m.medio_id) ?? [];
      arr.push(shard);
      visto.set(m.medio_id, arr);
    }
  }
  return [...visto.entries()]
    .filter(([, shards]) => shards.length > 1)
    .map(([medio_id, shards]) => ({ medio_id, shards }));
}

/** Medios de un shard que también están en base / nacional B / crisis. */
export function solapesDailyVsOtrosCrons(shard: DailyValidatedShard): string[] {
  const otros = mediosYaCubiertosPorCron();
  return mediosDailyValidatedActivos(shard)
    .filter((m) => otros.has(m.medio_id))
    .map((m) => m.medio_id)
    .sort();
}

/**
 * Guarda dura de aislamiento. No filtra: si hay overlap, el llamador DEBE
 * abortar. Shard A conserva el filtro silencioso histórico vs otros crons en
 * `mediosDailyNetNew('A')`; esta función cubre A↔B↔C y B/C vs base/nacional/crisis.
 */
export function describirSolapeDailyShard(shard: DailyValidatedShard): string | null {
  const intra = solapesEntreDailyShards();
  const partes: string[] = [];
  if (intra.length > 0) {
    partes.push(
      `overlap entre shards daily: ${intra.map((s) => `${s.medio_id}[${s.shards.join('+')}]`).join(', ')}`,
    );
  }
  if (shard !== 'A') {
    const vsOtros = solapesDailyVsOtrosCrons(shard);
    if (vsOtros.length > 0) {
      partes.push(`overlap shard ${shard} vs base/nacional_b/crisis: ${vsOtros.join(', ')}`);
    }
  }
  return partes.length > 0 ? partes.join('; ') : null;
}

/**
 * Medios NET-NEW de un shard daily-validated. Default: A (47 históricos).
 *
 * Shard A: filtra en silencio contra base/nacional B/crisis (semántica histórica).
 * Shard B/C: NO filtran en silencio; el runner aborta si `describirSolapeDailyShard`
 * reporta overlap. Aquí se devuelven los activos del shard.
 */
export function mediosDailyNetNew(shard: DailyValidatedShard = 'A'): ShadowMedioDaily[] {
  const activos = mediosDailyValidatedActivos(shard);
  if (shard === 'A') {
    const cubiertos = mediosYaCubiertosPorCron();
    return activos.filter((m) => !cubiertos.has(m.medio_id));
  }
  return activos;
}

/**
 * medio_id cubiertos por CUALQUIER tier de cron shadow activo (base + nacional
 * B + crisis + daily-validated A + B + C). Fuente de verdad única para
 * "¿este medio corre en algún cron?" — usada por auditorías read-only fuera
 * del pipeline. C entra al conteo de cron (schedule 13:55 UTC).
 */
export function mediosEnCualquierCron(): Set<string> {
  const s = mediosYaCubiertosPorCron();
  for (const m of mediosDailyValidatedTodosActivos()) s.add(m.medio_id);
  return s;
}
