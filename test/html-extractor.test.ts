import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractFromHtml, fetchAndExtract, normalizarUrlImagen, limpiarTextoExtraido, extraerCuerpoNota } from '../src/extractors/html.js';

const PARRAFO = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';

function articulo(extra = ''): string {
  return `
    <article>
      <p>${PARRAFO}</p>
      <p>${PARRAFO}</p>
      ${extra}
    </article>`;
}

describe('extractFromHtml - título', () => {
  it('prioriza og:title', () => {
    const html = `<html><head>
      <meta property="og:title" content="Título OG">
      <meta name="twitter:title" content="Título TW">
      <title>Título Tag</title>
    </head><body><h1>Título H1</h1></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/nota/slug');
    expect(r.titulo).toBe('Título OG');
    expect(r.metodo_titulo).toBe('html_og');
  });

  it('usa twitter:title si no hay og:title', () => {
    const html = `<html><head>
      <meta name="twitter:title" content="Título TW">
      <title>Título Tag</title>
    </head><body></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/nota/slug');
    expect(r.titulo).toBe('Título TW');
    expect(r.metodo_titulo).toBe('html_twitter');
  });

  it('usa <title> si no hay metadatos OG/Twitter', () => {
    const html = `<html><head><title>Título Tag</title></head><body><h1>H1</h1></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/nota/slug');
    expect(r.titulo).toBe('Título Tag');
    expect(r.metodo_titulo).toBe('html_title');
  });

  it('usa <h1> si no hay <title>', () => {
    const html = `<html><head></head><body><h1>Título H1</h1></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/nota/slug');
    expect(r.titulo).toBe('Título H1');
    expect(r.metodo_titulo).toBe('html_h1');
  });

  it('cae al fallback del slug de la URL si no hay nada en el HTML', () => {
    const html = `<html><head></head><body><p>solo texto</p></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/nota/messi-es-campeon');
    expect(r.titulo).toBe('Messi es campeon');
    expect(r.metodo_titulo).toBe('fallback_url_slug');
  });
});

describe('extractFromHtml - resumen', () => {
  it('prioriza meta description', () => {
    const html = `<html><head>
      <meta name="description" content="Resumen meta">
      <meta property="og:description" content="Resumen OG">
    </head><body>${articulo()}</body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.resumen).toBe('Resumen meta');
  });

  it('usa og:description si no hay meta description', () => {
    const html = `<html><head>
      <meta property="og:description" content="Resumen OG">
    </head><body>${articulo()}</body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.resumen).toBe('Resumen OG');
  });

  it('si no hay metadatos, usa los primeros párrafos del texto', () => {
    const html = `<html><head></head><body>${articulo()}</body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.resumen).toBeTruthy();
    expect(r.resumen!.length).toBeLessThanOrEqual(600);
    expect(r.resumen!).toContain('Lorem ipsum');
  });
});

