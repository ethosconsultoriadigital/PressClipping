/**
 * Semántica de ventanas de fecha para scripts de comparación.
 *
 * Problema histórico: `--fecha-hasta=2026-06-27` se interpretaba como
 * `2026-06-27T00:00:00`, excluyendo notas del 27 por la tarde/noche.
 *
 * Regla aplicada aquí (zona America/Mexico_City, sin DST desde 2022):
 *   - Si el input es solo fecha (YYYY-MM-DD):
 *       · `desde` → inicio de día MX  (00:00:00.000-06:00)
 *       · `hasta` → fin de día MX     (23:59:59.999-06:00)  ← INCLUSIVO
 *   - Si el input ya trae hora/offset, se respeta tal cual.
 *
 * Para columnas `timestamptz` (p.ej. noticias.fecha_publicacion) se usan los
 * límites con hora. Para columnas `date` (p.ej. comparativo_pressclipping.fecha)
 * se usa solo la fecha calendario MX (`aFechaMx`).
 */
import { DateTime } from 'luxon';

export const TZ_MX = 'America/Mexico_City';
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function esSoloFecha(s: string | null | undefined): boolean {
  return typeof s === 'string' && SOLO_FECHA.test(s.trim());
}

/** Inicio de día MX (00:00:00.000-06:00) para una fecha YYYY-MM-DD. */
export function inicioDeDiaMx(fecha: string): string {
  return (
    DateTime.fromISO(fecha.trim(), { zone: TZ_MX }).startOf('day').toISO() ??
    `${fecha.trim()}T00:00:00.000-06:00`
  );
}

/** Fin de día MX (23:59:59.999-06:00) para una fecha YYYY-MM-DD (inclusivo). */
export function finDeDiaMx(fecha: string): string {
  return (
    DateTime.fromISO(fecha.trim(), { zone: TZ_MX }).endOf('day').toISO() ??
    `${fecha.trim()}T23:59:59.999-06:00`
  );
}

/**
 * Normaliza límites para comparar contra columnas `timestamptz`.
 * `desde` solo-fecha → inicio de día MX; `hasta` solo-fecha → fin de día MX.
 * Inputs con hora/offset se respetan.
 */
export function normalizarVentanaTimestamp(input: {
  desde?: string;
  hasta?: string;
}): { desde?: string; hasta?: string } {
  const out: { desde?: string; hasta?: string } = {};
  if (input.desde) out.desde = esSoloFecha(input.desde) ? inicioDeDiaMx(input.desde) : input.desde;
  if (input.hasta) out.hasta = esSoloFecha(input.hasta) ? finDeDiaMx(input.hasta) : input.hasta;
  return out;
}

/**
 * Devuelve la fecha calendario MX (YYYY-MM-DD) de un input. Útil para comparar
 * contra columnas `date`, donde la comparación por fecha ya es inclusiva del día.
 */
export function aFechaMx(input: string): string {
  if (esSoloFecha(input)) return input.trim();
  return DateTime.fromISO(input).setZone(TZ_MX).toISODate() ?? input.trim();
}

/**
 * ¿El instante `iso` cae dentro de la ventana [desde, hasta] (inclusiva por día
 * cuando los límites son solo-fecha)? Lógica pura para tests y validaciones.
 */
export function dentroDeVentana(iso: string, desde?: string, hasta?: string): boolean {
  const t = DateTime.fromISO(iso).toMillis();
  if (Number.isNaN(t)) return false;
  const v = normalizarVentanaTimestamp({ desde, hasta });
  if (v.desde && t < DateTime.fromISO(v.desde).toMillis()) return false;
  if (v.hasta && t > DateTime.fromISO(v.hasta).toMillis()) return false;
  return true;
}

/**
 * Ventana móvil de `horas` que termina "ahora" (zona MX). Devuelve límites con
 * hora/offset, aptos para columnas timestamptz; pasan tal cual por el normalizador.
 */
export function ventanaMovil(
  horas: number,
  ahora: DateTime = DateTime.now(),
): { desde: string; hasta: string } {
  const hasta = ahora.setZone(TZ_MX);
  const desde = hasta.minus({ hours: horas });
  return {
    desde: desde.toISO() ?? '',
    hasta: hasta.toISO() ?? '',
  };
}
