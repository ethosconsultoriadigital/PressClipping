/**
 * Tests de heurísticas de calidad de extracción (puras, sin red).
 */
import { describe, it, expect } from 'vitest';
import {
  encodingSospechoso,
  pareceBoilerplate,
  pareceListing,
  fechaValida,
  urlValida,
  clasificarExtraccion,
  medianaChars,
} from '../src/comparators/extractionQuality.js';

describe('encodingSospechoso', () => {
  it('detecta mojibake típico', () => {
    expect(encodingSospechoso('El niÃ±o comiÃ³ tacos')).toBe(true);
    expect(encodingSospechoso('informaciÃ³n')).toBe(true);
    expect(encodingSospechoso('carácter de reemplazo \uFFFD aquí')).toBe(true);
  });
  it('no marca texto UTF-8 correcto', () => {
    expect(encodingSospechoso('El niño comió tacos en Guanajuato')).toBe(false);
    expect(encodingSospechoso('')).toBe(false);
  });
});

describe('pareceBoilerplate', () => {
  it('detecta cuerpo corto dominado por navegación', () => {
    expect(pareceBoilerplate('Suscríbete a nuestro newsletter')).toBe(true);
  });
  it('detecta muchas señales de nav aunque sea largo', () => {
    const s = 'Publicidad. Lee también esto. Síguenos en redes. Compartir en Facebook. ' + 'x'.repeat(400);
    expect(pareceBoilerplate(s)).toBe(true);
  });
  it('no marca artículo normal', () => {
    expect(pareceBoilerplate('El gobierno de Guanajuato anunció medidas ' + 'contenido real '.repeat(30))).toBe(false);
    expect(pareceBoilerplate('')).toBe(false);
  });
});

describe('pareceListing', () => {
  it('detecta secciones/tags/home', () => {
    expect(pareceListing('https://medio.mx/')).toBe(true);
    expect(pareceListing('https://medio.mx/seccion/economia')).toBe(true);
    expect(pareceListing('https://medio.mx/tag/tequila')).toBe(true);
  });
  it('no marca notas individuales', () => {
    expect(pareceListing('https://medio.mx/2026/07/08/alcohol-adulterado-guanajuato-muertos')).toBe(false);
  });
});

describe('validadores básicos', () => {
  it('fechaValida', () => {
    expect(fechaValida('2026-07-08')).toBe(true);
    expect(fechaValida('2026-07-08T10:00:00Z')).toBe(true);
    expect(fechaValida('08/07/2026')).toBe(false);
    expect(fechaValida('')).toBe(false);
  });
  it('urlValida', () => {
    expect(urlValida('https://x.mx/a')).toBe(true);
    expect(urlValida('ftp://x')).toBe(false);
    expect(urlValida('')).toBe(false);
  });
});

describe('clasificarExtraccion', () => {
  it('SIN_CUERPO cuando dominan vacías', () => {
    expect(clasificarExtraccion({ notas: 10, pct_vacias: 80, pct_boilerplate: 0, pct_texto_600: 10, pct_texto_1200: 0, mediana_chars: 0 })).toBe('SIN_CUERPO');
  });
  it('BOILERPLATE cuando dominan nav', () => {
    expect(clasificarExtraccion({ notas: 10, pct_vacias: 0, pct_boilerplate: 50, pct_texto_600: 20, pct_texto_1200: 0, mediana_chars: 200 })).toBe('BOILERPLATE');
  });
  it('EXCELENTE con cuerpos largos', () => {
    expect(clasificarExtraccion({ notas: 10, pct_vacias: 0, pct_boilerplate: 0, pct_texto_600: 90, pct_texto_1200: 80, mediana_chars: 1500 })).toBe('EXTRACCION_EXCELENTE');
  });
  it('MALA con poco cuerpo', () => {
    expect(clasificarExtraccion({ notas: 10, pct_vacias: 10, pct_boilerplate: 0, pct_texto_600: 20, pct_texto_1200: 5, mediana_chars: 300 })).toBe('EXTRACCION_MALA');
  });
});

describe('medianaChars', () => {
  it('calcula mediana', () => {
    expect(medianaChars([100, 300, 200])).toBe(200);
    expect(medianaChars([100, 200])).toBe(150);
    expect(medianaChars([])).toBe(0);
  });
});
