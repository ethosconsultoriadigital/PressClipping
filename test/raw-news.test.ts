import { describe, it, expect, vi } from 'vitest';
import { OUTPUT_TABS } from '../src/sheets/client.js';
import {
  NOTICIAS_RAW_HEADERS,
  noticiaToOutputRow,
} from '../src/exporters/sheetRows.js';
import { exportRawNews, type ExportRawDeps } from '../src/exporters/rawNews.js';
import type { NoticiaRawRow } from '../src/types/noticia.js';

function noticia(over: Partial<NoticiaRawRow> = {}): NoticiaRawRow {
  return {
    noticia_id: 'n1',
    fecha_publicacion: '2026-01-01T00:00:00Z',
    fecha_captura: '2026-01-02T00:00:00Z',
    medio: 'Medio X',
    grupo_medio: 'Grupo Y',
    pais: 'MX',
    estado: 'Jalisco',
    region: 'Occidente',
    categoria: 'Digital',
    titulo: 'Titulo',
    url_original: 'https://x.mx/a',
    url_canonica: 'https://x.mx/a',
    resumen: 'resumen',
    texto_extraido: null,
    autor: 'Autor',
    seccion: 'Local',
    imagen_url: null,
    fuente_metodo: 'sitemap',
    hash: 'abc123',
    estado_procesamiento: 'ok',
    menciones_procesado: false,
    created_at: '2026-01-02T00:00:00Z',
    ...over,
  };
}

describe('noticiaToOutputRow', () => {
  it('genera exactamente las 24 columnas de 01_Noticias_Raw', () => {
    const row = noticiaToOutputRow(noticia());
    expect(Object.keys(row)).toHaveLength(24);
    expect(new Set(Object.keys(row))).toEqual(new Set(NOTICIAS_RAW_HEADERS));
  });

  it('mapea los campos esperados', () => {
    const row = noticiaToOutputRow(noticia());
    expect(row.noticia_id).toBe('n1');
    expect(row.medio).toBe('Medio X');
    expect(row.imagen_url).toBeNull();
    expect(row.fuente_metodo).toBe('sitemap');
    expect(row.hash).toBe('abc123');
  });
});

describe('01_Noticias_Raw escribe en la Sheet de salida', () => {
  it('OUTPUT_TABS.NOTICIAS_RAW apunta a la pestaña correcta', () => {
    expect(OUTPUT_TABS.NOTICIAS_RAW).toBe('01_Noticias_Raw');
  });
});

function deps(over: Partial<ExportRawDeps> = {}): {
  d: ExportRawDeps;
  fetchNoticias: ReturnType<typeof vi.fn>;
  appendRows: ReturnType<typeof vi.fn>;
  markExportadas: ReturnType<typeof vi.fn>;
} {
  const fetchNoticias = vi.fn(async () => [noticia({ noticia_id: 'n1' }), noticia({ noticia_id: 'n2' })]);
  const appendRows = vi.fn(async (rows: unknown[]) => rows.length);
  const markExportadas = vi.fn(async () => {});
  const d: ExportRawDeps = {
    fetchNoticias: over.fetchNoticias ?? (fetchNoticias as unknown as ExportRawDeps['fetchNoticias']),
    appendRows: over.appendRows ?? (appendRows as unknown as ExportRawDeps['appendRows']),
    markExportadas: over.markExportadas ?? (markExportadas as unknown as ExportRawDeps['markExportadas']),
  };
  return { d, fetchNoticias, appendRows, markExportadas };
}

describe('exportRawNews', () => {
  it('--dry-run no escribe ni marca', async () => {
    const { d, appendRows, markExportadas } = deps();
    const res = await exportRawNews(d, { onlyNew: true, dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.leidas).toBe(2);
    expect(appendRows).not.toHaveBeenCalled();
    expect(markExportadas).not.toHaveBeenCalled();
  });

  it('--only-new filtra por exportado_sheet_raw=false (onlyNew=true a fetch)', async () => {
    const { d, fetchNoticias } = deps();
    await exportRawNews(d, { onlyNew: true, dryRun: false });
    expect(fetchNoticias).toHaveBeenCalledWith(
      expect.objectContaining({ onlyNew: true }),
    );
  });

  it('si falla el append a Sheet, NO marca como exportado', async () => {
    const appendRows = vi.fn(async () => {
      throw new Error('Sheets caído');
    });
    const markExportadas = vi.fn(async () => {});
    const { d } = deps({
      appendRows: appendRows as unknown as ExportRawDeps['appendRows'],
      markExportadas: markExportadas as unknown as ExportRawDeps['markExportadas'],
    });
    await expect(exportRawNews(d, { onlyNew: true, dryRun: false })).rejects.toThrow('Sheets caído');
    expect(markExportadas).not.toHaveBeenCalled();
  });

  it('si exporta correctamente, marca como exportado con los ids', async () => {
    const { d, appendRows, markExportadas } = deps();
    const res = await exportRawNews(d, { onlyNew: true, dryRun: false });
    expect(appendRows).toHaveBeenCalledTimes(1);
    expect(res.escritas).toBe(2);
    expect(res.marcadas).toBe(2);
    expect(markExportadas).toHaveBeenCalledWith(['n1', 'n2']);
  });

  it('sin noticias no escribe ni marca', async () => {
    const fetchNoticias = vi.fn(async () => []);
    const { d, appendRows, markExportadas } = deps({
      fetchNoticias: fetchNoticias as unknown as ExportRawDeps['fetchNoticias'],
    });
    const res = await exportRawNews(d, { onlyNew: true, dryRun: false });
    expect(res.escritas).toBe(0);
    expect(appendRows).not.toHaveBeenCalled();
    expect(markExportadas).not.toHaveBeenCalled();
  });
});
