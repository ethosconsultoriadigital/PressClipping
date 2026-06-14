import { describe, it, expect } from 'vitest';
import {
  tituloDesdeUrl,
  resolverTitulo,
  MARCADOR_TITULO_DESDE_URL,
} from '../src/extractors/titleFromUrl.js';

describe('tituloDesdeUrl', () => {
  it('convierte un slug con guiones bajos en título legible', () => {
    expect(
      tituloDesdeUrl('https://medio.mx/deportes/messi_se_integro_a_la_seleccion_de_argentina'),
    ).toBe('Messi se integro a la seleccion de argentina');
  });

  it('convierte un slug con guiones medios', () => {
    expect(tituloDesdeUrl('https://medio.mx/nota/hola-mundo-cruel')).toBe('Hola mundo cruel');
  });

  it('mezcla guiones y guiones bajos', () => {
    expect(tituloDesdeUrl('https://medio.mx/a/uno-dos_tres-cuatro')).toBe('Uno dos tres cuatro');
  });

  it('quita la extensión .html', () => {
    expect(tituloDesdeUrl('https://medio.mx/nota/algo-importante.html')).toBe('Algo importante');
  });

  it('quita extensión .php y similares', () => {
    expect(tituloDesdeUrl('https://medio.mx/ver-nota.php')).toBe('Ver nota');
  });

  it('ignora el query string', () => {
    expect(tituloDesdeUrl('https://medio.mx/nota/gran-noticia?utm_source=rss&id=9')).toBe(
      'Gran noticia',
    );
  });

  it('ignora el fragmento (#)', () => {
    expect(tituloDesdeUrl('https://medio.mx/nota/otra-nota#comentarios')).toBe('Otra nota');
  });

  it('tolera barra final', () => {
    expect(tituloDesdeUrl('https://medio.mx/seccion/nota-final/')).toBe('Nota final');
  });

  it('decodifica caracteres percent-encoded', () => {
    expect(tituloDesdeUrl('https://medio.mx/nota/ciudad%20de%20mexico')).toBe('Ciudad de mexico');
  });

  it('devuelve null para URL sin path (solo dominio)', () => {
    expect(tituloDesdeUrl('https://medio.mx')).toBeNull();
    expect(tituloDesdeUrl('https://medio.mx/')).toBeNull();
  });

  it('devuelve null para cadena vacía', () => {
    expect(tituloDesdeUrl('')).toBeNull();
  });

  it('funciona con cadenas que no son URL absolutas (usa el último segmento)', () => {
    expect(tituloDesdeUrl('/ruta/relativa-a-algo')).toBe('Relativa a algo');
  });

  it('colapsa múltiples separadores en un solo espacio', () => {
    expect(tituloDesdeUrl('https://medio.mx/nota/uno--dos__tres')).toBe('Uno dos tres');
  });
});

describe('resolverTitulo', () => {
  it('conserva el título real si existe (no genera desde URL)', () => {
    const r = resolverTitulo('Título Real de la Nota', 'https://medio.mx/slug-cualquiera');
    expect(r.titulo).toBe('Título Real de la Nota');
    expect(r.generadoDesdeUrl).toBe(false);
  });

  it('recorta el título real con espacios sobrantes', () => {
    const r = resolverTitulo('  Hola  ', 'https://medio.mx/x');
    expect(r.titulo).toBe('Hola');
    expect(r.generadoDesdeUrl).toBe(false);
  });

  it('genera desde URL si el título es null', () => {
    const r = resolverTitulo(null, 'https://medio.mx/nota/messi-campeon');
    expect(r.titulo).toBe('Messi campeon');
    expect(r.generadoDesdeUrl).toBe(true);
  });

  it('genera desde URL si el título es cadena vacía o solo espacios', () => {
    const r = resolverTitulo('   ', 'https://medio.mx/nota/otra-cosa');
    expect(r.titulo).toBe('Otra cosa');
    expect(r.generadoDesdeUrl).toBe(true);
  });

  it('devuelve null y generadoDesdeUrl=false si no hay título ni slug usable', () => {
    const r = resolverTitulo(null, 'https://medio.mx/');
    expect(r.titulo).toBeNull();
    expect(r.generadoDesdeUrl).toBe(false);
  });

  it('expone el marcador esperado', () => {
    expect(MARCADOR_TITULO_DESDE_URL).toBe('titulo_generado_desde_url');
  });
});
