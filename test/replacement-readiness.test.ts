/**
 * Tests de OBSERVABILIDAD Y READINESS DE SUSTITUCIÓN.
 *
 * Cubre:
 *   - cabeceras de 10_Alertas_Sombra: preserva originales y agrega nuevas;
 *   - campos explícitos P1/P2/BLOQUEADA/DUPLICADA;
 *   - cluster_id estable y determinístico;
 *   - clasificador determinístico de SOLO_PRESSCLIPPING;
 *   - exclusión de CLI-PRUEBA del readiness ejecutivo;
 *   - estados de readiness por cliente.
 *
 * NO toca red, NO envía, NO IA.
 */
import { describe, it, expect } from 'vitest';
import {
  ALERTAS_SOMBRA_HEADERS,
  ALERTAS_SOMBRA_HEADERS_OBSERVABILIDAD,
  camposObservabilidad,
} from '../src/alerts/shadowAlertRules.js';
import { computeClusterFields } from '../src/notifications/grouping.js';
import {
  clasificarSoloPressclipping,
  esGapAccionable,
} from '../src/comparators/soloPressclippingClassifier.js';
import {
  esClientePrueba,
  estadoReadiness,
} from '../src/comparators/replacementReadiness.js';

describe('10_Alertas_Sombra headers', () => {
  const ORIGINALES = [
    'run_id', 'fecha_ejecucion', 'modo', 'cliente_id', 'cliente', 'mencion_id',
    'noticia_id', 'fecha_publicacion', 'medio', 'titulo', 'url', 'keyword',
    'grupo_tema', 'sentimiento', 'valoracion', 'prioridad_medio',
    'tipo_alerta_simulada', 'canal_simulado', 'habria_alerta', 'motivo_alerta',
    'motivo_bloqueo', 'regla_disparo', 'dedupe_key', 'estado_shadow', 'notas',
  ];

  it('preserva las 25 columnas originales en el mismo orden', () => {
    expect(ALERTAS_SOMBRA_HEADERS.slice(0, 25)).toEqual(ORIGINALES);
  });

  it('agrega las columnas nuevas de observabilidad al final', () => {
    for (const h of ALERTAS_SOMBRA_HEADERS_OBSERVABILIDAD) {
      expect(ALERTAS_SOMBRA_HEADERS).toContain(h);
    }
    // Las nuevas van DESPUÉS de las originales.
    expect(ALERTAS_SOMBRA_HEADERS.indexOf('prioridad_alerta')).toBe(25);
  });

  it('incluye todas las columnas obligatorias solicitadas', () => {
    const obligatorias = [
      'prioridad_alerta', 'es_p1', 'es_p2', 'estado_alerta', 'motivo_bloqueo',
      'es_duplicada', 'cluster_id', 'cluster_key', 'cluster_tema', 'cluster_region',
      'cluster_count', 'sin_envio', 'canal', 'workflow', 'tier', 'fuente',
      'shadow_client_allowlist', 'send_enabled', 'whatsapp_enabled', 'email_enabled',
    ];
    for (const h of obligatorias) expect(ALERTAS_SOMBRA_HEADERS).toContain(h);
  });

  it('no tiene columnas duplicadas', () => {
    const set = new Set(ALERTAS_SOMBRA_HEADERS);
    expect(set.size).toBe(ALERTAS_SOMBRA_HEADERS.length);
  });
});

describe('camposObservabilidad (P1/P2/BLOQUEADA/DUPLICADA explícitos)', () => {
  it('P1_INMEDIATA → P1', () => {
    const c = camposObservabilidad('P1_INMEDIATA');
    expect(c).toMatchObject({ prioridad_alerta: 'P1', es_p1: true, es_p2: false, es_duplicada: false, estado_alerta: 'P1' });
  });
  it('P2_RESUMEN → P2', () => {
    const c = camposObservabilidad('P2_RESUMEN');
    expect(c).toMatchObject({ prioridad_alerta: 'P2', es_p1: false, es_p2: true, estado_alerta: 'P2' });
  });
  it('BLOQUEADA → estado BLOQUEADA sin prioridad', () => {
    const c = camposObservabilidad('BLOQUEADA');
    expect(c).toMatchObject({ estado_alerta: 'BLOQUEADA', es_p1: false, es_p2: false, es_duplicada: false, prioridad_alerta: '' });
  });
  it('DUPLICADA → es_duplicada=true', () => {
    const c = camposObservabilidad('DUPLICADA');
    expect(c).toMatchObject({ estado_alerta: 'DUPLICADA', es_duplicada: true });
  });
});

