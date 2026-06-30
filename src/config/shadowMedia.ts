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
