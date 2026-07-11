import { describe, it, expect } from 'vitest';
import { planEnsureTabHeaders } from '../src/sheets/tabPlan.js';

describe('planEnsureTabHeaders', () => {
  it('crea tab inexistente: accion=crear_tab, todas las columnas "agregadas"', () => {
    const plan = planEnsureTabHeaders(false, [], ['fecha', 'cliente_id', 'titulo']);
    expect(plan.accion).toBe('crear_tab');
    expect(plan.headers_despues).toEqual(['fecha', 'cliente_id', 'titulo']);
    expect(plan.columnas_agregadas).toEqual(['fecha', 'cliente_id', 'titulo']);
  });

  it('tab existe pero sin fila de cabecera: fija headers vacíos', () => {
    const plan = planEnsureTabHeaders(true, [], ['fecha', 'cliente_id']);
    expect(plan.accion).toBe('fijar_headers_vacios');
    expect(plan.headers_despues).toEqual(['fecha', 'cliente_id']);
  });

  it('tab existe con headers completos: sin_cambios, no toca nada', () => {
    const plan = planEnsureTabHeaders(true, ['fecha', 'cliente_id', 'titulo'], ['fecha', 'cliente_id', 'titulo']);
    expect(plan.accion).toBe('sin_cambios');
    expect(plan.headers_despues).toEqual(['fecha', 'cliente_id', 'titulo']);
    expect(plan.columnas_agregadas).toEqual([]);
  });

  it('tab existe con headers parciales: agrega solo las columnas faltantes al final', () => {
    const plan = planEnsureTabHeaders(true, ['fecha', 'cliente_id'], ['fecha', 'cliente_id', 'titulo', 'url']);
    expect(plan.accion).toBe('agregar_columnas');
    expect(plan.headers_despues).toEqual(['fecha', 'cliente_id', 'titulo', 'url']);
    expect(plan.columnas_agregadas).toEqual(['titulo', 'url']);
  });

  it('NUNCA reordena columnas existentes (las preserva al inicio)', () => {
    const plan = planEnsureTabHeaders(true, ['titulo', 'fecha'], ['fecha', 'titulo', 'nueva']);
    expect(plan.headers_despues.slice(0, 2)).toEqual(['titulo', 'fecha']);
    expect(plan.headers_despues).toEqual(['titulo', 'fecha', 'nueva']);
  });

  it('detecta headers existentes por nombre normalizado (case/acentos)', () => {
    const plan = planEnsureTabHeaders(true, ['Fecha', 'Cliente_ID'], ['fecha', 'cliente_id', 'titulo']);
    expect(plan.accion).toBe('agregar_columnas');
    expect(plan.columnas_agregadas).toEqual(['titulo']);
  });

  it('nunca borra ni pierde columnas actuales aunque no estén en headersRequeridas', () => {
    const plan = planEnsureTabHeaders(true, ['fecha', 'columna_legacy'], ['fecha', 'titulo']);
    expect(plan.headers_despues).toContain('columna_legacy');
    expect(plan.headers_despues).toEqual(['fecha', 'columna_legacy', 'titulo']);
  });
});
