import { describe, it, expect } from 'vitest';
import {
  buildPressclippingXml,
  aplicarFiltros,
  mencionToNota,
  generarXml,
  type NotaXml,
} from '../src/exporters/xml.js';
import type { MencionExportRow } from '../src/supabase/repositories.js';

function row(over: Partial<MencionExportRow>): MencionExportRow {
  return {
    mencion_id: over.mencion_id ?? 'm1',
    noticia_id: over.noticia_id ?? 'n1',
    fecha_publicacion: over.fecha_publicacion ?? '2026-06-03T10:00:00.000Z',
    fecha_captura: over.fecha_captura ?? '2026-06-03T11:00:00.000Z',
    cliente: over.cliente ?? 'Jumex',
    keyword: over.keyword ?? 'tequila',
    medio: over.medio ?? 'El Universal',
    estado: over.estado ?? 'Jalisco',
    region: over.region ?? 'Occidente',
    titulo: over.titulo ?? 'Título de prueba',
    url_original: over.url_original ?? 'https://medio.com/nota',
    resumen: over.resumen ?? 'Resumen de la nota.',
    texto_match: over.texto_match ?? 'fragmento',
    sentimiento: over.sentimiento ?? null,
    relevancia: over.relevancia ?? 0.8,
    tema: over.tema ?? null,
    subtema: over.subtema ?? null,
    requiere_alerta: over.requiere_alerta ?? false,
    estado_revision: over.estado_revision ?? 'pendiente',
    exportado_xml: over.exportado_xml ?? false,
  };
}

const nota: NotaXml = {
  id: 'm1',
  cliente: 'Jumex & Co',
  keyword: 'tequila',
  fecha_publicacion: '2026-06-03T10:00:00.000Z',
  medio: 'El Universal',
  titulo: 'Crisis <urgente> & "comillas"',
  texto: 'Texto con <etiquetas> y & ampersand',
  url_original: 'https://medio.com/nota?id=1&x=2',
  url_archivo: '',
  sentimiento: '',
  relevancia: '0.8',
};

describe('buildPressclippingXml', () => {
  it('produce la estructura raíz con atributos generado y total', () => {
    const xml = buildPressclippingXml([nota]);
    expect(xml).toContain('<pressclipping_ethos');
    expect(xml).toContain('total="1"');
    expect(xml).toContain('generado="');
    expect(xml).toContain('<nota>');
    expect(xml).toContain('<id>m1</id>');
  });

  it('usa CDATA para titulo y texto (no rompe con < > &)', () => {
    const xml = buildPressclippingXml([nota]);
    expect(xml).toContain('<titulo><![CDATA[Crisis <urgente> & "comillas"]]></titulo>');
    expect(xml).toContain('<texto><![CDATA[Texto con <etiquetas> y & ampersand]]></texto>');
  });

  it('escapa el ampersand en campos no-CDATA como url y cliente', () => {
    const xml = buildPressclippingXml([nota]);
    expect(xml).toContain('https://medio.com/nota?id=1&amp;x=2');
    expect(xml).toContain('<cliente>Jumex &amp; Co</cliente>');
  });

  it('genera total=0 sin notas', () => {
    const xml = buildPressclippingXml([]);
    expect(xml).toContain('total="0"');
    expect(xml).not.toContain('<nota>');
  });
});

describe('mencionToNota', () => {
  it('usa el resumen como <texto> (no texto íntegro) y serializa relevancia', () => {
    const n = mencionToNota(row({ resumen: 'Extracto.', relevancia: 0.5 }));
    expect(n.texto).toBe('Extracto.');
    expect(n.relevancia).toBe('0.5');
  });
});

describe('aplicarFiltros', () => {
  const rows = [
    row({ mencion_id: 'a', cliente: 'Jumex', keyword: 'tequila', medio: 'El Universal', region: 'Occidente', estado_revision: 'pendiente', fecha_publicacion: '2026-06-01T08:00:00Z' }),
    row({ mencion_id: 'b', cliente: 'Bimbo', keyword: 'pan', medio: 'Milenio', region: 'Centro', estado_revision: 'revisado', fecha_publicacion: '2026-06-04T08:00:00Z' }),
    row({ mencion_id: 'c', cliente: 'Jumex', keyword: 'jugo', medio: 'Reforma', region: 'Centro', estado_revision: 'pendiente', fecha_publicacion: '2026-06-10T08:00:00Z' }),
  ];

  it('filtra por cliente (case-insensitive, contiene)', () => {
    const r = aplicarFiltros(rows, { cliente: 'jumex' });
    expect(r.map((x) => x.mencion_id)).toEqual(['a', 'c']);
  });

  it('filtra por keyword', () => {
    const r = aplicarFiltros(rows, { keyword: 'tequila' });
    expect(r.map((x) => x.mencion_id)).toEqual(['a']);
  });

  it('filtra por estado_revision exacto', () => {
    const r = aplicarFiltros(rows, { estadoRevision: 'pendiente' });
    expect(r.map((x) => x.mencion_id)).toEqual(['a', 'c']);
  });

  it('filtra por rango de fechas (inclusivo)', () => {
    const r = aplicarFiltros(rows, { desde: '2026-06-01', hasta: '2026-06-05' });
    expect(r.map((x) => x.mencion_id)).toEqual(['a', 'b']);
  });

  it('combina filtros (cliente + rango)', () => {
    const r = aplicarFiltros(rows, { cliente: 'Jumex', desde: '2026-06-05' });
    expect(r.map((x) => x.mencion_id)).toEqual(['c']);
  });
});

describe('generarXml', () => {
  it('filtra, mapea y devuelve ids incluidos', () => {
    const rows = [row({ mencion_id: 'a', cliente: 'Jumex' }), row({ mencion_id: 'b', cliente: 'Bimbo' })];
    const { xml, total, ids } = generarXml(rows, { cliente: 'Jumex' });
    expect(total).toBe(1);
    expect(ids).toEqual(['a']);
    expect(xml).toContain('total="1"');
  });
});
