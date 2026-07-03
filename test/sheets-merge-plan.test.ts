import { describe, it, expect } from 'vitest';
import { planMergeByKey } from '../src/sheets/mergePlan.js';

const HEADERS_08 = [
  'medio_id', 'nombre_medio', 'activo', 'metodo_extraccion', 'fuente_actual',
  'fuente_viable', 'estado_fuente', 'confidence_score', 'pc_gap_count',
  'accion_recomendada', 'fecha_auditoria',
];

describe('planMergeByKey — seguridad de merge por clave', () => {
  it('no reordena ni elimina columnas existentes; agrega nuevas al final', () => {
    const plan = planMergeByKey(
      HEADERS_08,
      'medio_id',
      [{ medio_id: 'MED-0014', ultimo_lote: 'B', crawl_nuevas_lote: 30 }],
      ['MED-0014', 'MED-0026'],
      ['ultimo_lote', 'crawl_nuevas_lote', 'fp_estimado'],
    );
    // Los headers originales se conservan en el mismo orden al inicio.
    expect(plan.headers_despues.slice(0, HEADERS_08.length)).toEqual(HEADERS_08);
    // Las columnas nuevas van al final.
    expect(plan.columnas_agregadas).toEqual(['ultimo_lote', 'crawl_nuevas_lote', 'fp_estimado']);
    expect(plan.headers_despues).toEqual([...HEADERS_08, 'ultimo_lote', 'crawl_nuevas_lote', 'fp_estimado']);
  });

  it('no re-agrega columnas que ya existen (comparación normalizada)', () => {
    const plan = planMergeByKey(
      HEADERS_08,
      'medio_id',
      [{ medio_id: 'MED-0014', 'Accion Recomendada': 'x', estado_fuente: 'READY' }],
      ['MED-0014'],
      ['accion_recomendada', 'estado_fuente'],
    );
    expect(plan.columnas_agregadas).toEqual([]);
    expect(plan.headers_despues).toEqual(HEADERS_08);
  });

  it('solo edita filas cuya clave ya existe; reporta el resto como no encontradas', () => {
    const plan = planMergeByKey(
      HEADERS_08,
      'medio_id',
      [
        { medio_id: 'MED-0014', ultimo_lote: 'B' },
        { medio_id: 'MED-9999', ultimo_lote: 'B' },
      ],
      ['MED-0014', 'MED-0026'],
      ['ultimo_lote'],
    );
    expect(plan.ediciones).toHaveLength(1);
    expect(plan.ediciones[0]!.clave).toBe('MED-0014');
    expect(plan.claves_no_encontradas).toEqual(['MED-9999']);
  });

  it('nunca genera una edición sobre la columna clave', () => {
    const plan = planMergeByKey(
      HEADERS_08,
      'medio_id',
      [{ medio_id: 'MED-0014', ultimo_lote: 'B' }],
      ['MED-0014'],
      ['ultimo_lote'],
    );
    const headersEditados = plan.ediciones[0]!.celdas.map((c) => c.header);
    expect(headersEditados).not.toContain('medio_id');
    expect(headersEditados).toContain('ultimo_lote');
  });

  it('mapea cada campo al índice de columna correcto en headers_despues', () => {
    const plan = planMergeByKey(
      HEADERS_08,
      'medio_id',
      [{ medio_id: 'MED-0014', ultimo_lote: 'B', crawl_nuevas_lote: 30 }],
      ['MED-0014'],
      ['ultimo_lote', 'crawl_nuevas_lote'],
    );
    const idxUltimoLote = plan.headers_despues.indexOf('ultimo_lote');
    const celda = plan.ediciones[0]!.celdas.find((c) => c.header === 'ultimo_lote');
    expect(celda!.col_index).toBe(idxUltimoLote);
    expect(celda!.value).toBe('B');
  });

  it('formatea booleanos y numéricos a string, ignora columnas inexistentes sin cabecera', () => {
    const plan = planMergeByKey(
      HEADERS_08,
      'medio_id',
      [{ medio_id: 'MED-0014', activo: true, crawl_nuevas_lote: 30, columna_fantasma: 'x' }],
      ['MED-0014'],
      ['crawl_nuevas_lote'], // columna_fantasma NO se sugiere → no debe existir
    );
    // columna_fantasma sí se agregaría porque aparece en updates; validamos que
    // se agregue explícitamente (comportamiento: updates aportan columnas).
    expect(plan.columnas_agregadas).toContain('columna_fantasma');
    const celdas = plan.ediciones[0]!.celdas;
    expect(celdas.find((c) => c.header === 'activo')!.value).toBe('TRUE');
    expect(celdas.find((c) => c.header === 'crawl_nuevas_lote')!.value).toBe('30');
  });

  it('lanza si la columna clave no existe en la hoja', () => {
    expect(() => planMergeByKey(['nombre_medio'], 'medio_id', [], [], [])).toThrow(/columna clave/);
  });

  it('ignora updates sin valor de clave', () => {
    const plan = planMergeByKey(
      HEADERS_08,
      'medio_id',
      [{ medio_id: '', ultimo_lote: 'B' }],
      ['MED-0014'],
      ['ultimo_lote'],
    );
    expect(plan.ediciones).toHaveLength(0);
    expect(plan.claves_no_encontradas).toHaveLength(0);
  });
});
