import { describe, it, expect } from 'vitest';
import {
  verificarFlagsSombra,
  verificarEnvObservacion,
  estadoCicloSombra,
  modoMetrica,
  notasShadow,
  notasTrazabilidadWorkflow,
  esPrecisionNA,
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

describe('verificarEnvObservacion (guarda de entorno anti-envío)', () => {
  it('permite entorno sin envío activado', () => {
    expect(verificarEnvObservacion({}).ok).toBe(true);
    expect(verificarEnvObservacion({ SEND_ALERTS: 'false', WHATSAPP_ENABLED: '' }).ok).toBe(true);
  });

  it('aborta si SEND_ALERTS=true', () => {
    const r = verificarEnvObservacion({ SEND_ALERTS: 'true' });
    expect(r.ok).toBe(false);
    expect(r.violacion).toBe('SEND_ALERTS');
  });

  it('aborta si WHATSAPP_ENABLED=true o EMAIL_ENABLED=true', () => {
    expect(verificarEnvObservacion({ WHATSAPP_ENABLED: 'true' }).ok).toBe(false);
    expect(verificarEnvObservacion({ EMAIL_ENABLED: 'TRUE' }).ok).toBe(false);
  });

  it('la sola presencia de credenciales (Twilio/SMTP) sin envío NO aborta', () => {
    expect(
      verificarEnvObservacion({ TWILIO_ACCOUNT_SID: 'AC123', SMTP_HOST: 'smtp.example.com' }).ok,
    ).toBe(true);
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

  it('shadow_error si NO se pudo escribir 05 (sheetsWriteFailed)', () => {
    expect(estadoCicloSombra({ compareOk: true, sheetsWriteFailed: true })).toBe('shadow_error');
  });

  it('shadow_warning si el read-back de 05 no coincide (mismatch)', () => {
    expect(estadoCicloSombra({ compareOk: true, sheetsWriteMismatch: true })).toBe('shadow_warning');
  });

  it('NUNCA shadow_ok si 05 falló o no coincide (consistencia 05↔07)', () => {
    expect(estadoCicloSombra({ compareOk: true, sheetsWriteFailed: true })).not.toBe('shadow_ok');
    expect(estadoCicloSombra({ compareOk: true, sheetsWriteMismatch: true })).not.toBe('shadow_ok');
  });

  it('write failed pesa más que un mismatch (error > warning)', () => {
    expect(
      estadoCicloSombra({ compareOk: true, sheetsWriteFailed: true, sheetsWriteMismatch: true }),
    ).toBe('shadow_error');
  });
});

describe('esPrecisionNA', () => {
  it('detecta N/A en distintas capitalizaciones', () => {
    expect(esPrecisionNA('N/A')).toBe(true);
    expect(esPrecisionNA('n/a')).toBe(true);
    expect(esPrecisionNA(' N/A ')).toBe(true);
  });
  it('no marca valores numéricos válidos', () => {
    expect(esPrecisionNA('0.90')).toBe(false);
    expect(esPrecisionNA(0.4)).toBe(false);
    expect(esPrecisionNA('')).toBe(false);
    expect(esPrecisionNA(undefined)).toBe(false);
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

  it('justifica precision_ajustada=N/A con denominador cero', () => {
    const n = notasShadow({ windowHours: 48, mediosCurados: 25, promovidasDiagnostico: 0, precisionAjustada: 'N/A' });
    expect(n).toContain('precision_ajustada=N/A_denominador_cero');
    // Ejemplo final esperado del Paso 7.
    expect(n).toBe(
      'modo=shadow; sin alertas; sin export-results; ventana_movil=48h; medios_curados=25; precision_ajustada=N/A_denominador_cero; promovidas_diagnostico=0',
    );
  });

  it('NO agrega justificación N/A cuando hay precisión numérica', () => {
    const n = notasShadow({ windowHours: 48, mediosCurados: 25, promovidasDiagnostico: 0, precisionAjustada: '0.92' });
    expect(n).not.toContain('N/A_denominador_cero');
  });

  it('incluye banderas de integridad de Sheets cuando aplican', () => {
    const n = notasShadow({
      windowHours: 48,
      mediosCurados: 25,
      promovidasDiagnostico: 0,
      sheets429: true,
      sheetsWriteFailed: true,
      sheetsWriteMismatch: true,
    });
    expect(n).toContain('sheets_429');
    expect(n).toContain('sheets_write_failed');
    expect(n).toContain('sheets_write_mismatch');
  });

  it('notas nacional B incluyen workflow/tier/medios/frecuencia sin romper base', () => {
    const notasExtra = notasTrazabilidadWorkflow({
      workflow: 'shadow-national-tier',
      tier: 'nacional_b',
      medios: 'MED-0025,MED-0053',
      frecuencia: '6h',
    });
    const n = notasShadow({ windowHours: 48, mediosCurados: 2, promovidasDiagnostico: 0, notasExtra });
    // Base shadow intacta
    expect(n).toContain('modo=shadow');
    expect(n).toContain('sin alertas');
    expect(n).toContain('sin export-results');
    expect(n).toContain('ventana_movil=48h');
    expect(n).toContain('medios_curados=2');
    // Trazabilidad nacional B
    expect(n).toContain('workflow=shadow-national-tier');
    expect(n).toContain('tier=nacional_b');
    expect(n).toContain('medios=MED-0025,MED-0053');
    expect(n).toContain('frecuencia=6h');
  });

  it('notas shadow base NO cambian cuando no hay trazabilidad extra', () => {
    const base = notasShadow({ windowHours: 48, mediosCurados: 25, promovidasDiagnostico: 0 });
    const conExtraVacio = notasShadow({
      windowHours: 48,
      mediosCurados: 25,
      promovidasDiagnostico: 0,
      notasExtra: notasTrazabilidadWorkflow({}),
    });
    expect(conExtraVacio).toBe(base);
    expect(base).not.toContain('workflow=');
    expect(base).not.toContain('tier=');
  });
});

describe('notasTrazabilidadWorkflow', () => {
  it('ensambla solo las partes presentes', () => {
    expect(
      notasTrazabilidadWorkflow({ workflow: 'shadow-national-tier', tier: 'nacional_b' }),
    ).toBe('workflow=shadow-national-tier; tier=nacional_b');
  });

  it('devuelve cadena vacía sin datos (no rompe shadow base)', () => {
    expect(notasTrazabilidadWorkflow({})).toBe('');
    expect(notasTrazabilidadWorkflow({ workflow: '   ' })).toBe('');
  });

  it('incluye medios CSV y frecuencia', () => {
    const s = notasTrazabilidadWorkflow({ medios: 'MED-0025,MED-0053', frecuencia: '6h' });
    expect(s).toBe('medios=MED-0025,MED-0053; frecuencia=6h');
  });
});
