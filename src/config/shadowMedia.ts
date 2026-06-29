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
