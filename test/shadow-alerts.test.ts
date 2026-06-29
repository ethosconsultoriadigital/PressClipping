import { describe, it, expect } from 'vitest';
import { verificarFlagsAlertasSombra } from '../src/utils/shadowGuard.js';
import {
  evaluarMencion,
  evaluarLote,
  dedupeKey,
  normalizarValoracion,
  ALERTAS_SOMBRA_HEADERS,
  type MencionAlertaInput,
} from '../src/alerts/shadowAlertRules.js';

/** Mención base VÁLIDA y NO crítica (relevancia media → P2_RESUMEN). */
const base = (over: Partial<MencionAlertaInput> = {}): MencionAlertaInput => ({
  mencion_id: 'MEN-1',
  cliente_id: 'CLI-1',
  cliente: 'Cliente Uno',
  noticia_id: 'NOT-1',
  medio: 'El Economista',
  titulo: 'Una nota válida',
  url: 'https://example.com/nota-1',
  keyword: 'reforma laboral',
  sentimiento: 'neutro',
  valoracion: 0.4,
  prioridad_medio: 'media',
  cliente_activo: true,
  cliente_alertas_activas: true,
  keyword_activa: true,
  keyword_alerta: false,
  keyword_prioridad: 'media',
  tema_reputacional: false,
  es_falso_positivo: false,
  requiere_alerta: false,
  ...over,
});

describe('verificarFlagsAlertasSombra', () => {
  it('permite flags seguros y confirmaciones --no-*', () => {
    expect(
      verificarFlagsAlertasSombra([
        '--window-hours=48', '--output=sheet', '--dry-run',
        '--no-send', '--no-whatsapp', '--no-email',
      ]).ok,
    ).toBe(true);
  });

  it('bloquea --send con mensaje claro', () => {
    const r = verificarFlagsAlertasSombra(['--send']);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe('Shadow alerts forbid real sending.');
  });

  it('bloquea --whatsapp/--email/--twilio/--gmail/--smtp/--enviar', () => {
    for (const f of ['--whatsapp', '--email', '--twilio', '--gmail', '--smtp', '--enviar']) {
      expect(verificarFlagsAlertasSombra([f]).ok).toBe(false);
    }
  });
});

describe('reglas P1/P2/P3 (anti sobre-alertamiento)', () => {
  it('sentimiento negativo + valoración alta → P1_INMEDIATA/whatsapp', () => {
    const d = evaluarMencion(base({ sentimiento: 'negativo', valoracion: 0.8 }));
    expect(d.estado_shadow).toBe('P1_INMEDIATA');
    expect(d.tipo_alerta_simulada).toBe('inmediata');
    expect(d.canal_simulado).toBe('whatsapp');
    expect(d.habria_alerta).toBe('SÍ');
    expect(d.regla_disparo).toContain('sentimiento_negativo_valoracion_alta');
  });

  it('valoración crítica (≥0.85) → P1 aunque falte otra señal', () => {
    expect(evaluarMencion(base({ valoracion: 0.9 })).estado_shadow).toBe('P1_INMEDIATA');
    expect(evaluarMencion(base({ valoracion: 1 })).regla_disparo).toContain('valoracion_critica');
  });

  it('keyword_alerta/requiere_alerta CON relevancia alta → P1', () => {
    expect(evaluarMencion(base({ keyword_alerta: true, valoracion: 0.9 })).estado_shadow).toBe('P1_INMEDIATA');
    expect(evaluarMencion(base({ requiere_alerta: true, valoracion: 0.9 })).estado_shadow).toBe('P1_INMEDIATA');
    expect(evaluarMencion(base({ tema_reputacional: true })).estado_shadow).toBe('P1_INMEDIATA');
  });

  it('keyword_alerta/requiere_alerta SIN relevancia alta NO disparan P1 (→ P2)', () => {
    expect(evaluarMencion(base({ keyword_alerta: true, valoracion: 0.4 })).estado_shadow).toBe('P2_RESUMEN');
    expect(evaluarMencion(base({ requiere_alerta: true, valoracion: 0.4 })).estado_shadow).toBe('P2_RESUMEN');
  });

  it('medio prioridad ALTA por sí solo NO dispara P1 (→ P2)', () => {
    const d = evaluarMencion(base({ prioridad_medio: 'alta' }));
    expect(d.estado_shadow).toBe('P2_RESUMEN');
  });

  it('keyword crítica por sí sola NO dispara P1 si no hay señal fuerte (→ P2)', () => {
    const d = evaluarMencion(base({ keyword_prioridad: 'critica' }));
    expect(d.estado_shadow).toBe('P2_RESUMEN');
  });

  it('sentimiento negativo SIN valoración alta NO es P1 (→ P2)', () => {
    const d = evaluarMencion(base({ sentimiento: 'negativo', valoracion: 0.4 }));
    expect(d.estado_shadow).toBe('P2_RESUMEN');
  });

  it('mención laboral/regulatoria neutra relevante → P2_RESUMEN/email', () => {
    const d = evaluarMencion(base());
    expect(d.estado_shadow).toBe('P2_RESUMEN');
    expect(d.tipo_alerta_simulada).toBe('resumen');
    expect(d.canal_simulado).toBe('email');
    expect(d.habria_alerta).toBe('SÍ');
  });

  it('monitoreo general (baja urgencia) → P3_DASHBOARD/dashboard, sin alerta', () => {
    const d = evaluarMencion(base({ valoracion: 0.2, prioridad_medio: 'baja', keyword_prioridad: 'baja' }));
    expect(d.estado_shadow).toBe('P3_DASHBOARD');
    expect(d.tipo_alerta_simulada).toBe('monitoreo');
    expect(d.canal_simulado).toBe('dashboard');
    expect(d.habria_alerta).toBe('NO');
  });
});

