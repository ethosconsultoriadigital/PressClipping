import { describe, it, expect, vi } from 'vitest';
import {
  enrichNews,
  construirActualizacion,
  type EnrichDeps,
  type NoticiaEnriquecibleRow,
} from '../src/enrichers/enrichNews.js';
import type { FetchExtractResult } from '../src/extractors/html.js';
import { MARCADOR_TITULO_DESDE_URL } from '../src/extractors/titleFromUrl.js';

function noticia(over: Partial<NoticiaEnriquecibleRow> = {}): NoticiaEnriquecibleRow {
  return {
    noticia_id: 'n1',
    url_original: 'https://medio.mx/nota/messi-campeon',
    titulo: null,
    resumen: null,
    texto_extraido: null,
    autor: null,
    seccion: null,
    imagen_principal: null,
    texto_nota_limpia: null,
    extracto_nota_1300: null,
    calidad_extraccion: null,
    texto_limpio_chars: null,
    texto_cuerpo_nota: null,
    extracto_cuerpo_1300: null,
    cuerpo_nota_chars: null,
    tipo_nota: null,
    ...over,
  };
}

function extracto(over: Partial<FetchExtractResult> = {}): FetchExtractResult {
  return {
    titulo: 'Título HTML',
    resumen: 'Resumen extraído',
    texto_extraido: 'Cuerpo de la nota.',
    texto_nota_limpia: 'Cuerpo limpio de la nota.',
    extracto_nota_1300: 'Cuerpo limpio de la nota.',
    calidad_extraccion: 'alta',
    texto_limpio_chars: 25,
    texto_cuerpo_nota: null,
    extracto_cuerpo_1300: null,
    cuerpo_nota_chars: null,
    tipo_nota: null,
    imagen: 'https://medio.mx/a.jpg',
    autor: 'Ana Pérez',
    seccion: 'Deportes',
    metodo_titulo: 'html_og',
    metodo_texto: 'html_article',
    ok: true,
    error: null,
    ...over,
  };
}

describe('construirActualizacion', () => {
  it('rellena todos los campos vacíos desde el extracto', () => {
    const { fields, campos, marcadores } = construirActualizacion(noticia(), extracto());
    expect(fields.titulo).toBe('Título HTML');
    expect(fields.resumen).toBe('Resumen extraído');
    expect(fields.texto_extraido).toBe('Cuerpo de la nota.');
    expect(fields.autor).toBe('Ana Pérez');
    expect(fields.seccion).toBe('Deportes');
    expect(fields.imagen_principal).toBe('https://medio.mx/a.jpg');
    expect(fields.estado_extraccion).toBe('enriquecido');
    expect(campos).toEqual(
      expect.arrayContaining(['titulo', 'resumen', 'texto_extraido', 'autor', 'seccion', 'imagen_principal']),
    );
    expect(marcadores).toContain('texto:html_article');
  });

  it('NO sobrescribe un título real existente', () => {
    const { fields, campos } = construirActualizacion(
      noticia({ titulo: 'Título Real' }),
      extracto(),
    );
    expect(fields.titulo).toBeUndefined();
    expect(campos).not.toContain('titulo');
  });

  it('NO sobrescribe texto_extraido ya presente', () => {
    const { fields, campos } = construirActualizacion(
      noticia({ texto_extraido: 'ya hay texto' }),
      extracto(),
    );
    expect(fields.texto_extraido).toBeUndefined();
    expect(campos).not.toContain('texto_extraido');
  });

  it('rellena los 4 campos de texto limpio cuando están vacíos', () => {
    const { fields, campos } = construirActualizacion(noticia(), extracto());
    expect(fields.texto_nota_limpia).toBe('Cuerpo limpio de la nota.');
    expect(fields.extracto_nota_1300).toBe('Cuerpo limpio de la nota.');
    expect(fields.calidad_extraccion).toBe('alta');
    expect(fields.texto_limpio_chars).toBe(25);
    expect(campos).toEqual(
      expect.arrayContaining([
        'texto_nota_limpia',
        'extracto_nota_1300',
        'calidad_extraccion',
        'texto_limpio_chars',
      ]),
    );
  });

  it('NO sobrescribe texto_nota_limpia si ya existe', () => {
    const { fields, campos } = construirActualizacion(
      noticia({ texto_nota_limpia: 'Texto ya limpio' }),
      extracto(),
    );
    expect(fields.texto_nota_limpia).toBeUndefined();
    expect(campos).not.toContain('texto_nota_limpia');
  });

  it('rellena los 4 campos de cuerpo/tipo cuando están vacíos', () => {
    const ext = extracto({
      texto_cuerpo_nota: 'Cuerpo real.',
      extracto_cuerpo_1300: 'Cuerpo real.',
      cuerpo_nota_chars: 12,
      tipo_nota: 'Política',
    });
    const { fields, campos } = construirActualizacion(noticia(), ext);
    expect(fields.texto_cuerpo_nota).toBe('Cuerpo real.');
    expect(fields.extracto_cuerpo_1300).toBe('Cuerpo real.');
    expect(fields.cuerpo_nota_chars).toBe(12);
    expect(fields.tipo_nota).toBe('Política');
    expect(campos).toEqual(
      expect.arrayContaining([
        'texto_cuerpo_nota',
        'extracto_cuerpo_1300',
        'cuerpo_nota_chars',
        'tipo_nota',
      ]),
    );
  });

  it('NO sobrescribe texto_cuerpo_nota ni tipo_nota si ya existen', () => {
    const ext = extracto({
      texto_cuerpo_nota: 'Cuerpo nuevo.',
      tipo_nota: 'Economía',
    });
    const not = noticia({ texto_cuerpo_nota: 'Cuerpo previo.', tipo_nota: 'Política' });
    const { fields, campos } = construirActualizacion(not, ext);
    expect(fields.texto_cuerpo_nota).toBeUndefined();
    expect(fields.tipo_nota).toBeUndefined();
    expect(campos).not.toContain('texto_cuerpo_nota');
    expect(campos).not.toContain('tipo_nota');
  });

  it('registra el marcador titulo_generado_desde_url al usar fallback de slug', () => {
    const { fields, marcadores } = construirActualizacion(
      noticia(),
      extracto({ titulo: null, metodo_titulo: 'fallback_url_slug' }),
    );
    expect(fields.titulo).toBe('Messi campeon');
    expect(marcadores).toContain(MARCADOR_TITULO_DESDE_URL);
    expect(fields.notas).toContain(MARCADOR_TITULO_DESDE_URL);
  });

  it('en fallo de extracción marca estado error y registra el motivo', () => {
    const { fields, marcadores } = construirActualizacion(
      noticia(),
      extracto({
        ok: false,
        error: 'timeout',
        titulo: 'Messi campeon',
        metodo_titulo: 'fallback_url_slug',
        resumen: null,
        texto_extraido: null,
        autor: null,
        seccion: null,
        imagen: null,
      }),
    );
    expect(fields.estado_extraccion).toBe('error');
    expect(fields.error_extraccion).toBe('timeout');
    expect(marcadores.some((m) => m.startsWith('enrich_error:'))).toBe(true);
  });
});

