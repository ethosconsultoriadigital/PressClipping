/**
 * Generación de XML propio tipo PressClipping (mejorado) a partir de menciones.
 *
 * Formato estable <pressclipping_ethos> con una <nota> por mención. La función
 * de construcción y la de filtrado son puras y testeables (no tocan DB ni red).
 *
 * Política legal: <texto> contiene el RESUMEN/extracto, no la nota íntegra.
 */
import { create } from 'xmlbuilder2';
import { DateTime } from 'luxon';
import type { MencionExportRow } from '../types/mencion.js';

export interface FiltrosXml {
  cliente?: string;
  keyword?: string;
  medio?: string;
  region?: string;
  estadoRevision?: string;
  desde?: string; // fecha ISO (YYYY-MM-DD o completa)
  hasta?: string; // fecha ISO; inclusiva hasta fin de día
}

export interface NotaXml {
  id: string;
  cliente: string;
  keyword: string;
  fecha_publicacion: string;
  medio: string;
  titulo: string;
  texto: string;
  url_original: string;
  url_archivo: string;
  sentimiento: string;
  relevancia: string;
}

function lc(s: string | null | undefined): string {
  return (s ?? '').toLowerCase();
}

/** Aplica los filtros en memoria sobre las menciones recuperadas. */
export function aplicarFiltros(
  rows: MencionExportRow[],
  f: FiltrosXml,
): MencionExportRow[] {
  const desde = f.desde ? DateTime.fromISO(f.desde, { zone: 'utc' }) : null;
  const hasta = f.hasta
    ? DateTime.fromISO(f.hasta, { zone: 'utc' }).endOf('day')
    : null;

  return rows.filter((r) => {
    if (f.cliente && !lc(r.cliente).includes(lc(f.cliente))) return false;
    if (f.keyword && !lc(r.keyword).includes(lc(f.keyword))) return false;
    if (f.medio && !lc(r.medio).includes(lc(f.medio))) return false;
    if (f.region && !lc(r.region).includes(lc(f.region))) return false;
    if (f.estadoRevision && lc(r.estado_revision) !== lc(f.estadoRevision)) {
      return false;
    }
    if (desde?.isValid || hasta?.isValid) {
      if (!r.fecha_publicacion) return false;
      const fp = DateTime.fromISO(r.fecha_publicacion, { zone: 'utc' });
      if (!fp.isValid) return false;
      if (desde?.isValid && fp < desde) return false;
      if (hasta?.isValid && fp > hasta) return false;
    }
    return true;
  });
}

/** Convierte una fila de mención en la estructura de <nota>. */
export function mencionToNota(r: MencionExportRow): NotaXml {
  return {
    id: r.mencion_id,
    cliente: r.cliente ?? '',
    keyword: r.keyword ?? '',
    fecha_publicacion: r.fecha_publicacion ?? '',
    medio: r.medio ?? '',
    titulo: r.titulo ?? '',
    // Extracto/resumen, NO el texto íntegro (política de scraping responsable).
    texto: r.resumen ?? r.texto_match ?? '',
    url_original: r.url_original ?? '',
    url_archivo: '', // reservado para una copia archivada futura
    sentimiento: r.sentimiento ?? '',
    relevancia: r.relevancia != null ? String(r.relevancia) : '',
  };
}

/**
 * Construye el documento XML. Los campos de texto libre (titulo, texto) van en
 * CDATA; el resto se escapa automáticamente. xmlbuilder2 garantiza un XML
 * bien formado y sanitizado.
 */
export function buildPressclippingXml(notas: NotaXml[]): string {
  const root = create({ version: '1.0', encoding: 'UTF-8' }).ele(
    'pressclipping_ethos',
    {
      generado: DateTime.utc().toISO() ?? '',
      total: String(notas.length),
    },
  );

  for (const n of notas) {
    const nota = root.ele('nota');
    nota.ele('id').txt(n.id).up();
    nota.ele('cliente').txt(n.cliente).up();
    nota.ele('keyword').txt(n.keyword).up();
    nota.ele('fecha_publicacion').txt(n.fecha_publicacion).up();
    nota.ele('medio').txt(n.medio).up();
    nota.ele('titulo').dat(n.titulo).up();
    nota.ele('texto').dat(n.texto).up();
    nota.ele('url_original').txt(n.url_original).up();
    nota.ele('url_archivo').txt(n.url_archivo).up();
    nota.ele('sentimiento').txt(n.sentimiento).up();
    nota.ele('relevancia').txt(n.relevancia).up();
    nota.up();
  }

  return root.end({ prettyPrint: true });
}

/** Atajo: filtra, mapea y construye el XML en un solo paso. */
export function generarXml(rows: MencionExportRow[], filtros: FiltrosXml): {
  xml: string;
  total: number;
  ids: string[];
} {
  const filtradas = aplicarFiltros(rows, filtros);
  const notas = filtradas.map(mencionToNota);
  return {
    xml: buildPressclippingXml(notas),
    total: filtradas.length,
    ids: filtradas.map((r) => r.mencion_id),
  };
}