describe('bloqueos', () => {
  it('cliente inactivo / alertas desactivadas / keyword inactiva', () => {
    expect(evaluarMencion(base({ cliente_activo: false, keyword_alerta: true })).estado_shadow).toBe('BLOQUEADA');
    expect(evaluarMencion(base({ cliente_alertas_activas: false })).motivo_bloqueo).toBe('alertas_cliente_desactivadas');
    expect(evaluarMencion(base({ keyword_activa: false })).motivo_bloqueo).toBe('keyword_inactiva');
  });

  it('falso positivo / sin url / sin título / sin medio', () => {
    expect(evaluarMencion(base({ es_falso_positivo: true })).motivo_bloqueo).toBe('posible_falso_positivo');
    expect(evaluarMencion(base({ url: '' })).motivo_bloqueo).toBe('sin_url');
    expect(evaluarMencion(base({ titulo: '' })).motivo_bloqueo).toBe('sin_titulo');
    expect(evaluarMencion(base({ medio: '' })).motivo_bloqueo).toBe('sin_medio');
  });

  it('baja relevancia extrema (≈0 + medio baja prioridad) → BLOQUEADA', () => {
    const d = evaluarMencion(base({ valoracion: 0.02, prioridad_medio: 'baja', keyword_prioridad: 'baja' }));
    expect(d.estado_shadow).toBe('BLOQUEADA');
    expect(d.motivo_bloqueo).toBe('baja_relevancia_extrema');
  });
});

describe('dedupe fuerte + agrupación de keywords', () => {
  it('dedupe_key usa cliente_id + noticia_id (no mencion_id)', () => {
    expect(dedupeKey(base())).toBe('CLI-1::NOT-1');
    // distinta mención/keyword, misma nota → misma key
    expect(dedupeKey(base({ mencion_id: 'MEN-2', keyword: 'otra' }))).toBe('CLI-1::NOT-1');
  });

  it('dedupe_key cae a cliente_id + url_norm sin noticia_id', () => {
    const k = dedupeKey(base({ noticia_id: null }));
    expect(k.startsWith('CLI-1::')).toBe(true);
    expect(k).not.toBe('CLI-1::NOT-1');
  });

  it('dedupe_key cae a cliente+titulo+medio+fecha sin noticia_id ni url', () => {
    const k = dedupeKey(base({ noticia_id: null, url: '', fecha_publicacion: '2026-06-29' }));
    expect(k).toContain('una nota válida');
    expect(k).toContain('2026-06-29');
  });

  it('misma nota con 3 keywords → 1 alerta agrupada (no 3 inmediatas) + 2 DUPLICADA', () => {
    const { candidatos, resumen } = evaluarLote([
      base({ mencion_id: 'M1', keyword: 'reforma laboral', keyword_alerta: true, valoracion: 1 }),
      base({ mencion_id: 'M2', keyword: 'conciliación laboral' }),
      base({ mencion_id: 'M3', keyword: 'Centro de Conciliación Laboral' }),
    ]);
    expect(candidatos).toHaveLength(3);
    expect(candidatos[0]!.estado_shadow).toBe('P1_INMEDIATA');
    expect(candidatos[1]!.estado_shadow).toBe('DUPLICADA');
    expect(candidatos[2]!.estado_shadow).toBe('DUPLICADA');
    expect(resumen.p1_inmediata).toBe(1);
    expect(resumen.duplicada).toBe(2);
  });

  it('notas/keywords_detectadas incluye las keywords agrupadas', () => {
    const { candidatos } = evaluarLote([
      base({ mencion_id: 'M1', keyword: 'reforma laboral' }),
      base({ mencion_id: 'M2', keyword: 'conciliación laboral' }),
    ]);
    expect(candidatos[0]!.keywords_detectadas).toContain('reforma laboral');
    expect(candidatos[0]!.keywords_detectadas).toContain('conciliación laboral');
  });

  it('notas no genera P1 múltiple por keywords de la misma nota', () => {
    const { resumen } = evaluarLote([
      base({ mencion_id: 'M1', keyword: 'k1', requiere_alerta: true, valoracion: 1 }),
      base({ mencion_id: 'M2', keyword: 'k2', requiere_alerta: true, valoracion: 1 }),
      base({ mencion_id: 'M3', keyword: 'k3', requiere_alerta: true, valoracion: 1 }),
    ]);
    expect(resumen.p1_inmediata).toBe(1);
    expect(resumen.duplicada).toBe(2);
  });
});

describe('normalizarValoracion', () => {
  it('mantiene 0–1 y convierte 0–100', () => {
    expect(normalizarValoracion(0.8)).toBeCloseTo(0.8);
    expect(normalizarValoracion(80)).toBeCloseTo(0.8);
    expect(normalizarValoracion(null)).toBe(0);
  });
});

describe('contrato 10_Alertas_Sombra', () => {
  it('headers correctos y en orden (25)', () => {
    expect(ALERTAS_SOMBRA_HEADERS).toEqual([
      'run_id', 'fecha_ejecucion', 'modo', 'cliente_id', 'cliente', 'mencion_id',
      'noticia_id', 'fecha_publicacion', 'medio', 'titulo', 'url', 'keyword',
      'grupo_tema', 'sentimiento', 'valoracion', 'prioridad_medio',
      'tipo_alerta_simulada', 'canal_simulado', 'habria_alerta', 'motivo_alerta',
      'motivo_bloqueo', 'regla_disparo', 'dedupe_key', 'estado_shadow', 'notas',
    ]);
    expect(ALERTAS_SOMBRA_HEADERS).toHaveLength(25);
  });
});