function deps(over: Partial<EnrichDeps> = {}): {
  d: EnrichDeps;
  fetchNoticias: ReturnType<typeof vi.fn>;
  extract: ReturnType<typeof vi.fn>;
  updateNoticia: ReturnType<typeof vi.fn>;
} {
  const fetchNoticias = vi.fn(async () => [noticia({ noticia_id: 'n1' })]);
  const extract = vi.fn(async () => extracto());
  const updateNoticia = vi.fn(async () => {});
  const d: EnrichDeps = {
    fetchNoticias: over.fetchNoticias ?? (fetchNoticias as unknown as EnrichDeps['fetchNoticias']),
    extract: over.extract ?? (extract as unknown as EnrichDeps['extract']),
    updateNoticia: over.updateNoticia ?? (updateNoticia as unknown as EnrichDeps['updateNoticia']),
  };
  return { d, fetchNoticias, extract, updateNoticia };
}

describe('enrichNews', () => {
  it('--dry-run NO escribe en Supabase', async () => {
    const { d, updateNoticia } = deps();
    const res = await enrichNews(d, { dryRun: true });
    expect(res.dryRun).toBe(true);
    expect(res.leidas).toBe(1);
    expect(updateNoticia).not.toHaveBeenCalled();
  });

  it('en modo real actualiza con los campos y el id correctos', async () => {
    const { d, updateNoticia } = deps();
    const res = await enrichNews(d, { dryRun: false });
    expect(res.actualizadas).toBe(1);
    expect(updateNoticia).toHaveBeenCalledTimes(1);
    expect(updateNoticia).toHaveBeenCalledWith('n1', expect.objectContaining({ titulo: 'Título HTML' }));
  });

  it('propaga los flags onlyMissingTitle/onlyMissingText a la lectura', async () => {
    const { d, fetchNoticias } = deps();
    await enrichNews(d, { dryRun: true, onlyMissingTitle: true, limit: 5 });
    expect(fetchNoticias).toHaveBeenCalledWith(
      expect.objectContaining({ onlyMissingTitle: true, limit: 5 }),
    );
  });

  it('propaga onlyMissingBodyText a la lectura', async () => {
    const { d, fetchNoticias } = deps();
    await enrichNews(d, { dryRun: true, onlyMissingBodyText: true, limit: 10 });
    expect(fetchNoticias).toHaveBeenCalledWith(
      expect.objectContaining({ onlyMissingBodyText: true, limit: 10 }),
    );
  });

  it('propaga onlyPendingMentions a la lectura', async () => {
    const { d, fetchNoticias } = deps();
    await enrichNews(d, { dryRun: true, onlyPendingMentions: true, limit: 50 });
    expect(fetchNoticias).toHaveBeenCalledWith(
      expect.objectContaining({ onlyPendingMentions: true, limit: 50 }),
    );
  });

  it('onlyPendingMentions se combina con onlyMissingCleanText', async () => {
    const { d, fetchNoticias } = deps();
    await enrichNews(d, { dryRun: true, onlyPendingMentions: true, onlyMissingCleanText: true });
    expect(fetchNoticias).toHaveBeenCalledWith(
      expect.objectContaining({ onlyPendingMentions: true, onlyMissingCleanText: true }),
    );
  });

  it('onlyPendingMentions se combina con onlyMissingBodyText', async () => {
    const { d, fetchNoticias } = deps();
    await enrichNews(d, { dryRun: true, onlyPendingMentions: true, onlyMissingBodyText: true });
    expect(fetchNoticias).toHaveBeenCalledWith(
      expect.objectContaining({ onlyPendingMentions: true, onlyMissingBodyText: true }),
    );
  });

  it('onlyPendingMentions NO marca menciones_procesado', async () => {
    const { d, updateNoticia } = deps();
    await enrichNews(d, { dryRun: false, onlyPendingMentions: true });
    // updateNoticia solo puede ser llamada con campos de enriquecimiento, no con menciones_procesado
    if (updateNoticia.mock.calls.length > 0) {
      const [, fields] = updateNoticia.mock.calls[0] as [string, Record<string, unknown>];
      expect(fields).not.toHaveProperty('menciones_procesado');
    }
  });

  it('resultado incluye conTextoLimpio y conCuerpoNota', async () => {
    const { d } = deps();
    const res = await enrichNews(d, { dryRun: true });
    expect(typeof res.conTextoLimpio).toBe('number');
    expect(typeof res.conCuerpoNota).toBe('number');
  });

  it('una nota que falla NO detiene la corrida y cuenta como fallida', async () => {
    const fetchNoticias = vi.fn(async () => [
      noticia({ noticia_id: 'n1' }),
      noticia({ noticia_id: 'n2', url_original: 'https://medio.mx/nota/otra' }),
    ]);
    const extract = vi.fn(async (url: string) => {
      if (url.includes('otra')) {
        return extracto({ ok: false, error: 'ECONNRESET', titulo: 'Otra', metodo_titulo: 'fallback_url_slug', resumen: null, texto_extraido: null, autor: null, seccion: null, imagen: null });
      }
      return extracto();
    });
    const updateNoticia = vi.fn(async () => {});
    const { d } = deps({
      fetchNoticias: fetchNoticias as unknown as EnrichDeps['fetchNoticias'],
      extract: extract as unknown as EnrichDeps['extract'],
      updateNoticia: updateNoticia as unknown as EnrichDeps['updateNoticia'],
    });
    const res = await enrichNews(d, { dryRun: false });
    expect(res.leidas).toBe(2);
    expect(res.fallidas).toBe(1);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(updateNoticia).toHaveBeenCalledTimes(2);
  });

  it('cuenta sin cambios cuando todo está ya completo', async () => {
    const fetchNoticias = vi.fn(async () => [
      noticia({
        noticia_id: 'n1',
        titulo: 'Ya',
        resumen: 'Ya',
        texto_extraido: 'Ya',
        autor: 'Ya',
        seccion: 'Ya',
        imagen_principal: 'Ya',
        texto_nota_limpia: 'Ya limpio',
        extracto_nota_1300: 'Ya extracto',
        calidad_extraccion: 'alta',
        texto_limpio_chars: 9,
      }),
    ]);
    const updateNoticia = vi.fn(async () => {});
    const { d } = deps({
      fetchNoticias: fetchNoticias as unknown as EnrichDeps['fetchNoticias'],
      updateNoticia: updateNoticia as unknown as EnrichDeps['updateNoticia'],
    });
    const res = await enrichNews(d, { dryRun: false });
    expect(res.actualizadas).toBe(0);
    expect(res.sinCambios).toBe(1);
    expect(updateNoticia).not.toHaveBeenCalled();
  });

  it('omite noticias sin url_original y las cuenta como fallidas', async () => {
    const fetchNoticias = vi.fn(async () => [noticia({ noticia_id: 'n1', url_original: null })]);
    const extract = vi.fn(async () => extracto());
    const { d } = deps({
      fetchNoticias: fetchNoticias as unknown as EnrichDeps['fetchNoticias'],
      extract: extract as unknown as EnrichDeps['extract'],
    });
    const res = await enrichNews(d, { dryRun: false });
    expect(res.fallidas).toBe(1);
    expect(extract).not.toHaveBeenCalled();
  });
});
