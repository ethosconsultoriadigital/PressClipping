/**
 * Utilidades de parseo de celdas de Google Sheets.
 *
 * Las celdas llegan como texto libre editado por humanos, así que estas
 * funciones son tolerantes (acentos, mayúsculas, espacios) pero predecibles.
 * Son puras y están cubiertas por tests.
 */
import { DateTime } from 'luxon';

/** Normaliza una clave de cabecera: minúsculas, sin acentos, sin espacios extra. */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos (diacríticos combinados)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

const TRUE_VALUES = new Set([
  'true',
  '1',
  'si',
  'sí',
  'yes',
  'y',
  'verdadero',
  'x',
  'activo',
]);
const FALSE_VALUES = new Set([
  'false',
  '0',
  'no',
  'n',
  'falso',
  'inactivo',
  '',
]);

/**
 * Interpreta un booleano de celda. Si el valor no es reconocible, devuelve
 * `fallback` (por defecto false) para no romper la sincronización.
 */
export function parseBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return fallback;
  const v = String(value).trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  return fallback;
}

/** Entero o null si la celda está vacía o no es numérica. */
export function parseIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const v = String(value).trim().replace(/[, ]/g, '');
  if (v === '') return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** Texto recortado, o null si queda vacío. */
export function parseTextOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  return v === '' ? null : v;
}

/**
 * Convierte una celda multivalor separada por '|' en un arreglo limpio.
 * También acepta saltos de línea como separador.
 */
export function parseList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  return String(value)
    .split(/[|\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Parsea una fecha de celda a ISO UTC, o null si no es interpretable.
 * Intenta ISO 8601 primero y luego formatos comunes en MX (dd/mm/yyyy).
 */
export function parseDateToUtcIso(value: unknown): string | null {
  const raw = parseTextOrNull(value);
  if (!raw) return null;

  const iso = DateTime.fromISO(raw, { zone: 'utc' });
  if (iso.isValid) return iso.toUTC().toISO();

  const formats = [
    'dd/MM/yyyy HH:mm',
    'dd/MM/yyyy',
    'yyyy-MM-dd HH:mm:ss',
    'yyyy-MM-dd HH:mm',
    'd/M/yyyy',
    'MM/dd/yyyy',
  ];
  for (const fmt of formats) {
    const dt = DateTime.fromFormat(raw, fmt, { zone: 'utc' });
    if (dt.isValid) return dt.toUTC().toISO();
  }

  // Último recurso: dejar que el motor de JS lo intente (RFC 2822, etc.)
  const js = DateTime.fromJSDate(new Date(raw)).toUTC();
  return js.isValid ? js.toISO() : null;
}