describe('extractFromHtml - texto', () => {
  it('extrae el cuerpo desde <article>', () => {
    const html = `<html><body>${articulo()}</body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.metodo_texto).toBe('html_article');
    expect(r.texto_extraido).toContain('Lorem ipsum');
  });

  it('extrae desde <main> si no hay <article>', () => {
    const html = `<html><body><main><p>${PARRAFO}</p><p>${PARRAFO}</p></main></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.metodo_texto).toBe('html_main');
    expect(r.texto_extraido).toContain('Lorem ipsum');
  });

  it('extrae desde contenedor común (.entry-content)', () => {
    const html = `<html><body><div class="entry-content"><p>${PARRAFO}</p><p>${PARRAFO}</p></div></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.metodo_texto).toBe('html_container');
    expect(r.texto_extraido).toContain('Lorem ipsum');
  });

  it('cae a párrafos sueltos del body si no hay contenedor conocido', () => {
    const html = `<html><body><p>${PARRAFO}</p><p>${PARRAFO}</p></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.metodo_texto).toBe('html_paragraphs');
    expect(r.texto_extraido).toContain('Lorem ipsum');
  });

  it('filtra ruido (script/nav/footer/ads)', () => {
    const html = `<html><body><article>
      <nav><p>menu navegacion</p></nav>
      <script>var x = 'codigo basura';</script>
      <p>${PARRAFO}</p>
      <p>${PARRAFO}</p>
      <footer><p>pie de pagina derechos</p></footer>
    </article></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.texto_extraido).toContain('Lorem ipsum');
    expect(r.texto_extraido).not.toContain('menu navegacion');
    expect(r.texto_extraido).not.toContain('codigo basura');
    expect(r.texto_extraido).not.toContain('pie de pagina');
  });

  it('respeta el límite de caracteres (maxChars)', () => {
    const muchos = `<article>${'<p>' + PARRAFO.repeat(50) + '</p>'}</article>`;
    const r = extractFromHtml(`<html><body>${muchos}</body></html>`, 'https://m.mx/x', {
      maxChars: 100,
    });
    expect(r.texto_extraido!.length).toBeLessThanOrEqual(100);
  });

  it('devuelve texto null si no hay párrafos', () => {
    const html = `<html><head><title>T</title></head><body></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.texto_extraido).toBeNull();
    expect(r.metodo_texto).toBeNull();
  });
});

