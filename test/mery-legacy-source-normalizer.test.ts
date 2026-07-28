import { describe, it, expect } from 'vitest';
import {
  normalizeSourceLegacy,
  esAgregador,
  esLinkGoogleNews,
  esPagoConvenio,
  esFuentePropia,
} from '../src/normalizers/meryLegacySource.js';

describe('normalizeSourceLegacy — variantes obligatorias', () => {
  it('El Informador / informador.mx → "El Informador"', () => {
    expect(normalizeSourceLegacy('El Informador')).toBe('El Informador');
    expect(normalizeSourceLegacy('informador.mx')).toBe('El Informador');
  });

  it('Conciencia Pública: variantes mapean igual', () => {
    expect(normalizeSourceLegacy('Semanario Conciencia Pública')).toBe('Semanario Conciencia Pública');
    expect(normalizeSourceLegacy('Conciencia Pública')).toBe('Semanario Conciencia Pública');
    expect(normalizeSourceLegacy('concienciapublica.com.mx')).toBe('Semanario Conciencia Pública');
  });

  it('MURAL: variantes (incluyendo sufijo "| Periodismo independiente") mapean igual', () => {
    expect(normalizeSourceLegacy('MURAL')).toBe('MURAL');
    expect(normalizeSourceLegacy('mural.com.mx')).toBe('MURAL');
    expect(normalizeSourceLegacy('MURAL | Periodismo independiente')).toBe('MURAL');
  });

  it('UDG TV / Canal 44: todas las variantes mapean igual', () => {
    expect(normalizeSourceLegacy('UDG TV')).toBe('UDG TV / Canal 44');
    expect(normalizeSourceLegacy('udgtv.com')).toBe('UDG TV / Canal 44');
    expect(normalizeSourceLegacy('Canal 44')).toBe('UDG TV / Canal 44');
    expect(normalizeSourceLegacy('UDG TV Canal 44')).toBe('UDG TV / Canal 44');
  });

  it('A Fondo Jalisco: variantes mapean igual', () => {
    expect(normalizeSourceLegacy('A Fondo Jalisco')).toBe('A Fondo Jalisco');
    expect(normalizeSourceLegacy('afondojalisco.com')).toBe('A Fondo Jalisco');
  });

  it('AFmedios: variantes mapean igual', () => {
    expect(normalizeSourceLegacy('AFmedios')).toBe('AFmedios');
    expect(normalizeSourceLegacy('AFmedios Noticias')).toBe('AFmedios');
    expect(normalizeSourceLegacy('afmedios.com')).toBe('AFmedios');
  });

  it('PolíticoMX: variantes mapean igual', () => {
    expect(normalizeSourceLegacy('PolíticoMX')).toBe('Político MX');
    expect(normalizeSourceLegacy('Político MX')).toBe('Político MX');
    expect(normalizeSourceLegacy('politico.mx')).toBe('Político MX');
  });

  it('Milenio: variantes mapean igual', () => {
    expect(normalizeSourceLegacy('Milenio')).toBe('Milenio');
    expect(normalizeSourceLegacy('MILENIO')).toBe('Milenio');
    expect(normalizeSourceLegacy('milenio.com')).toBe('Milenio');
  });

  it('Notisistema / Tráfico ZMG / Vallarta Independiente / Página 24 Jalisco / Siker / Hoja de Ruta Digital / UnoTV / Partidero / Quadratín Jalisco / Reporte Índigo / PorEsto', () => {
    expect(normalizeSourceLegacy('notisistema.com')).toBe('Notisistema');
    expect(normalizeSourceLegacy('traficozmg.com')).toBe('Tráfico ZMG');
    expect(normalizeSourceLegacy('vallartaindependiente.com')).toBe('Vallarta Independiente');
    expect(normalizeSourceLegacy('pagina24jalisco.com.mx')).toBe('Página 24 Jalisco');
    expect(normalizeSourceLegacy('siker.com.mx')).toBe('Siker');
    expect(normalizeSourceLegacy('hojaderutadigital.mx')).toBe('Hoja de Ruta Digital');
    expect(normalizeSourceLegacy('unotv.com')).toBe('UnoTV');
    expect(normalizeSourceLegacy('partidero.com')).toBe('Partidero');
    expect(normalizeSourceLegacy('Quadratin Jalisco')).toBe('Quadratín Jalisco');
    expect(normalizeSourceLegacy('Reporte Indigo')).toBe('Reporte Índigo');
    expect(normalizeSourceLegacy('poresto.com')).toBe('PorEsto');
  });

  it('Talla Política / Talla Politica mapean igual', () => {
    expect(normalizeSourceLegacy('Talla Política')).toBe('Talla Política');
    expect(normalizeSourceLegacy('Talla Politica')).toBe('Talla Política');
  });

  it('fuente desconocida sin alias devuelve el texto original recortado', () => {
    expect(normalizeSourceLegacy('leyco.org')).toBe('leyco.org');
    expect(normalizeSourceLegacy('  edomexaldia.com  ')).toBe('edomexaldia.com');
  });

  it('null/undefined/vacío → cadena vacía', () => {
    expect(normalizeSourceLegacy(null)).toBe('');
    expect(normalizeSourceLegacy(undefined)).toBe('');
    expect(normalizeSourceLegacy('')).toBe('');
  });
});

