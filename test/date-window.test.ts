import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  esSoloFecha,
  inicioDeDiaMx,
  finDeDiaMx,
  normalizarVentanaTimestamp,
  aFechaMx,
  dentroDeVentana,
  ventanaMovil,
} from '../src/utils/dateWindow.js';

describe('esSoloFecha', () => {
  it('detecta YYYY-MM-DD', () => {
    expect(esSoloFecha('2026-06-27')).toBe(true);
    expect(esSoloFecha('2026-06-27T10:00')).toBe(false);
    expect(esSoloFecha('2026-06-27T23:59:59-06:00')).toBe(false);
    expect(esSoloFecha(undefined)).toBe(false);
  });
});

describe('inicio/fin de día MX', () => {
  it('inicio de día es 00:00:00.000-06:00', () => {
    expect(inicioDeDiaMx('2026-06-27')).toBe('2026-06-27T00:00:00.000-06:00');
  });
  it('fin de día es 23:59:59.999-06:00 (inclusivo)', () => {
    expect(finDeDiaMx('2026-06-27')).toBe('2026-06-27T23:59:59.999-06:00');
  });
});

describe('normalizarVentanaTimestamp', () => {
  it('solo-fecha → desde=inicio de día, hasta=fin de día MX', () => {
    const v = normalizarVentanaTimestamp({ desde: '2026-06-25', hasta: '2026-06-27' });
    expect(v.desde).toBe('2026-06-25T00:00:00.000-06:00');
    expect(v.hasta).toBe('2026-06-27T23:59:59.999-06:00');
  });
  it('respeta inputs que ya traen hora/offset', () => {
    const v = normalizarVentanaTimestamp({
      desde: '2026-06-25T16:00:00-06:00',
      hasta: '2026-06-27T16:00:00-06:00',
    });
    expect(v.desde).toBe('2026-06-25T16:00:00-06:00');
    expect(v.hasta).toBe('2026-06-27T16:00:00-06:00');
  });
});

describe('fecha-hasta inclusiva por día completo (regresión Lote 4)', () => {
  it('fecha-hasta=2026-06-27 INCLUYE 2026-06-27T17:59 (MX)', () => {
    expect(dentroDeVentana('2026-06-27T17:59:00-06:00', undefined, '2026-06-27')).toBe(true);
  });
  it('fecha-hasta=2026-06-27 INCLUYE 2026-06-27T23:59 (MX)', () => {
    expect(dentroDeVentana('2026-06-27T23:59:00-06:00', undefined, '2026-06-27')).toBe(true);
  });
  it('fecha-hasta=2026-06-27 NO INCLUYE 2026-06-28T00:00 (MX)', () => {
    expect(dentroDeVentana('2026-06-28T00:00:00-06:00', undefined, '2026-06-27')).toBe(false);
  });
  it('incluye una mención real almacenada en UTC (20:35Z = 14:35 MX del 27)', () => {
    expect(dentroDeVentana('2026-06-27T20:35:58.764Z', '2026-06-26', '2026-06-27')).toBe(true);
  });
  it('respeta el límite inferior (inicio de día MX)', () => {
    expect(dentroDeVentana('2026-06-25T23:59:00-06:00', '2026-06-26', '2026-06-27')).toBe(false);
    expect(dentroDeVentana('2026-06-26T00:00:00-06:00', '2026-06-26', '2026-06-27')).toBe(true);
  });
});

describe('aFechaMx', () => {
  it('solo-fecha pasa tal cual', () => {
    expect(aFechaMx('2026-06-27')).toBe('2026-06-27');
  });
  it('timestamp UTC se convierte a fecha calendario MX', () => {
    // 2026-06-28T03:00Z = 2026-06-27 21:00 MX
    expect(aFechaMx('2026-06-28T03:00:00Z')).toBe('2026-06-27');
  });
});

describe('ventanaMovil', () => {
  it('48h hacia atrás desde "ahora" MX', () => {
    const ahora = DateTime.fromISO('2026-06-27T16:00:00', { zone: 'America/Mexico_City' });
    const { desde, hasta } = ventanaMovil(48, ahora);
    expect(hasta).toBe('2026-06-27T16:00:00.000-06:00');
    expect(desde).toBe('2026-06-25T16:00:00.000-06:00');
  });
  it('window-hours arbitrario', () => {
    const ahora = DateTime.fromISO('2026-06-27T16:00:00', { zone: 'America/Mexico_City' });
    const { desde } = ventanaMovil(24, ahora);
    expect(desde).toBe('2026-06-26T16:00:00.000-06:00');
  });
});
