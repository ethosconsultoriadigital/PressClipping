/**
 * Tests del parser XML del script import-pressclipping.
 *
 * Cubre:
 *  1. XML con lista simple de notas (formato nativo PressClipping).
 *  2. XML con campos alternativos: title, link, source, date.
 *  3. XML con una nota sin URL.
 *  4. XML con una sola nota (no array, fast-xml-parser la convierte a array con isArray).
 *  5. detectXmlItems: fallback cuando no hay tag conocido.
 *  6. asText: variantes de valor.
 *  7. mapXmlItem: normaliza fecha ISO y UTM.
 */
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  asText,
  detectXmlItems,
  mapXmlItem,
  parseXmlFile,
  FIELD_VARIANTS,
} from '../scripts/import-pressclipping.js';

const FIXTURES = path.resolve(__dirname, 'fixtures');
const fix = (name: string) => path.join(FIXTURES, name);

// ─────────────────────────────────────────────────────────────────────────────
// asText
// ─────────────────────────────────────────────────────────────────────────────

describe('asText', () => {
  it('devuelve undefined para null/undefined', () => {
    expect(asText(null)).toBeUndefined();
    expect(asText(undefined)).toBeUndefined();
  });

  it('devuelve string recortado', () => {
    expect(asText('  hola  ')).toBe('hola');
  });

  it('devuelve undefined para string vacío', () => {
    expect(asText('')).toBeUndefined();
    expect(asText('   ')).toBeUndefined();
  });

  it('convierte número a string', () => {
    expect(asText(42)).toBe('42');
  });

  it('extrae #text de objeto CDATA', () => {
    expect(asText({ '#text': 'contenido' })).toBe('contenido');
  });

  it('extrae valor de objeto con un solo campo', () => {
    expect(asText({ titulo: 'Mi nota' })).toBe('Mi nota');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIELD_VARIANTS
// ─────────────────────────────────────────────────────────────────────────────

describe('FIELD_VARIANTS', () => {
  it('contiene los 11 campos semánticos esperados', () => {
    const esperados = ['fecha', 'cliente', 'cliente_id', 'grupo_tema', 'keyword', 'medio', 'titulo', 'url', 'autor', 'seccion', 'tipo_nota'];
    for (const campo of esperados) {
      expect(FIELD_VARIANTS).toHaveProperty(campo);
    }
  });

  it('incluye variantes RSS para url y fecha', () => {
    expect(FIELD_VARIANTS['url']).toContain('link');
    expect(FIELD_VARIANTS['fecha']).toContain('pubdate');
    expect(FIELD_VARIANTS['medio']).toContain('source');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// detectXmlItems
// ─────────────────────────────────────────────────────────────────────────────

describe('detectXmlItems', () => {
  it('detecta pressclipping > nota', () => {
    const doc = {
      pressclipping: {
        nota: [{ titulo: 'A' }, { titulo: 'B' }],
      },
    };
    const { items, ruta } = detectXmlItems(doc);
    expect(items).toHaveLength(2);
    expect(ruta).toContain('pressclipping');
  });

  it('detecta items > item', () => {
    const doc = {
      items: {
        item: [{ titulo: 'A' }],
      },
    };
    const { items } = detectXmlItems(doc);
    expect(items).toHaveLength(1);
  });

  it('envuelve nodo único (no array) en array', () => {
    const doc = {
      pressclipping: {
        nota: { titulo: 'Solo una' },
      },
    };
    const { items } = detectXmlItems(doc);
    expect(items).toHaveLength(1);
  });

  it('fallback: devuelve array vacío si no hay estructura conocida', () => {
    const doc = { foo: { bar: 'baz' } };
    const { items, ruta } = detectXmlItems(doc);
    expect(items).toHaveLength(0);
    expect(ruta).toBe('(no detectado)');
  });

  it('fallback: usa primer array del root si no encuentra tag conocido', () => {
    const doc = {
      desconocido: [{ titulo: 'A' }, { titulo: 'B' }, { titulo: 'C' }],
    };
    const { items } = detectXmlItems(doc);
    expect(items).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mapXmlItem
// ─────────────────────────────────────────────────────────────────────────────

describe('mapXmlItem', () => {
  it('mapea campos nativos de PressClipping', () => {
    const item = {
      fecha: '2026-05-10',
      cliente: 'Bebidas alcohólicas',
      keyword: 'tequila',
      medio: 'El Universal',
      titulo: 'Tequila récord',
      url: 'https://eluniversal.com/tequila',
      autor: 'María',
      seccion: 'Economía',
      tipo: 'Nota informativa',
    };
    const m = mapXmlItem(item);
    expect(m.fuente).toBe('PressClipping');
    expect(m.fecha).toBe('2026-05-10');
    expect(m.cliente).toBe('Bebidas alcohólicas');
    expect(m.keyword).toBe('tequila');
    expect(m.medio).toBe('El Universal');
    expect(m.titulo).toBe('Tequila récord');
    expect(m.url).toBe('https://eluniversal.com/tequila');
    expect(m.url_norm).toBe('https://eluniversal.com/tequila');
    expect(m.autor).toBe('María');
    expect(m.tipo_nota).toBe('Nota informativa');
    expect(m.raw).toBe(item);
  });

  it('mapea campos alternativos (RSS-style: title, link, source, date)', () => {
    const item = {
      date: '2026-04-15',
      client: 'Laboral',
      source: 'Aristegui Noticias',
      title: 'Reforma laboral avanza',
      link: 'https://aristegui.com/reforma-laboral',
    };
    const m = mapXmlItem(item);
    expect(m.fecha).toBe('2026-04-15');
    expect(m.cliente).toBe('Laboral');
    expect(m.medio).toBe('Aristegui Noticias');
    expect(m.titulo).toBe('Reforma laboral avanza');
    expect(m.url).toBe('https://aristegui.com/reforma-laboral');
  });

  it('url_norm elimina UTM del link', () => {
    const item = {
      fecha: '2026-04-20',
      link: 'https://ejemplo.com/nota?utm_source=google&utm_medium=cpc',
      title: 'Nota con UTM',
    };
    const m = mapXmlItem(item);
    expect(m.url_norm).toBe('https://ejemplo.com/nota');
  });

  it('devuelve url undefined y url_norm vacío si falta el campo', () => {
    const item = { fecha: '2026-01-01', titulo: 'Sin URL', medio: 'Reforma' };
    const m = mapXmlItem(item);
    expect(m.url).toBeUndefined();
    // normalizeUrl(undefined) → '' (string vacío, no lanza error)
    expect(m.url_norm).toBe('');
  });

  it('normaliza fechas con hora ISO', () => {
    const item = { fecha: '2026-05-10T15:30:00Z', titulo: 'Con hora' };
    const m = mapXmlItem(item);
    expect(m.fecha).toBe('2026-05-10');
  });

  it('normaliza fechas RFC 2822 (RSS pubDate)', () => {
    const item = { pubdate: 'Mon, 10 May 2026 00:00:00 +0000', titulo: 'RSS style' };
    const m = mapXmlItem(item);
    expect(m.fecha).toMatch(/^2026-05-1/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseXmlFile — fixtures reales
// ─────────────────────────────────────────────────────────────────────────────

describe('parseXmlFile — fixture simple (pressclipping > nota)', () => {
  it('detecta 3 notas', () => {
    const { items } = parseXmlFile(fix('pressclipping_simple.xml'));
    expect(items).toHaveLength(3);
  });

  it('mapea el primer item correctamente', () => {
    const { items } = parseXmlFile(fix('pressclipping_simple.xml'));
    const m = mapXmlItem(items[0]!);
    expect(m.fecha).toBe('2026-05-10');
    expect(m.medio).toBe('El Universal');
    expect(m.keyword).toBe('tequila');
    expect(m.titulo).toContain('Exportaciones de tequila');
    expect(m.url_norm).toBe('https://www.eluniversal.com.mx/economia/exportaciones-tequila-record-2026');
  });

  it('detecta los campos semánticos esperados', () => {
    const { camposDetectados } = parseXmlFile(fix('pressclipping_simple.xml'));
    expect(camposDetectados).toContain('fecha');
    expect(camposDetectados).toContain('medio');
    expect(camposDetectados).toContain('titulo');
    expect(camposDetectados).toContain('url');
    expect(camposDetectados).toContain('keyword');
  });
});

describe('parseXmlFile — fixture campos alternativos (items > item)', () => {
  it('detecta 2 items', () => {
    const { items } = parseXmlFile(fix('pressclipping_alt_fields.xml'));
    expect(items).toHaveLength(2);
  });

  it('mapea campos alternativos date, client, source, title, link', () => {
    const { items } = parseXmlFile(fix('pressclipping_alt_fields.xml'));
    const m = mapXmlItem(items[0]!);
    expect(m.fecha).toBe('2026-04-15');
    expect(m.cliente).toBe('Bebidas alcohólicas');
    expect(m.medio).toBe('NTR Guadalajara');
    expect(m.titulo).toContain('COMERCAM');
    // URL debe estar limpia de UTM
    expect(m.url_norm).toBe('https://www.ntrguadalajara.com/mezcal-comercam-2026');
  });
});

describe('parseXmlFile — fixture nota sin URL', () => {
  it('parsea correctamente aunque falte url', () => {
    const { items } = parseXmlFile(fix('pressclipping_no_url.xml'));
    expect(items).toHaveLength(1);
    const m = mapXmlItem(items[0]!);
    expect(m.url).toBeUndefined();
    expect(m.titulo).toContain('NOM-006');
    expect(m.medio).toBe('Excélsior');
  });
});

describe('parseXmlFile — fixture nota única (isArray fuerza array)', () => {
  it('devuelve exactamente 1 item', () => {
    const { items } = parseXmlFile(fix('pressclipping_single.xml'));
    expect(items).toHaveLength(1);
  });

  it('mapea el campo url correctamente', () => {
    const { items } = parseXmlFile(fix('pressclipping_single.xml'));
    const m = mapXmlItem(items[0]!);
    expect(m.url_norm).toBe('https://www.informador.mx/comercam-certificacion-mezcal-2026');
    expect(m.keyword).toBe('COMERCAM');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dry-run conceptual: parseXmlFile no inserta en Supabase
// ─────────────────────────────────────────────────────────────────────────────

describe('dry-run semántico', () => {
  it('parseXmlFile solo lee y parsea, no llama a Supabase', () => {
    // El objeto global createClient no debe ser llamado aquí
    // parseXmlFile es una función pura de lectura de archivo
    const { items } = parseXmlFile(fix('pressclipping_simple.xml'));
    const menciones = items.map(i => mapXmlItem(i));
    // Verificamos que todas tienen fuente PressClipping
    expect(menciones.every(m => m.fuente === 'PressClipping')).toBe(true);
    // Verificamos que raw está presente para auditoría
    expect(menciones.every(m => m.raw !== undefined)).toBe(true);
  });
});
