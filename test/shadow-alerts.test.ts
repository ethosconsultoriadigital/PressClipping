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

/** Mención base válida y no crítica (prioridad media). */
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
    const r = verificarFlagsAlertasSombra([
      '--window-hours=48', '--output=sheet', '--dry-run',
      '--no-send', '--no-whatsapp', '--no-email',
    ]);
    expect(r.ok).toBe(true);
  });

  it('bloquea --send con mensaje claro y sin enviar', () => {
    const r = verificarFlagsAlertasSombra(['--send']);
    expect(r.ok).toBe(false);
    expect(r.mensaje).toBe('Shadow alerts forbid real sending.');
  });

  it('bloquea --whatsapp y --email', () => {
    expect(verificarFlagsAlertasSombra(['--whatsapp']).ok).toBe(false);
    expect(verificarFlagsAlertasSombra(['--email']).ok).toBe(false);
  });

  it('bloquea --twilio / --gmail / --smtp / --enviar', () => {
    for (const f of ['--twilio', '--gmail', '--smtp', '--enviar']) {
      expect(verificarFlagsAlertasSombra([f]).ok).toBe(false);
    }
  });
});

describe('reglas determinísticas de alertas sombra', () => {
  it('genera alerta INMEDIATA para mención crítica válida (sentimiento negativo)', () => {
    const d = evaluarMencion(base({ sentimiento: 'negativo' }));
    expect(d.habria_alerta).toBe('SÍ');
    expect(d.tipo_alerta_simulada).toBe('inmediata');
    expect(d.canal_simulado).toBe('whatsapp');
    expect(d.estado_shadow).toBe('candidato');
    expect(d.regla_disparo).toContain('sentimiento_negativo');
  });

  it('valoración alta (>=0.7) también detona inmediata', () => {
    const d = evaluarMencion(base({ valoracion: 0.9 }));
    expect(d.tipo_alerta_simulada).toBe('inmediata');
    expect(d.regla_disparo).toContain('valoracion_alta');
  });

  it('keyword crítica y medio prioridad alta detonan inmediata', () => {
    expect(evaluarMencion(base({ keyword_prioridad: 'critica' })).regla_disparo)
      .toContain('keyword_critica');
    expect(evaluarMencion(base({ prioridad_medio: 'alta' })).regla_disparo)
      .toContain('medio_prioridad_alta');
  });

  it('genera RESUMEN para mención válida no crítica (prioridad media)', () => {
    const d = evaluarMencion(base());
    expect(d.habria_alerta).toBe('SÍ');
    expect(d.tipo_alerta_simulada).toBe('resumen');
    expect(d.canal_simulado).toBe('email');
    expect(d.regla_disparo).toBe('mencion_valida_no_critica');
  });

  it('marca baja_prioridad (monitoreo, sin alerta) para medio prioridad baja no crítico', () => {
    const d = evaluarMencion(base({ prioridad_medio: 'baja', keyword_prioridad: 'baja' }));
    expect(d.habria_alerta).toBe('NO');
    expect(d.tipo_alerta_simulada).toBe('monitoreo');
    expect(d.estado_shadow).toBe('baja_prioridad');
  });

  it('bloquea cliente inactivo', () => {
    const d = evaluarMencion(base({ cliente_activo: false, sentimiento: 'negativo' }));
    expect(d.estado_shadow).toBe('bloqueada');
    expect(d.habria_alerta).toBe('NO');
    expect(d.motivo_bloqueo).toBe('cliente_inactivo');
  });

  it('bloquea alertas de cliente desactivadas', () => {
    expect(evaluarMencion(base({ cliente_alertas_activas: false })).motivo_bloqueo)
      .toBe('alertas_cliente_desactivadas');
  });

  it('bloquea keyword inactiva', () => {
    const d = evaluarMencion(base({ keyword_activa: false, sentimiento: 'negativo' }));
    expect(d.estado_shadow).toBe('bloqueada');
    expect(d.motivo_bloqueo).toBe('keyword_inactiva');
  });

  it('bloquea falso positivo, sin URL, sin título y sin medio', () => {
    expect(evaluarMencion(base({ es_falso_positivo: true })).motivo_bloqueo).toBe('posible_falso_positivo');
    expect(evaluarMencion(base({ url: '' })).motivo_bloqueo).toBe('sin_url');
    expect(evaluarMencion(base({ titulo: '' })).motivo_bloqueo).toBe('sin_titulo');
    expect(evaluarMencion(base({ medio: '' })).motivo_bloqueo).toBe('sin_medio');
  });
});

describe('dedupe_key estable y bloqueo de duplicados', () => {
  it('dedupe_key usa cliente_id + mencion_id cuando existe', () => {
    expect(dedupeKey(base())).toBe('CLI-1::MEN-1');
  });

  it('dedupe_key cae a cliente_id + url_norm + keyword sin mencion_id', () => {
    const k = dedupeKey(base({ mencion_id: null }));
    expect(k.startsWith('CLI-1::')).toBe(true);
    expect(k).toContain('reforma laboral');
  });

  it('dedupe_key es estable entre llamadas con el mismo input', () => {
    expect(dedupeKey(base())).toBe(dedupeKey(base()));
  });

  it('evaluarLote marca la segunda aparición como duplicada', () => {
    const { candidatos, resumen } = evaluarLote([
      base({ sentimiento: 'negativo' }),
      base({ sentimiento: 'negativo' }), // mismo mencion_id → duplicada
    ]);
    expect(candidatos[0]!.estado_shadow).toBe('candidato');
    expect(candidatos[1]!.estado_shadow).toBe('duplicada');
    expect(candidatos[1]!.habria_alerta).toBe('NO');
    expect(resumen.duplicadas).toBe(1);
    expect(resumen.inmediatas).toBe(1);
  });
});

describe('normalizarValoracion', () => {
  it('mantiene escala 0–1 y convierte 0–100', () => {
    expect(normalizarValoracion(0.8)).toBeCloseTo(0.8);
    expect(normalizarValoracion(80)).toBeCloseTo(0.8);
    expect(normalizarValoracion(null)).toBe(0);
  });
});

describe('contrato 10_Alertas_Sombra', () => {
  it('headers correctos y en orden', () => {
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
