/**
 * Tests de `ensureSheetTabAndHeaders` (I/O) con un fake mínimo de
 * GoogleSpreadsheet — sin tocar la API real. Cubre: creación de tab
 * inexistente, preservación de filas/tab existentes, readback real,
 * detección de mismatch, y que solo se toque la pestaña indicada.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fakeSheets: Record<string, any> = {};

vi.mock('../src/sheets/client.js', () => ({
  getOutputSpreadsheet: vi.fn(async () => fakeDoc),
  withSheetsRetry: vi.fn(async (op: () => Promise<any>) => op()),
}));

let fakeDoc: any;

beforeEach(() => {
  for (const k of Object.keys(fakeSheets)) delete fakeSheets[k];
  fakeDoc = {
    sheetsByTitle: fakeSheets,
    addSheet: vi.fn(async ({ title, headerValues }: { title: string; headerValues: string[] }) => {
      const sheet = makeFakeSheetClosure(title, headerValues, []);
      fakeSheets[title] = sheet;
      return sheet;
    }),
  };
});

function makeFakeSheetClosure(title: string, headerValues: string[], rows: any[]) {
  const sheet: any = {
    title,
    headerValues: [...headerValues],
    columnCount: Math.max(headerValues.length, 10),
    rowCount: 100,
    loadHeaderRow: vi.fn(async () => undefined),
    getRows: vi.fn(async () => rows),
    setHeaderRow: vi.fn(async (h: string[]) => { sheet.headerValues = [...h]; }),
    resize: vi.fn(async () => undefined),
  };
  return sheet;
}

describe('ensureSheetTabAndHeaders', () => {
  it('crea la tab si no existe, con readback confirmando los headers', async () => {
    const { ensureSheetTabAndHeaders } = await import('../src/sheets/write.js');
    const res = await ensureSheetTabAndHeaders('11_Operacion_Sin_PressClipping', ['fecha', 'cliente_id', 'titulo']);
    expect(res.accion).toBe('crear_tab');
    expect(res.readback_headers).toEqual(['fecha', 'cliente_id', 'titulo']);
    expect(res.mismatch).toBe(false);
    expect(fakeDoc.addSheet).toHaveBeenCalledTimes(1);
  });

  it('preserva filas existentes de una tab que ya tiene headers completos (sin_cambios)', async () => {
    const filasExistentes = [{ get: () => 'x' }, { get: () => 'y' }];
    fakeSheets['11_Operacion_Sin_PressClipping'] = makeFakeSheetClosure(
      '11_Operacion_Sin_PressClipping', ['fecha', 'cliente_id', 'titulo'], filasExistentes,
    );
    const { ensureSheetTabAndHeaders } = await import('../src/sheets/write.js');
    const res = await ensureSheetTabAndHeaders('11_Operacion_Sin_PressClipping', ['fecha', 'cliente_id', 'titulo']);
    expect(res.accion).toBe('sin_cambios');
    expect(res.filas_preexistentes).toBe(2);
    expect(fakeSheets['11_Operacion_Sin_PressClipping'].setHeaderRow).not.toHaveBeenCalled();
  });

  it('agrega columnas faltantes sin perder las filas preexistentes', async () => {
    const filasExistentes = [{ get: () => 'x' }];
    fakeSheets['11_Operacion_Sin_PressClipping'] = makeFakeSheetClosure(
      '11_Operacion_Sin_PressClipping', ['fecha', 'cliente_id'], filasExistentes,
    );
    const { ensureSheetTabAndHeaders } = await import('../src/sheets/write.js');
    const res = await ensureSheetTabAndHeaders('11_Operacion_Sin_PressClipping', ['fecha', 'cliente_id', 'titulo']);
    expect(res.accion).toBe('agregar_columnas');
    expect(res.columnas_agregadas).toEqual(['titulo']);
    expect(res.filas_preexistentes).toBe(1);
    expect(res.readback_headers).toEqual(['fecha', 'cliente_id', 'titulo']);
    expect(res.mismatch).toBe(false);
  });

  it('detecta mismatch si el readback no coincide con lo planeado', async () => {
    const sheet = makeFakeSheetClosure('11_Operacion_Sin_PressClipping', [], []);
    // Simula que setHeaderRow "falla silenciosamente" y el readback ve otra cosa.
    sheet.setHeaderRow = vi.fn(async () => { sheet.headerValues = ['fecha']; }); // incompleto a propósito
    fakeSheets['11_Operacion_Sin_PressClipping'] = sheet;
    const { ensureSheetTabAndHeaders } = await import('../src/sheets/write.js');
    const res = await ensureSheetTabAndHeaders('11_Operacion_Sin_PressClipping', ['fecha', 'cliente_id', 'titulo']);
    expect(res.mismatch).toBe(true);
  });

  it('no toca ninguna otra pestaña del documento', async () => {
    fakeSheets['05_Comparativo_PressClipping'] = makeFakeSheetClosure('05_Comparativo_PressClipping', ['a', 'b'], [{ get: () => '1' }]);
    const otraAntes = { ...fakeSheets['05_Comparativo_PressClipping'] };
    const { ensureSheetTabAndHeaders } = await import('../src/sheets/write.js');
    await ensureSheetTabAndHeaders('11_Operacion_Sin_PressClipping', ['fecha']);
    expect(fakeSheets['05_Comparativo_PressClipping'].setHeaderRow).not.toHaveBeenCalled();
    expect(fakeSheets['05_Comparativo_PressClipping'].headerValues).toEqual(otraAntes.headerValues);
  });
});