describe('extractFromHtml - imagen, autor, sección', () => {
  it('extrae og:image y luego twitter:image', () => {
    const og = extractFromHtml(
      `<html><head><meta property="og:image" content="https://m.mx/a.jpg"></head><body></body></html>`,
      'https://m.mx/x',
    );
    expect(og.imagen).toBe('https://m.mx/a.jpg');

    const tw = extractFromHtml(
      `<html><head><meta name="twitter:image" content="https://m.mx/b.jpg"></head><body></body></html>`,
      'https://m.mx/x',
    );
    expect(tw.imagen).toBe('https://m.mx/b.jpg');
  });

  it('extrae autor y sección de metadatos si existen', () => {
    const html = `<html><head>
      <meta name="author" content="Ana Pérez">
      <meta property="article:section" content="Deportes">
    </head><body></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/x');
    expect(r.autor).toBe('Ana Pérez');
    expect(r.seccion).toBe('Deportes');
  });

  it('no rompe si faltan autor/sección/imagen', () => {
    const r = extractFromHtml(`<html><head><title>T</title></head><body></body></html>`, 'https://m.mx/x');
    expect(r.autor).toBeNull();
    expect(r.seccion).toBeNull();
    expect(r.imagen).toBeNull();
  });
});

describe('normalizarUrlImagen', () => {
  it('antepone https: a URLs protocol-relative (//)', () => {
    expect(normalizarUrlImagen('//cdn.ejemplo.com/img.jpg')).toBe('https://cdn.ejemplo.com/img.jpg');
    expect(normalizarUrlImagen('//s3.amazonaws.com/bucket/img.png')).toBe('https://s3.amazonaws.com/bucket/img.png');
  });

  it('resuelve rutas absolutas (/) contra el origen de la página si se provee pageUrl', () => {
    expect(normalizarUrlImagen('/images/foto.jpg', 'https://medio.mx/nota/123')).toBe('https://medio.mx/images/foto.jpg');
  });

  it('deja intacta una URL /ruta si no se provee pageUrl', () => {
    expect(normalizarUrlImagen('/images/foto.jpg')).toBe('/images/foto.jpg');
  });

  it('deja intactas URLs absolutas con https://', () => {
    expect(normalizarUrlImagen('https://cdn.medio.mx/img.jpg')).toBe('https://cdn.medio.mx/img.jpg');
  });

  it('deja intactas URLs absolutas con http://', () => {
    expect(normalizarUrlImagen('http://viejo.medio.mx/img.jpg')).toBe('http://viejo.medio.mx/img.jpg');
  });

  it('maneja pageUrl inválida sin lanzar (devuelve la URL tal cual)', () => {
    expect(normalizarUrlImagen('/img.jpg', 'no-es-url-valida')).toBe('/img.jpg');
  });
});

describe('extractFromHtml - normalización de imagen en contexto', () => {
  it('normaliza og:image con URL protocol-relative', () => {
    const html = `<html><head><meta property="og:image" content="//cdn.globalmedia.mx/foto.jpg"></head><body></body></html>`;
    const r = extractFromHtml(html, 'https://www.globalmedia.mx/articles/nota');
    expect(r.imagen).toBe('https://cdn.globalmedia.mx/foto.jpg');
  });

  it('normaliza og:image con ruta absoluta usando el origen de la página', () => {
    const html = `<html><head><meta property="og:image" content="/uploads/img.jpg"></head><body></body></html>`;
    const r = extractFromHtml(html, 'https://www.medio.mx/nota/1');
    expect(r.imagen).toBe('https://www.medio.mx/uploads/img.jpg');
  });

  it('no altera og:image con URL ya completa', () => {
    const html = `<html><head><meta property="og:image" content="https://cdn.medio.mx/img.jpg"></head><body></body></html>`;
    const r = extractFromHtml(html, 'https://www.medio.mx/nota/1');
    expect(r.imagen).toBe('https://cdn.medio.mx/img.jpg');
  });
});

// ---------------------------------------------------------------------------
// Fixture sintético que simula el patrón de ruido de GlobalMedia
// ---------------------------------------------------------------------------

const FIXTURE_RUIDO = [
  'Vínculo copiado',
  'Síguenos',
  'MENU',
  'ESTACIONES LOCALES',
  '#ESNOTICIA',
  'Entradilla real de la nota sobre la reforma laboral.',
  'Por Redacción',
  '10 de junio de 2026',
  'Hablamos de:',
  'Párrafo real uno con contenido noticioso relevante.',
  'Párrafo real dos con más información de la nota.',
  'Únete a nuestro canal de WhatsApp para recibir alertas.',
  'https://gmnet.vip/abc123',
  'Minuto a minuto',
  'Otra nota vinculada con keyword falsa Gas Natural fue detectada.',
  'Derechos reservados',
  '© 2026 GlobalMedia',
].join('\n');

describe('limpiarTextoExtraido - heurística de limpieza', () => {
  it('conserva texto_extraido raw sin modificar', () => {
    const r = extractFromHtml(
      `<html><body><article><p>${FIXTURE_RUIDO.replace(/\n/g, ' ')}</p></article></body></html>`,
      'https://m.mx/nota/reforma',
    );
    // texto_extraido debe existir (el raw viene del HTML)
    expect(r.texto_extraido).toBeTruthy();
  });

  it('remueve líneas de ruido exactas (MENU, Síguenos, Vínculo copiado)', () => {
    const r = limpiarTextoExtraido(FIXTURE_RUIDO);
    expect(r.texto_nota_limpia).not.toContain('MENU');
    expect(r.texto_nota_limpia).not.toContain('Síguenos');
    expect(r.texto_nota_limpia).not.toContain('Vínculo copiado');
    expect(r.texto_nota_limpia).not.toContain('ESTACIONES LOCALES');
  });

  it('corta desde el primer marcador de sección (Minuto a minuto)', () => {
    const r = limpiarTextoExtraido(FIXTURE_RUIDO);
    expect(r.texto_nota_limpia).not.toContain('Minuto a minuto');
    expect(r.texto_nota_limpia).not.toContain('Derechos reservados');
    expect(r.texto_nota_limpia).not.toContain('keyword falsa Gas Natural');
  });

  it('elimina líneas promocionales (WhatsApp, URLs *.vip)', () => {
    const r = limpiarTextoExtraido(FIXTURE_RUIDO);
    expect(r.texto_nota_limpia).not.toContain('canal de WhatsApp');
    expect(r.texto_nota_limpia).not.toContain('gmnet.vip');
  });

  it('conserva el cuerpo real de la nota', () => {
    const r = limpiarTextoExtraido(FIXTURE_RUIDO);
    expect(r.texto_nota_limpia).toContain('Entradilla real de la nota');
    expect(r.texto_nota_limpia).toContain('Párrafo real uno');
    expect(r.texto_nota_limpia).toContain('Párrafo real dos');
  });

  it('genera extracto_nota_1300 desde texto_nota_limpia', () => {
    const r = limpiarTextoExtraido(FIXTURE_RUIDO);
    expect(r.extracto_nota_1300.length).toBeLessThanOrEqual(1300);
    // El extracto debe ser prefijo del texto limpio
    expect(r.texto_nota_limpia.startsWith(r.extracto_nota_1300)).toBe(true);
  });

  it('texto_limpio_chars coincide con la longitud real del texto limpio', () => {
    const r = limpiarTextoExtraido(FIXTURE_RUIDO);
    expect(r.texto_limpio_chars).toBe(r.texto_nota_limpia.length);
  });

  it('calcula calidad_extraccion (alta/media/baja/fallida)', () => {
    const r = limpiarTextoExtraido(FIXTURE_RUIDO);
    expect(['alta', 'media', 'baja', 'fallida']).toContain(r.calidad_extraccion);
  });

  it('devuelve fallida cuando no queda texto', () => {
    const soloRuido = 'MENU\nSíguenos\nVínculo copiado\n';
    const r = limpiarTextoExtraido(soloRuido);
    expect(r.calidad_extraccion).toBe('fallida');
    expect(r.texto_nota_limpia).toBe('');
    expect(r.texto_limpio_chars).toBe(0);
  });

  it('extractFromHtml incluye texto_nota_limpia, extracto, calidad y chars en el resultado', () => {
    const html = `<html><body><article><p>${FIXTURE_RUIDO.replace(/\n/g, '</p><p>')}</p></article></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/nota/reforma');
    expect(r.texto_nota_limpia).not.toBeNull();
    expect(r.extracto_nota_1300).not.toBeNull();
    expect(r.calidad_extraccion).not.toBeNull();
    expect(r.texto_limpio_chars).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Fixture basado en el ejemplo real de GlobalMedia
// ---------------------------------------------------------------------------

const FIXTURE_CUERPO = [
  'Entretenimiento y Espectáculo',
  '',
  'Exclusiva',
  '',
  'Habrá chubascos para el estado de San Luis Potosí, principalmente en la Zona Centro.',
  '',
  'Por Edson Pérez',
  '',
  '17:24 lunes 2 junio, 2025',
  '',
  'Se espera que como consecuencia de la onda tropical número tres haya lluvias.',
  '',
  'Detalló que las lluvias serán de moderadas a intensas.',
].join('\n');

describe('extraerCuerpoNota - tipo_nota', () => {
  it('detecta tipo_nota desde la primera línea no vacía si es categoría corta', () => {
    const r = extraerCuerpoNota(FIXTURE_CUERPO);
    expect(r.tipo_nota).toBe('Entretenimiento y Espectáculo');
  });

  it('devuelve tipo_nota null si la primera línea parece un título largo', () => {
    const texto = 'El gobierno federal anunció hoy una nueva política de infraestructura\n\nCuerpo real.';
    const r = extraerCuerpoNota(texto);
    expect(r.tipo_nota).toBeNull();
  });

  it('devuelve tipo_nota null si la primera línea es autor', () => {
    const texto = 'Por Redacción\n\nCuerpo real.';
    const r = extraerCuerpoNota(texto);
    expect(r.tipo_nota).toBeNull();
  });
});

describe('extraerCuerpoNota - texto_cuerpo_nota', () => {
  it('empieza después de la fecha cuando hay autor y fecha', () => {
    const r = extraerCuerpoNota(FIXTURE_CUERPO);
    expect(r.texto_cuerpo_nota).toContain('Se espera que como consecuencia');
    expect(r.texto_cuerpo_nota).toContain('Detalló que las lluvias');
  });

  it('no contiene tipo_nota', () => {
    const r = extraerCuerpoNota(FIXTURE_CUERPO);
    expect(r.texto_cuerpo_nota).not.toContain('Entretenimiento y Espectáculo');
  });

  it('no contiene etiqueta editorial (Exclusiva)', () => {
    const r = extraerCuerpoNota(FIXTURE_CUERPO);
    expect(r.texto_cuerpo_nota).not.toContain('Exclusiva');
  });

  it('no contiene línea de autor (Por Edson Pérez)', () => {
    const r = extraerCuerpoNota(FIXTURE_CUERPO);
    expect(r.texto_cuerpo_nota).not.toContain('Por Edson Pérez');
  });

  it('no contiene línea de fecha', () => {
    const r = extraerCuerpoNota(FIXTURE_CUERPO);
    expect(r.texto_cuerpo_nota).not.toContain('17:24 lunes 2 junio, 2025');
  });

  it('extracto_cuerpo_1300 sale de texto_cuerpo_nota y tiene ≤ 1300 chars', () => {
    const r = extraerCuerpoNota(FIXTURE_CUERPO);
    expect(r.extracto_cuerpo_1300.length).toBeLessThanOrEqual(1300);
    expect(r.texto_cuerpo_nota.startsWith(r.extracto_cuerpo_1300)).toBe(true);
  });

  it('cuerpo_nota_chars coincide con longitud de texto_cuerpo_nota', () => {
    const r = extraerCuerpoNota(FIXTURE_CUERPO);
    expect(r.cuerpo_nota_chars).toBe(r.texto_cuerpo_nota.length);
  });

  it('fallback conservador: sin autor/fecha, usa texto limpio sin encabezados', () => {
    const textoSinHeader = 'Economía\n\nCuerpo real sin fecha ni autor.';
    const r = extraerCuerpoNota(textoSinHeader);
    // Sin autor/fecha, el cuerpo es el resto tras el tipo_nota
    expect(r.texto_cuerpo_nota).toContain('Cuerpo real sin fecha ni autor.');
  });

  it('fallback total: sin tipo/autor/fecha, devuelve el texto completo', () => {
    const solo = 'Cuerpo completo sin ningún header editorial.';
    const r = extraerCuerpoNota(solo);
    expect(r.texto_cuerpo_nota).toBe(solo);
  });

  it('extractFromHtml incluye texto_cuerpo_nota, extracto_cuerpo_1300, cuerpo_nota_chars, tipo_nota', () => {
    const html = `<html><body><article><p>${FIXTURE_CUERPO.replace(/\n/g, '</p><p>')}</p></article></body></html>`;
    const r = extractFromHtml(html, 'https://m.mx/nota/reforma');
    // Al menos los campos deben estar presentes (pueden ser null si el texto es muy corto)
    expect('texto_cuerpo_nota' in r).toBe(true);
    expect('extracto_cuerpo_1300' in r).toBe(true);
    expect('cuerpo_nota_chars' in r).toBe(true);
    expect('tipo_nota' in r).toBe(true);
  });
});

describe('fetchAndExtract', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('descarga y extrae cuando el fetch responde OK', async () => {
    const html = `<html><head><meta property="og:title" content="Nota Remota"></head><body>${articulo()}</body></html>`;
    globalThis.fetch = vi.fn(async () =>
      new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }),
    ) as unknown as typeof fetch;

    const r = await fetchAndExtract('https://m.mx/nota/algo');
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.titulo).toBe('Nota Remota');
    expect(r.texto_extraido).toContain('Lorem ipsum');
  });

  it('no lanza si el fetch falla; devuelve ok=false y título fallback del slug', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ECONNRESET red caída');
    }) as unknown as typeof fetch;

    const r = await fetchAndExtract('https://m.mx/nota/messi-campeon', { timeoutMs: 50 });
    expect(r.ok).toBe(false);
    expect(r.error).toContain('ECONNRESET');
    expect(r.titulo).toBe('Messi campeon');
    expect(r.metodo_titulo).toBe('fallback_url_slug');
    expect(r.texto_extraido).toBeNull();
  });

  it('maneja respuesta HTTP de error (404) sin lanzar', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('not found', { status: 404 }),
    ) as unknown as typeof fetch;

    const r = await fetchAndExtract('https://m.mx/nota/inexistente');
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});