describe('esAgregador — Google News y MSN NO son medios principales', () => {
  it('MSN es agregador', () => {
    expect(esAgregador(normalizeSourceLegacy('MSN'))).toBe(true);
  });

  it('Google News es agregador', () => {
    expect(esAgregador(normalizeSourceLegacy('Google News'))).toBe(true);
    expect(esAgregador(normalizeSourceLegacy('news.google.com'))).toBe(true);
  });

  it('un medio real no es agregador', () => {
    expect(esAgregador(normalizeSourceLegacy('El Informador'))).toBe(false);
    expect(esAgregador(normalizeSourceLegacy('Milenio'))).toBe(false);
  });
});

describe('esLinkGoogleNews', () => {
  it('detecta links news.google.com/rss/articles/...', () => {
    expect(esLinkGoogleNews('https://news.google.com/rss/articles/CBMi...')).toBe(true);
  });

  it('no detecta links directos', () => {
    expect(esLinkGoogleNews('https://udgtv.com/noticias/mery-pozos-confirma')).toBe(false);
  });

  it('null/undefined → false', () => {
    expect(esLinkGoogleNews(null)).toBe(false);
    expect(esLinkGoogleNews(undefined)).toBe(false);
  });
});

describe('esPagoConvenio — MURAL/Reforma/El Norte sin acceso público confirmado', () => {
  it('MURAL se marca D_PAGO_CONVENIO_API si no hay fuente autorizada', () => {
    expect(esPagoConvenio(normalizeSourceLegacy('MURAL | Periodismo independiente'))).toBe(true);
  });

  it('Reforma y El Norte también', () => {
    expect(esPagoConvenio(normalizeSourceLegacy('Reforma'))).toBe(true);
    expect(esPagoConvenio(normalizeSourceLegacy('El Norte'))).toBe(true);
  });

  it('un medio con acceso público normal no es pago/convenio', () => {
    expect(esPagoConvenio(normalizeSourceLegacy('El Informador'))).toBe(false);
  });
});

describe('esFuentePropia — Mery Pozos como source personal', () => {
  it('"Mery Pozos" como source se marca como fuente propia, no medio', () => {
    expect(esFuentePropia(normalizeSourceLegacy('Mery Pozos'))).toBe(true);
  });

  it('un medio real no es fuente propia', () => {
    expect(esFuentePropia(normalizeSourceLegacy('Milenio'))).toBe(false);
  });
});
