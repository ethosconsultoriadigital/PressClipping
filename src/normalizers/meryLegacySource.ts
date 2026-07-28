/**
 * Normalización de `source` del concentrado legacy (alerta Google RSS de Mery
 * Pozos) a un nombre de medio canónico, comparable contra el catálogo Ethos.
 *
 * Módulo puro, sin dependencias de Supabase/Sheets — testeable de forma aislada.
 */
import { foldText } from '../matchers/text.js';

/** Clave normalizada para lookup: fold + lowercase + trim, sin puntuación de borde. */
function claveNormalizada(raw: string): string {
  return foldText(raw ?? '')
    .replace(/\|.*$/g, '')       // corta sufijos tipo "| Periodismo independiente"
    .replace(/[.,;:!¡?¿"'«»()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tabla de alias → nombre canónico. Incluye tanto nombres de medio como sus
 * variantes de dominio (p. ej. "afondojalisco.com" → "A Fondo Jalisco").
 */
const ALIAS_MAP: Record<string, string> = {
  // El Informador
  'el informador': 'El Informador',
  'informador mx': 'El Informador',
  'informador.mx': 'El Informador',

  // Semanario Conciencia Pública
  'semanario conciencia publica': 'Semanario Conciencia Pública',
  'conciencia publica': 'Semanario Conciencia Pública',
  'concienciapublica com mx': 'Semanario Conciencia Pública',
  'concienciapublica.com.mx': 'Semanario Conciencia Pública',

  // MURAL
  'mural': 'MURAL',
  'mural com mx': 'MURAL',
  'mural.com.mx': 'MURAL',

  // UDG TV / Canal 44
  'udg tv': 'UDG TV / Canal 44',
  'udgtv com': 'UDG TV / Canal 44',
  'udgtv.com': 'UDG TV / Canal 44',
  'canal 44': 'UDG TV / Canal 44',
  'udg tv canal 44': 'UDG TV / Canal 44',

  // A Fondo Jalisco
  'a fondo jalisco': 'A Fondo Jalisco',
  'afondojalisco com': 'A Fondo Jalisco',
  'afondojalisco.com': 'A Fondo Jalisco',

  // AFmedios
  'afmedios': 'AFmedios',
  'afmedios noticias': 'AFmedios',
  'afmedios com': 'AFmedios',
  'afmedios.com': 'AFmedios',

  // PolíticoMX
  'politicomx': 'Político MX',
  'politico mx': 'Político MX',
  'politico.mx': 'Político MX',

  // Milenio
  'milenio': 'Milenio',
  'milenio com': 'Milenio',
  'milenio.com': 'Milenio',

  // El Heraldo de México
  'el heraldo de mexico': 'El Heraldo de México',

  // El Sol de México
  'el sol de mexico': 'El Sol de México',

  // Notisistema
  'notisistema': 'Notisistema',
  'notisistema com': 'Notisistema',
  'notisistema.com': 'Notisistema',

  // Tráfico ZMG
  'trafico zmg': 'Tráfico ZMG',
  'traficozmg com': 'Tráfico ZMG',
  'traficozmg.com': 'Tráfico ZMG',

  // Vallarta Independiente
  'vallarta independiente': 'Vallarta Independiente',
  'vallartaindependiente com': 'Vallarta Independiente',
  'vallartaindependiente.com': 'Vallarta Independiente',

  // Página 24 Jalisco
  'pagina 24 jalisco': 'Página 24 Jalisco',
  'pagina24jalisco com mx': 'Página 24 Jalisco',
  'pagina24jalisco.com.mx': 'Página 24 Jalisco',

  // Siker
  'siker': 'Siker',
  'siker com mx': 'Siker',
  'siker.com.mx': 'Siker',

  // Hoja de Ruta Digital
  'hoja de ruta digital': 'Hoja de Ruta Digital',
  'hojaderutadigital mx': 'Hoja de Ruta Digital',
  'hojaderutadigital.mx': 'Hoja de Ruta Digital',

  // Talla Política
  'talla politica': 'Talla Política',

  // UnoTV
  'unotv': 'UnoTV',
  'unotv com': 'UnoTV',
  'unotv.com': 'UnoTV',

  // La Crónica de Hoy
  'la cronica de hoy': 'La Crónica de Hoy',

  // Partidero
  'partidero': 'Partidero',
  'partidero com': 'Partidero',
  'partidero.com': 'Partidero',

  // NTR Guadalajara
  'ntr guadalajara': 'NTR Guadalajara',

  // MVS Noticias
  'mvs noticias': 'MVS Noticias',

  // LatinUS
  'latinus': 'LatinUS',

  // La Silla Rota
  'la silla rota': 'La Silla Rota',

  // Quadratín Jalisco
  'quadratin jalisco': 'Quadratín Jalisco',
  'quadratín jalisco': 'Quadratín Jalisco',

  // Reporte Índigo
  'reporte indigo': 'Reporte Índigo',
  'reporte índigo': 'Reporte Índigo',

  // PorEsto
  'poresto': 'PorEsto',
  'poresto com': 'PorEsto',
  'poresto.com': 'PorEsto',

  // Líder Informativo
  'lider informativo': 'Líder Informativo',

  // Mery Pozos como fuente personal (NO es medio)
  'mery pozos': 'Mery Pozos',

  // Agregadores — NO catalogar como medios principales
  'msn': 'MSN',
  'google news': 'Google News',
  'news google com': 'Google News',

  // MURAL/Reforma/El Norte — D_PAGO_CONVENIO_API si no hay acceso público legítimo
  'reforma': 'Reforma',
  'el norte': 'El Norte',
};

/** Nombres canónicos que son agregadores, NUNCA medios principales. */
export const AGREGADORES_CANONICOS: ReadonlySet<string> = new Set(['MSN', 'Google News']);

/** Nombres canónicos con paywall/convenio conocido, sin acceso público legítimo confirmado. */
export const PAGO_CONVENIO_CANONICOS: ReadonlySet<string> = new Set(['MURAL', 'Reforma', 'El Norte']);

/** Nombre canónico reservado para la propia diputada como fuente personal (no medio). */
export const FUENTE_PROPIA_CANONICOS: ReadonlySet<string> = new Set(['Mery Pozos']);

/**
 * Normaliza el `source` legacy a su nombre de medio canónico.
 * Si no hay alias conocido, devuelve el texto original recortado (sin
 * sufijos de sección tipo "| Periodismo independiente").
 */
export function normalizeSourceLegacy(sourceLegacy: string | null | undefined): string {
  const raw = (sourceLegacy ?? '').trim();
  if (!raw) return '';
  const clave = claveNormalizada(raw);
  const canonico = ALIAS_MAP[clave];
  if (canonico) return canonico;
  // Sin alias conocido: recorta sufijos de sección y colapsa espacios, conserva original.
  return raw.replace(/\|.*$/g, '').trim();
}

/** True si el nombre canónico es un agregador (Google News, MSN, etc.) — no es medio. */
export function esAgregador(sourceCanonico: string): boolean {
  return AGREGADORES_CANONICOS.has(sourceCanonico);
}

/** True si el link apunta a un redirect de Google News. */
export function esLinkGoogleNews(link: string | null | undefined): boolean {
  return /news\.google\.com/i.test(link ?? '');
}

/** True si el medio requiere pago/convenio/API sin acceso público legítimo confirmado. */
export function esPagoConvenio(sourceCanonico: string): boolean {
  return PAGO_CONVENIO_CANONICOS.has(sourceCanonico);
}

/** True si la fuente es la propia diputada (persona), no un medio de comunicación. */
export function esFuentePropia(sourceCanonico: string): boolean {
  return FUENTE_PROPIA_CANONICOS.has(sourceCanonico);
}
