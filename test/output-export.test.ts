import { describe, it, expect } from 'vitest';
import { resolveOutputSheetId } from '../src/config/env.js';
import {
  MENCIONES_HEADERS,
  LOGS_HEADERS,
  XML_EXPORT_HEADERS,
  mencionToOutputRow,
  logToOutputRow,
  xmlExportToOutputRow,
  resumenInclusion,
  type LogExportLike,
} from '../src/exporters/sheetRows.js';
import type { MencionExportRow } from '../src/types/mencion.js';

function mencion(over: Partial<MencionExportRow> = {}): MencionExportRow {
  return {
    mencion_id: 'm1',
    noticia_id: 'n1',
    fecha_publicacion: '2026-01-01T00:00:00Z',
    fecha_captura: '2026-01-02T00:00:00Z',
    cliente: 'Cliente A',
    keyword: 'gas natural',
    medio: 'Medio X',
    estado: 'Jalisco',
    region: 'Occidente',
    titulo: 'Titulo',
    url_original: 'https://x.mx/a',
    resumen: 'resumen',
    texto_match: 'gas natural',
    sentimiento: null,
    relevancia: 1,
    tema: null,
    subtema: null,
    requiere_alerta: false,
    estado_revision: 'pendiente',
    exportado_xml: false,
    ...over,
  };
}

describe('resolveOutputSheetId (fallback de Sheet de salida)', () => {
  it('usa GOOGLE_OUTPUT_SHEET_ID cuando existe', () => {
    expect(resolveOutputSheetId('OUT123', 'CTRL456')).toBe('OUT123');
  });

  it('usa GOOGLE_SHEET_ID como fallback si no hay output', () => {
    expect(resolveOutputSheetId(undefined, 'CTRL456')).toBe('CTRL456');
    expect(resolveOutputSheetId('', 'CTRL456')).toBe('CTRL456');
    expect(resolveOutputSheetId('   ', 'CTRL456')).toBe('CTRL456');
  });

  it('devuelve undefined si no hay ninguno', () => {
    expect(resolveOutputSheetId(undefined, undefined)).toBeUndefined();
    expect(resolveOutputSheetId('', '')).toBeUndefined();
  });
});

describe('mapeo de columnas a la Sheet de salida', () => {
  it('02_Menciones: las claves coinciden exactamente con los headers', () => {
    const row = mencionToOutputRow(mencion());
    expect(new Set(Object.keys(row))).toEqual(new Set(MENCIONES_HEADERS));
  });

  it('02_Menciones: mapea los campos disponibles', () => {
    const row = mencionToOutputRow(mencion());
    expect(row.mencion_id).toBe('m1');
    expect(row.cliente).toBe('Cliente A');
    expect(row.keyword).toBe('gas natural');
    expect(row.score_match).toBe(1);
    expect(row.exportado_xml).toBe(false);
  });

  it('04_Logs: las claves coinciden exactamente con los headers', () => {
    const log: LogExportLike = {
      fecha_hora: '2026-01-01T00:00:00Z',
      ejecutado_por: 'local',
      accion: 'crawl',
      nivel: 'info',
      mensaje: 'ok',
      medio_id: 'MED-0001',
      urls_detectadas: 10,
      notas_nuevas: 5,
      duplicados: 1,
      errores: 0,
      duracion_ms: 1234,
    };
    const row = logToOutputRow(log);
    expect(new Set(Object.keys(row))).toEqual(new Set(LOGS_HEADERS));
    expect(row.run_by).toBe('local');
    expect(row.noticias_nuevas).toBe(5);
  });

  it('03_XML_Export: las claves coinciden exactamente con los headers', () => {
    const row = xmlExportToOutputRow({
      xmlId: 'x1',
      fechaGeneracion: '2026-01-01T00:00:00Z',
      archivoXml: 'a.xml',
      rutaOUrl: 'output/a.xml',
      totalMenciones: 2,
      clientesIncluidos: ['Cliente A'],
      keywordsIncluidas: ['gas natural'],
      marcadoExportadoXml: false,
      estatus: 'ok',
    });
    expect(new Set(Object.keys(row))).toEqual(new Set(XML_EXPORT_HEADERS));
    expect(row.total_menciones).toBe(2);
    expect(row.clientes_incluidos).toBe('Cliente A');
  });
});

describe('resumenInclusion', () => {
  it('calcula clientes y keywords distintos', () => {
    const rows = [
      mencion({ cliente: 'A', keyword: 'k1' }),
      mencion({ cliente: 'A', keyword: 'k2' }),
      mencion({ cliente: 'B', keyword: 'k1' }),
    ];
    const { clientes, keywords } = resumenInclusion(rows);
    expect(clientes.sort()).toEqual(['A', 'B']);
    expect(keywords.sort()).toEqual(['k1', 'k2']);
  });

  it('ignora nulos', () => {
    const rows = [mencion({ cliente: null, keyword: null })];
    const { clientes, keywords } = resumenInclusion(rows);
    expect(clientes).toEqual([]);
    expect(keywords).toEqual([]);
  });
});
