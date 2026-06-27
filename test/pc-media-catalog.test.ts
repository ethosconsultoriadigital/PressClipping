import { describe, it, expect } from 'vitest';
import {
  calcularPrioridad,
  dominiosCoinciden,
  extraerDominioDesdeUrl,
  mejorMatch,
  normalizarDominio,
  normalizarNombreFuzzy,
  normalizarNombreMedio,
  pareceUrl,
  repararMojibake,
  similitudNombre,
  type MedioEthosLite,
} from '../src/validation/pcMediaCatalog.js';

describe('repararMojibake', () => {
  it('repara UTF-8 leído como Latin-1', () => {
    expect(repararMojibake('MÃ©xico')).toBe('México');
  });
  it('deja intacto texto limpio', () => {
    expect(repararMojibake('Aristegui Noticias')).toBe('Aristegui Noticias');
  });
});

describe('dominios', () => {
  it('extrae dominio de URL de nota', () => {
    expect(extraerDominioDesdeUrl('https://www.milenio.com/politica/nota-x')).toBe('milenio.com');
    expect(extraerDominioDesdeUrl('https://lado.mx/noticia/123')).toBe('lado.mx');
    expect(extraerDominioDesdeUrl('no-es-url')).toBeNull();
  });
  it('normaliza dominio', () => {
    expect(normalizarDominio('https://www.Forbes.com.mx/')).toBe('forbes.com.mx');
  });
  it('compara dominios y subdominios', () => {
    expect(dominiosCoinciden('editorial.aristeguinoticias.com', 'aristeguinoticias.com')).toBe(true);
    expect(dominiosCoinciden('milenio.com', 'eluniversal.com.mx')).toBe(false);
  });
  it('pareceUrl', () => {
    expect(pareceUrl('https://x.mx/a')).toBe(true);
    expect(pareceUrl('')).toBe(false);
    expect(pareceUrl('milenio')).toBe(false);
  });
});

describe('normalización de nombre', () => {
  it('conservadora quita .com/.mx y signos', () => {
    expect(normalizarNombreMedio('GlobalMedia.mx')).toBe('globalmedia');
    expect(normalizarNombreMedio('Aristegui Noticias')).toBe('aristegui noticias');
    expect(normalizarNombreMedio('El Informador')).toBe('el informador');
  });
  it('fuzzy quita sufijos genéricos pero no prefijos', () => {
    expect(normalizarNombreFuzzy('Aristegui Noticias')).toBe('aristegui');
    expect(normalizarNombreFuzzy('El Universal Online')).toBe('el universal');
    expect(normalizarNombreFuzzy('El Informador')).toBe('el informador');
  });
});

describe('similitudNombre', () => {
  it('idénticos → 1', () => {
    expect(similitudNombre('Milenio', 'Milenio')).toBe(1);
  });
  it('variantes cercanas → alta', () => {
    expect(similitudNombre('Aristegui Noticias', 'Aristegui')).toBeGreaterThanOrEqual(0.9);
  });
  it('distintos → baja', () => {
    expect(similitudNombre('Milenio', 'Forbes')).toBeLessThan(0.5);
  });
});

describe('mejorMatch', () => {
  const ethos: MedioEthosLite[] = [
    { medio_id: 'MED-0030', nombre_medio: 'Milenio', url_base: 'https://www.milenio.com', rss_url: null, sitemap_url: null, metodo_extraccion: 'SITEMAP', ultimo_estado: 'ok' },
    { medio_id: 'MED-0008', nombre_medio: 'Aristegui Noticias', url_base: 'https://aristeguinoticias.com', rss_url: null, sitemap_url: null, metodo_extraccion: 'SITEMAP', ultimo_estado: 'ok' },
  ];
  it('MATCH_URL por dominio', () => {
    const r = mejorMatch('Milenio Diario', 'milenio.com', ethos);
    expect(r.tipo).toBe('MATCH_URL');
    expect(r.medio?.medio_id).toBe('MED-0030');
  });
  it('MATCH_EXACTO_NOMBRE', () => {
    const r = mejorMatch('Aristegui Noticias', 'otrodominio.com', ethos);
    expect(r.tipo).toBe('MATCH_EXACTO_NOMBRE');
  });
  it('SIN_MATCH para medio desconocido', () => {
    const r = mejorMatch('Periódico Inventado XYZ', 'inventado.mx', ethos);
    expect(r.tipo).toBe('SIN_MATCH');
  });
});

describe('calcularPrioridad', () => {
  it('ya existe → NO_AGREGAR', () => {
    expect(calcularPrioridad({ existeEnEthos: true, frecuencia: 10, esAgregador: false, tieneFuenteViable: true, esMexico: true, sinUrl: false }).prioridad_reparacion).toBe('NO_AGREGAR');
  });
  it('agregador → NO_AGREGAR', () => {
    expect(calcularPrioridad({ existeEnEthos: false, frecuencia: 10, esAgregador: true, tieneFuenteViable: true, esMexico: true, sinUrl: false }).prioridad_reparacion).toBe('NO_AGREGAR');
  });
  it('mexicano + alta frecuencia + fuente viable → ALTA', () => {
    const r = calcularPrioridad({ existeEnEthos: false, frecuencia: 8, esAgregador: false, tieneFuenteViable: true, esMexico: true, sinUrl: false });
    expect(r.prioridad_reparacion).toBe('ALTA');
    expect(r.prioridad_alta).toBe(true);
  });
  it('mexicano + frecuencia moderada → MEDIA', () => {
    expect(calcularPrioridad({ existeEnEthos: false, frecuencia: 3, esAgregador: false, tieneFuenteViable: true, esMexico: true, sinUrl: false }).prioridad_reparacion).toBe('MEDIA');
  });
  it('sin URL → REVISAR', () => {
    expect(calcularPrioridad({ existeEnEthos: false, frecuencia: 3, esAgregador: false, tieneFuenteViable: false, esMexico: true, sinUrl: true }).prioridad_reparacion).toBe('REVISAR');
  });
  it('sin fuente viable y baja frecuencia → NO_AGREGAR', () => {
    expect(calcularPrioridad({ existeEnEthos: false, frecuencia: 1, esAgregador: false, tieneFuenteViable: false, esMexico: true, sinUrl: false }).prioridad_reparacion).toBe('NO_AGREGAR');
  });
});