describe('computeClusterFields (cluster_id estable)', () => {
  it('genera el mismo cluster_id para el mismo cliente/tema/región/fecha', () => {
    const a = computeClusterFields({ cliente_id: 'CLI-0002', keyword: 'alcohol adulterado', titulo: 'Intoxicación por metanol en Guanajuato', fecha_publicacion: '2026-07-08T10:00:00Z' });
    const b = computeClusterFields({ cliente_id: 'CLI-0002', keyword: 'tequila adulterado', titulo: 'Alcohol adulterado deja muertos en Guanajuato', fecha_publicacion: '2026-07-08T20:00:00Z' });
    expect(a.cluster_id).toBe(b.cluster_id);
    expect(a.cluster_id).toMatch(/^CL-[0-9a-f]{10}$/);
    expect(a.cluster_tema).toBe(b.cluster_tema);
  });

  it('separa clientes distintos', () => {
    const a = computeClusterFields({ cliente_id: 'CLI-0002', keyword: 'alcohol adulterado', titulo: 'crisis GTO', fecha_publicacion: '2026-07-08' });
    const b = computeClusterFields({ cliente_id: 'CLI-0003', keyword: 'alcohol adulterado', titulo: 'crisis GTO', fecha_publicacion: '2026-07-08' });
    expect(a.cluster_id).not.toBe(b.cluster_id);
  });

  it('separa fechas distintas (cluster_key incluye fecha_cluster)', () => {
    const a = computeClusterFields({ cliente_id: 'CLI-0002', keyword: 'x', titulo: 'y', fecha_publicacion: '2026-07-08' });
    const b = computeClusterFields({ cliente_id: 'CLI-0002', keyword: 'x', titulo: 'y', fecha_publicacion: '2026-07-09' });
    expect(a.cluster_key).not.toBe(b.cluster_key);
  });
});

describe('clasificarSoloPressclipping (determinístico)', () => {
  it('usa causa raíz previa PC_FALSE_POSITIVE', () => {
    const c = clasificarSoloPressclipping({ estado_comparativo: 'SOLO_PRESSCLIPPING', categoria: 'PC_FALSE_POSITIVE', medio: 'X', keyword: 'tequila', titulo: 'accidente' });
    expect(c.categoria_gap).toBe('PC_FALSE_POSITIVE');
    expect(esGapAccionable(c.categoria_gap)).toBe(false);
  });

  it('detecta sindicación por medio agregador', () => {
    const c = clasificarSoloPressclipping({ estado_comparativo: 'SOLO_PRESSCLIPPING', medio: 'MSN Noticias', keyword: 'k', titulo: 't', url_pressclipping: 'https://www.msn.com/es-mx/noticias/x' });
    expect(c.categoria_gap).toBe('SINDICADA_DUPLICADA_LOW_VALUE');
  });

  it('sin señal de ruido → GAP_REAL_ACCIONABLE', () => {
    const c = clasificarSoloPressclipping({ estado_comparativo: 'SOLO_PRESSCLIPPING', medio: 'El Diario Local', keyword: 'jumex', titulo: 'Museo Jumex inaugura muestra', url_pressclipping: 'https://diariolocal.mx/cultura/museo-jumex-inaugura-muestra' });
    expect(c.categoria_gap).toBe('GAP_REAL_ACCIONABLE');
    expect(esGapAccionable(c.categoria_gap)).toBe(true);
    expect(c.prioridad_gap).toBe('ALTA');
  });

  it('mapea causa de fuente bloqueada', () => {
    const c = clasificarSoloPressclipping({ estado_comparativo: 'SOLO_PRESSCLIPPING', categoria: 'ETHOS_SOURCE_BLOCKED', medio: 'X', keyword: 'k', titulo: 't' });
    expect(c.categoria_gap).toBe('FUENTE_BLOQUEADA');
  });
});

describe('readiness ejecutivo', () => {
  it('excluye CLI-PRUEBA por id', () => {
    expect(esClientePrueba('CLI-PRUEBA', 'Cliente Prueba')).toBe(true);
    expect(esClientePrueba('cli-prueba')).toBe(true);
  });
  it('excluye por nombre de prueba/test', () => {
    expect(esClientePrueba('CLI-9999', 'Demo Test')).toBe(true);
    expect(esClientePrueba('CLI-0001', 'Grupo Jumex')).toBe(false);
  });

  it('cliente de prueba → SOLO_TEST', () => {
    expect(estadoReadiness({ cobertura_vs_pc: 100, gap_real_estimado: 0, precision_estimada: 100, extraccion_score: 100, alertas_score: 100, es_prueba: true })).toBe('SOLO_TEST');
  });
  it('baja cobertura → NO_LISTO / NECESITA_MAS_COBERTURA', () => {
    expect(estadoReadiness({ cobertura_vs_pc: 20, gap_real_estimado: 80, precision_estimada: 90, extraccion_score: 80, alertas_score: 80 })).toBe('NO_LISTO');
    expect(estadoReadiness({ cobertura_vs_pc: 55, gap_real_estimado: 40, precision_estimada: 90, extraccion_score: 80, alertas_score: 80 })).toBe('NECESITA_MAS_COBERTURA');
  });
  it('cobertura alta + precisión/alertas/extracción altas → LISTO_PARA_PILOTO_INTERNO', () => {
    expect(estadoReadiness({ cobertura_vs_pc: 85, gap_real_estimado: 10, precision_estimada: 90, extraccion_score: 80, alertas_score: 90 })).toBe('LISTO_PARA_PILOTO_INTERNO');
  });
  it('cobertura alta pero alertas/extracción flojas → SHADOW_ESTABLE_NO_REAL', () => {
    expect(estadoReadiness({ cobertura_vs_pc: 80, gap_real_estimado: 10, precision_estimada: 90, extraccion_score: 40, alertas_score: 30 })).toBe('SHADOW_ESTABLE_NO_REAL');
  });
});
