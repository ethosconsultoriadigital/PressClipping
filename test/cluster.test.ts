import { describe, it, expect } from 'vitest';
import {
  normalizeTituloFuerte,
  contieneTokenRelevante,
  clusterizar,
  calcularMetricasCluster,
  type PCRecord,
} from '../src/comparators/cluster.js';

describe('normalizeTituloFuerte', () => {
  it('quita prefijos de columna editorial', () => {
    expect(normalizeTituloFuerte('INDICADOR POLITICO: Fut: México no subió'))
      .toBe(normalizeTituloFuerte('Fut: México no subió'));
  });
  it('normaliza acentos y puntuación', () => {
    expect(normalizeTituloFuerte('Tequila, ¡adulterado!')).toBe('tequila adulterado');
  });
});

describe('contieneTokenRelevante', () => {
  it('detecta entidad relevante', () => {
    expect(contieneTokenRelevante('Historia de un licor de tequila')).toBe(true);
    expect(contieneTokenRelevante('Reforma laboral en México')).toBe(true);
  });
  it('rechaza títulos sin entidad relevante', () => {
    expect(contieneTokenRelevante('Fut: México no subió, Mundial bajó')).toBe(false);
  });
});

describe('clusterizar', () => {
  const syndicated: PCRecord[] = [
    { fecha: '2026-06-26', keyword: 'Impuesto Bebidas Alcóholicas', medio: 'Expreso.press', titulo: 'Fut: México no subió, Mundial bajó; bien entre los medianos', url: 'https://a.mx/1', url_norm: 'https://a.mx/1' },
    { fecha: '2026-06-26', keyword: 'Impuesto Bebidas Alcóholicas', medio: 'Diario Cambio', titulo: 'Fut: México no subió, Mundial bajó; bien entre los medianos', url: 'https://b.mx/1', url_norm: 'https://b.mx/1' },
    { fecha: '2026-06-26', keyword: 'Impuesto Bebidas Alcóholicas', medio: 'Periodico Express', titulo: 'INDICADOR POLITICO: Fut: México no subió, Mundial bajó; bien entre los medianos', url: 'https://c.mx/1', url_norm: 'https://c.mx/1' },
  ];

  it('agrupa una columna sindicada con prefijo distinto en un solo cluster', () => {
    const clusters = clusterizar(syndicated);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.num_medios).toBe(3);
    expect(clusters[0]!.estado_cluster).toBe('PC_SYNDICATED_LOW_VALUE');
  });

  it('marca cluster relevante de un solo medio como ETHOS_ACTIONABLE_GAP', () => {
    const clusters = clusterizar([
      { fecha: '2026-06-25', keyword: 'Tequila', medio: 'La Silla Rota', titulo: 'Vuelve el tequila de la muerte', url: 'https://x.mx/t', url_norm: 'https://x.mx/t' },
    ]);
    expect(clusters[0]!.estado_cluster).toBe('ETHOS_ACTIONABLE_GAP');
  });

  it('marca cluster matcheado como ETHOS_MATCHED_CLUSTER', () => {
    const clusters = clusterizar(
      [{ fecha: '2026-06-25', keyword: 'Museo Jumex', medio: 'Coolhuntermx', titulo: 'Exhibiciones en CDMX', url: 'https://m.mx/1', url_norm: 'https://m.mx/1' }],
      new Set(['https://m.mx/1']),
    );
    expect(clusters[0]!.estado_cluster).toBe('ETHOS_MATCHED_CLUSTER');
    expect(clusters[0]!.matched).toBe(true);
  });

  it('no agrupa títulos distintos', () => {
    const clusters = clusterizar([
      { fecha: '2026-06-26', keyword: 'Tequila', medio: 'A', titulo: 'Historia de un licor de tequila' },
      { fecha: '2026-06-26', keyword: 'Tequila', medio: 'B', titulo: 'Superávit agroalimentario crece 30%' },
    ]);
    expect(clusters).toHaveLength(2);
  });
});

describe('calcularMetricasCluster', () => {
  it('excluye low_value y FP del denominador ajustado', () => {
    const clusters = clusterizar([
      { fecha: '2026-06-26', keyword: 'IEPS', medio: 'A', titulo: 'Fut: México no subió uno' },
      { fecha: '2026-06-26', keyword: 'IEPS', medio: 'B', titulo: 'Fut: México no subió uno' },
      { fecha: '2026-06-26', keyword: 'IEPS', medio: 'C', titulo: 'Fut: México no subió uno' },
      { fecha: '2026-06-26', keyword: 'Tequila', medio: 'D', titulo: 'Nuevo impuesto al tequila premium', url_norm: 'https://d.mx/1' },
    ], new Set(['https://d.mx/1']));
    const m = calcularMetricasCluster(clusters, 4);
    expect(m.pressclipping_clusters).toBe(2);
    expect(m.clusters_matched).toBe(1);
    expect(m.clusters_syndicated_low_value).toBe(1);
    // denominador ajustado = 2 - 0 fp - 1 lowValue = 1 → 1/1 = 1.00
    expect(m.cobertura_ajustada_clusters).toBe('1.00');
  });
});
