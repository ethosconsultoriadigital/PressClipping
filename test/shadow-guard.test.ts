import { describe, it, expect } from 'vitest';
import {
  verificarFlagsSombra,
  estadoCicloSombra,
  modoMetrica,
  notasShadow,
  ACCIONES_PROHIBIDAS_SOMBRA,
} from '../src/utils/shadowGuard.js';

describe('verificarFlagsSombra', () => {
  it('permite los flags seguros de modo sombra', () => {
    const r = verificarFlagsSombra([
      '--window-hours=48',
      '--crawl-limit=50',
      '--output=sheet',
      '--append-metrics-history',
      '--no-alerts',
      '--no-export-results',
      '--no-generate-xml',
    ]);
    expect(r.ok).toBe(true);
  });

  it('bloquea --export-results', () => {
    const r = verificarFlagsSombra(['--export-results']);
    expect(r.ok).toBe(false);
    expect(r.violacion).toBe('export-results');
    expect(r.mensaje).toContain('Shadow mode forbids');
  });

  it('bloquea --generate-xml', () => {
    expect(verificarFlagsSombra(['--generate-xml']).ok).toBe(false);
  });

  it('bloquea --alerts y --classify-ia', () => {
    expect(verificarFlagsSombra(['--alerts']).ok).toBe(false);
    expect(verificarFlagsSombra(['--classify-ia']).ok).toBe(false);
  });

  it('--no-<accion> NO se confunde con la acción prohibida', () => {
    for (const accion of ACCIONES_PROHIBIDAS_SOMBRA) {
      expect(verificarFlagsSombra([`--no-${accion}`]).ok).toBe(true);
    }
  });
});

describe('estadoCicloSombra', () => {
  it('shadow_ok cuando todo está limpio', () => {
    expect(estadoCicloSombra({ compareOk: true, dryRunSinTexto: 0, crawlErrores: 0, potenciales: 3 }))
      .toBe('shadow_ok');
  });

  it('shadow_error si el comparativo falló', () => {
    expect(estadoCicloSombra({ compareOk: false })).toBe('shadow_error');
  });

  it('shadow_error ante flood de potenciales', () => {
    expect(estadoCicloSombra({ compareOk: true, potenciales: 999, umbralFlood: 25 }))
      .toBe('shadow_error');
  });

  it('shadow_warning si dry-run no está limpio', () => {
    expect(estadoCicloSombra({ compareOk: true, dryRunSinTexto: 5 })).toBe('shadow_warning');
  });

  it('shadow_warning ante errores de crawl', () => {
    expect(estadoCicloSombra({ compareOk: true, crawlErrores: 2 })).toBe('shadow_warning');
  });
});

describe('modoMetrica (history row con modo=shadow)', () => {
  it('shadow tiene prioridad', () => {
    expect(modoMetrica(true, true)).toBe('shadow');
    expect(modoMetrica(true, false)).toBe('shadow');
  });
  it('sin sombra: ciclo_completo o solo_comparacion según crawl', () => {
    expect(modoMetrica(false, true)).toBe('ciclo_completo');
    expect(modoMetrica(false, false)).toBe('solo_comparacion');
  });
});

describe('notasShadow (shadow history row incluye window_hours)', () => {
  it('incluye ventana_movil=48h y medios_curados=25', () => {
    const n = notasShadow({ windowHours: 48, mediosCurados: 25, promovidasDiagnostico: 0 });
    expect(n).toContain('modo=shadow');
    expect(n).toContain('sin alertas');
    expect(n).toContain('sin export-results');
    expect(n).toContain('ventana_movil=48h');
    expect(n).toContain('medios_curados=25');
    expect(n).toContain('promovidas_diagnostico=0');
  });

  it('omite ventana_movil/medios si no se proveen', () => {
    const n = notasShadow({ promovidasDiagnostico: 3 });
    expect(n).not.toContain('ventana_movil');
    expect(n).not.toContain('medios_curados');
    expect(n).toContain('promovidas_diagnostico=3');
  });
});
