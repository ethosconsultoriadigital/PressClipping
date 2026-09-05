import { describe, it, expect, vi } from 'vitest';
import {
  enrichNews,
  construirActualizacion,
  buildEnrichMediaSummaryLogPayload,
  buildEnrichUnattributedLogPayload,
  ENRICH_MEDIA_SUMMARY_EVENT,
  type EnrichDeps,
  type NoticiaEnriquecibleRow,
  type MedioEnrichSummary,
} from '../src/enrichers/enrichNews.js';
import type { FetchExtractResult } from '../src/extractors/html.js';
import { MARCADOR_TITULO_DESDE_URL } from '../src/extractors/titleFromUrl.js';
import { parseArgs } from '../scripts/enrich-news.js';

function noticia(over: Partial<NoticiaEnriquecibleRow> = {}): NoticiaEnriquecibleRow {
  return {
    noticia_id: 'n1',
    medio_id: null,
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

  it('force-refresh SÍ sobrescribe texto_extraido/limpio/cuerpo aunque existan', () => {
    const ext = extracto({
      texto_extraido: 'Cuerpo re-extraído sin relacionados.',
      texto_nota_limpia: 'Cuerpo limpio re-extraído.',
      texto_cuerpo_nota: 'Cuerpo re-extraído.',
      extracto_cuerpo_1300: 'Cuerpo re-extraído.',
      cuerpo_nota_chars: 19,
      tipo_nota: 'Noticias',
    });
    const { fields, campos } = construirActualizacion(
      noticia({
        titulo: 'Título Real',
        texto_extraido: 'viejo con teaser tequila adulterado',
        texto_nota_limpia: 'viejo limpio con teaser tequila adulterado',
        texto_cuerpo_nota: 'viejo cuerpo con teaser tequila adulterado',
      }),
      ext,
      { forceRefreshCleanText: true },
    );
    expect(fields.texto_extraido).toBe('Cuerpo re-extraído sin relacionados.');
    expect(fields.texto_nota_limpia).toBe('Cuerpo limpio re-extraído.');
    expect(fields.texto_cuerpo_nota).toBe('Cuerpo re-extraído.');
    expect(campos).toEqual(
      expect.arrayContaining(['texto_extraido', 'texto_nota_limpia', 'texto_cuerpo_nota']),
    );
    // No toca el título real existente ni siquiera en force-refresh.
    expect(fields.titulo).toBeUndefined();
  });

  it('force-refresh NO sobrescribe si la extracción falló (ok=false)', () => {
    const { fields, campos } = construirActualizacion(
      noticia({ texto_nota_limpia: 'contenido bueno previo' }),
      extracto({ ok: false, error: 'timeout', texto_extraido: null, texto_nota_limpia: null }),
      { forceRefreshCleanText: true },
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

describe('enrichNews — recentFirst / windowDays (prioriza recientes sobre backlog viejo)', () => {
  it('sin recentFirst/windowDays: NO se pasan a fetchNoticias (conserva el default oldest-first)', async () => {
    const fetchNoticias = vi.fn(async () => [noticia()]);
    const { d } = deps({ fetchNoticias: fetchNoticias as unknown as EnrichDeps['fetchNoticias'] });
    await enrichNews(d, { dryRun: true });
    expect(fetchNoticias).toHaveBeenCalledWith(
      expect.objectContaining({ recentFirst: undefined, windowDays: undefined }),
    );
  });

  it('--recent-first se reenvía a fetchNoticias tal cual', async () => {
    const fetchNoticias = vi.fn(async () => [noticia()]);
    const { d } = deps({ fetchNoticias: fetchNoticias as unknown as EnrichDeps['fetchNoticias'] });
    await enrichNews(d, { dryRun: true, recentFirst: true });
    expect(fetchNoticias).toHaveBeenCalledWith(expect.objectContaining({ recentFirst: true }));
  });

  it('--window-days=N se reenvía a fetchNoticias tal cual', async () => {
    const fetchNoticias = vi.fn(async () => [noticia()]);
    const { d } = deps({ fetchNoticias: fetchNoticias as unknown as EnrichDeps['fetchNoticias'] });
    await enrichNews(d, { dryRun: true, windowDays: 7 });
    expect(fetchNoticias).toHaveBeenCalledWith(expect.objectContaining({ windowDays: 7 }));
  });

  it('respeta --limit junto con recentFirst/windowDays (no cambia el tope)', async () => {
    const fetchNoticias = vi.fn(async () => [noticia()]);
    const { d } = deps({ fetchNoticias: fetchNoticias as unknown as EnrichDeps['fetchNoticias'] });
    await enrichNews(d, { dryRun: true, recentFirst: true, windowDays: 7, limit: 100 });
    expect(fetchNoticias).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
  });

  it('only-missing-clean-text sigue sin pisar texto_nota_limpia ya existente, incluso con recentFirst', async () => {
    const fetchNoticias = vi.fn(async () => [
      noticia({
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
    const res = await enrichNews(d, { dryRun: false, recentFirst: true, onlyMissingCleanText: true });
    expect(res.sinCambios).toBe(1);
    expect(updateNoticia).not.toHaveBeenCalled();
  });
});

describe('enrich-news CLI parseArgs — --recent-first / --window-days', () => {
  it('default: recentFirst y windowDays quedan undefined', () => {
    const args = parseArgs([]);
    expect(args.recentFirst).toBeUndefined();
    expect(args.windowDays).toBeUndefined();
  });

  it('--recent-first activa recentFirst=true', () => {
    expect(parseArgs(['--recent-first']).recentFirst).toBe(true);
  });

  it('--window-days=7 parsea a windowDays=7', () => {
    expect(parseArgs(['--window-days=7']).windowDays).toBe(7);
  });

  it('--medio-ids=MED-0017 --window-days=7 --recent-first --only-missing-clean-text --limit=100 (comando real de la fase)', () => {
    const args = parseArgs(['--medio-ids=MED-0017', '--window-days=7', '--recent-first', '--only-missing-clean-text', '--limit=100']);
    expect(args.medioIds).toEqual(['MED-0017']);
    expect(args.windowDays).toBe(7);
    expect(args.recentFirst).toBe(true);
    expect(args.onlyMissingCleanText).toBe(true);
    expect(args.limit).toBe(100);
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

  it('propaga medioIds a la lectura (enrich aislado por medio)', async () => {
    const { d, fetchNoticias } = deps();
    await enrichNews(d, {
      dryRun: true,
      medioIds: ['MED-0030', 'MED-0008'],
      onlyPendingMentions: true,
      onlyMissingCleanText: true,
      limit: 500,
    });
    expect(fetchNoticias).toHaveBeenCalledWith(
      expect.objectContaining({ medioIds: ['MED-0030', 'MED-0008'] }),
    );
  });

  it('sin medioIds NO restringe por medio (backlog global)', async () => {
    const { d, fetchNoticias } = deps();
    await enrichNews(d, { dryRun: true });
    const [arg] = fetchNoticias.mock.calls[0] as [{ medioIds?: string[] }];
    expect(arg.medioIds).toBeUndefined();
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

  it('si updateNoticia falla (p.ej. timeout) en una nota, NO tira el batch — sigue con las siguientes (caso real 2026-07-20: "statement timeout" mataba el proceso completo)', async () => {
    const fetchNoticias = vi.fn(async () => [
      noticia({ noticia_id: 'n1', url_original: 'https://medio.mx/nota/1' }),
      noticia({ noticia_id: 'n2', url_original: 'https://medio.mx/nota/2' }),
      noticia({ noticia_id: 'n3', url_original: 'https://medio.mx/nota/3' }),
    ]);
    const updateNoticia = vi.fn(async (id: string) => {
      if (id === 'n2') throw new Error('canceling statement due to statement timeout');
    });
    const { d } = deps({
      fetchNoticias: fetchNoticias as unknown as EnrichDeps['fetchNoticias'],
      updateNoticia: updateNoticia as unknown as EnrichDeps['updateNoticia'],
    });
    const res = await enrichNews(d, { dryRun: false });
    // n1 y n3 se actualizan correctamente pese al fallo puntual de n2.
    expect(updateNoticia).toHaveBeenCalledTimes(3);
    expect(res.actualizadas).toBe(2);
    expect(res.fallidas).toBe(1);
    const fallaN2 = res.detalle.find((d) => d.noticia_id === 'n2');
    expect(fallaN2?.error).toMatch(/statement timeout/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fase 1A — Media Validation & Certification: atribución per-medio en enrich.
// Ver docs/MEDIA_VALIDATION_AND_CERTIFICATION.md §7.
// ─────────────────────────────────────────────────────────────────────────────
function porMedio(res: Awaited<ReturnType<typeof enrichNews>>, medioId: string): MedioEnrichSummary {
  const s = res.porMedio.find((m) => m.medio_id === medioId);
  if (!s) throw new Error(`No hay resumen per-medio para ${medioId}`);
  return s;
}

describe('enrichNews — atribución per-medio (Fase 1A)', () => {
  it('dos medios en el mismo batch producen dos agregados separados, sin contaminarse', async () => {
    const fetchNoticias = vi.fn(async () => [
      noticia({ noticia_id: 'a1', medio_id: 'MED-A', url_original: 'https://a.mx/1' }),
      noticia({ noticia_id: 'a2', medio_id: 'MED-A', url_original: 'https://a.mx/2' }),
      // titulo ya presente para que el fallback de título-desde-slug (que se
      // dispara aun con ok:false) no cuente como "campo actualizado" y el
      // caso quede limpio: falló, sin ningún campo de contenido nuevo.
      noticia({ noticia_id: 'b1', medio_id: 'MED-B', url_original: 'https://b.mx/1', titulo: 'Ya existe' }),
    ]);
    const extract = vi.fn(async (url: string) => {
      if (url.includes('b.mx')) {
        return extracto({ ok: false, error: 'timeout', titulo: null, resumen: null, texto_extraido: null, autor: null, seccion: null, imagen: null, texto_nota_limpia: null });
      }
      return extracto();
    });
    const updateNoticia = vi.fn(async () => {});
    const { d } = deps({
      fetchNoticias: fetchNoticias as unknown as EnrichDeps['fetchNoticias'],
      extract: extract as unknown as EnrichDeps['extract'],
      updateNoticia: updateNoticia as unknown as EnrichDeps['updateNoticia'],
    });

    const res = await enrichNews(d, { dryRun: false, medioIds: ['MED-A', 'MED-B'] });

    expect(res.porMedio).toHaveLength(2);
    const a = porMedio(res, 'MED-A');
    const b = porMedio(res, 'MED-B');

    // MED-A: 2 noticias, ambas enriquecidas con éxito.
    expect(a.processed).toBe(2);
    expect(a.updated).toBe(2);
    expect(a.failed).toBe(0);
    expect(a.clean_text_count).toBe(2);

    // MED-B: 1 noticia, falló la extracción — no contamina a MED-A.
    expect(b.processed).toBe(1);
    expect(b.updated).toBe(0);
    expect(b.failed).toBe(1);
    expect(b.clean_text_count).toBe(0);
  });

  it('una noticia fallida se atribuye al medio correcto (no al otro medio del batch)', async () => {
    const fetchNoticias = vi.fn(async () => [
      noticia({ noticia_id: 'ok1', medio_id: 'MED-OK', url_original: 'https://ok.mx/1' }),
      noticia({ noticia_id: 'bad1', medio_id: 'MED-BAD', url_original: 'https://bad.mx/1' }),
    ]);
    const extract = vi.fn(async (url: string) =>
      url.includes('bad.mx')
        ? extracto({ ok: false, error: 'ECONNRESET', titulo: null, resumen: null, texto_extraido: null, autor: null, seccion: null, imagen: null })
        : extracto(),
    );
    const { d } = deps({
      fetchNoticias: fetchNoticias as unknown as EnrichDeps['fetchNoticias'],
      extract: extract as unknown as EnrichDeps['extract'],
    });

    const res = await enrichNews(d, { dryRun: false });

    expect(porMedio(res, 'MED-OK').failed).toBe(0);
    expect(porMedio(res, 'MED-BAD').failed).toBe(1);
  });

  it('body_count se atribuye correctamente por medio cuando el campo está disponible', async () => {
    const fetchNoticias = vi.fn(async () => [
      noticia({ noticia_id: 'c1', medio_id: 'MED-C', url_original: 'https://c.mx/1' }),
    ]);
    const extract = vi.fn(async () =>
      extracto({ texto_cuerpo_nota: 'Cuerpo real.', extracto_cuerpo_1300: 'Cuerpo real.', cuerpo_nota_chars: 12 }),
    );
    const { d } = deps({
      fetchNoticias: fetchNoticias as unknown as EnrichDeps['fetchNoticias'],
      extract: extract as unknown as EnrichDeps['extract'],
    });

    const res = await enrichNews(d, { dryRun: false });
    expect(porMedio(res, 'MED-C').body_count).toBe(1);
  });

  it('el resumen global conserva exactamente su comportamiento previo (no cambia el procesamiento funcional)', async () => {
    const { d, updateNoticia } = deps();
    const res = await enrichNews(d, { dryRun: false });
    expect(res.actualizadas).toBe(1);
    expect(res.leidas).toBe(1);
    expect(updateNoticia).toHaveBeenCalledTimes(1);
    // medio_id NUNCA viaja al update de Supabase (no es un campo editorial).
    const [, fieldsEscritos] = updateNoticia.mock.calls[0] as [string, Record<string, unknown>];
    expect(fieldsEscritos).not.toHaveProperty('medio_id');
  });

  it('reconciliación: cuando todo es atribuible, SUM(per-media) === total global para cada métrica', async () => {
    const fetchNoticias = vi.fn(async () => [
      noticia({ noticia_id: 'a1', medio_id: 'MED-A', url_original: 'https://a.mx/1' }),
      noticia({ noticia_id: 'a2', medio_id: 'MED-A', url_original: 'https://a.mx/2' }),
      noticia({ noticia_id: 'b1', medio_id: 'MED-B', url_original: 'https://b.mx/1' }),
      noticia({ noticia_id: 'b2', medio_id: 'MED-B', url_original: null }),
    ]);
    const extract = vi.fn(async (url: string) =>
      url.includes('b.mx') ? extracto({ ok: false, error: 'timeout' }) : extracto(),
    );
    const { d } = deps({
      fetchNoticias: fetchNoticias as unknown as EnrichDeps['fetchNoticias'],
      extract: extract as unknown as EnrichDeps['extract'],
    });

    const res = await enrichNews(d, { dryRun: false, medioIds: ['MED-A', 'MED-B'] });

    const sum = (key: keyof MedioEnrichSummary) =>
      res.porMedio.reduce((acc, m) => acc + (m[key] as number), (res.sinMedioId as any)[key] ?? 0);

    expect(sum('processed')).toBe(res.leidas);
    expect(sum('updated')).toBe(res.actualizadas);
    expect(sum('unchanged')).toBe(res.sinCambios);
    expect(sum('failed')).toBe(res.fallidas);
    expect(sum('clean_text_count')).toBe(res.conTextoLimpio);
    expect(sum('body_count')).toBe(res.conCuerpoNota);
  });

  it('medio solicitado explícitamente con 0 noticias elegibles NO desaparece: queda con processed=0, requested=true', async () => {
    // Solo llegó MED-A en la respuesta de fetchNoticias; MED-B fue pedido pero
    // no tuvo ninguna noticia elegible para este batch (filtros de enrich).
    const fetchNoticias = vi.fn(async () => [
      noticia({ noticia_id: 'a1', medio_id: 'MED-A', url_original: 'https://a.mx/1' }),
    ]);
    const { d } = deps({ fetchNoticias: fetchNoticias as unknown as EnrichDeps['fetchNoticias'] });

    const res = await enrichNews(d, { dryRun: true, medioIds: ['MED-A', 'MED-B'] });

    expect(res.porMedio).toHaveLength(2);
    const b = porMedio(res, 'MED-B');
    expect(b.requested).toBe(true);
    expect(b.processed).toBe(0);
    expect(b.updated).toBe(0);
    expect(b.failed).toBe(0);
  });

  it('atribución desconocida (medio_id null) se cuenta aparte y NO se asigna a ningún medio del batch', async () => {
    const fetchNoticias = vi.fn(async () => [
      noticia({ noticia_id: 'a1', medio_id: 'MED-A', url_original: 'https://a.mx/1' }),
      noticia({ noticia_id: 'huerfana', medio_id: null, url_original: 'https://borrado.mx/1' }),
    ]);
    const { d } = deps({ fetchNoticias: fetchNoticias as unknown as EnrichDeps['fetchNoticias'] });

    const res = await enrichNews(d, { dryRun: false });

    expect(res.leidas).toBe(2);
    expect(porMedio(res, 'MED-A').processed).toBe(1);
    expect(res.sinMedioId.processed).toBe(1);
    expect(res.sinMedioId.updated).toBe(1);
    // La noticia huérfana no se cuela en el bucket de MED-A.
    expect(res.porMedio.some((m) => m.medio_id === null as unknown as string)).toBe(false);
  });

  it('sin --medio-ids (corrida global), los medios encontrados aparecen con requested=false', async () => {
    const fetchNoticias = vi.fn(async () => [
      noticia({ noticia_id: 'a1', medio_id: 'MED-A', url_original: 'https://a.mx/1' }),
    ]);
    const { d } = deps({ fetchNoticias: fetchNoticias as unknown as EnrichDeps['fetchNoticias'] });

    const res = await enrichNews(d, { dryRun: true });
    expect(porMedio(res, 'MED-A').requested).toBe(false);
  });
});

describe('enrichNews — logging estructurado per-medio (Fase 1A, sin parsing de texto humano)', () => {
  it('buildEnrichMediaSummaryLogPayload produce un evento identificable por código, no por texto', () => {
    const summary: MedioEnrichSummary = {
      medio_id: 'MED-0029',
      requested: true,
      processed: 3,
      updated: 3,
      unchanged: 0,
      failed: 0,
      clean_text_count: 3,
      body_count: 3,
    };
    const payload = buildEnrichMediaSummaryLogPayload(summary, { dryRun: false });
    expect(payload.event).toBe(ENRICH_MEDIA_SUMMARY_EVENT);
    expect(payload.event).toBe('enrich_media_summary');
    expect(payload.schema_version).toBe(1);
    expect(payload.medio_id).toBe('MED-0029');
    expect(payload.processed).toBe(3);
    expect(payload.dry_run).toBe(false);
  });

  it('buildEnrichUnattributedLogPayload marca medio_id null explícitamente (no lo omite)', () => {
    const payload = buildEnrichUnattributedLogPayload(
      { processed: 2, updated: 1, unchanged: 1, failed: 0, clean_text_count: 1, body_count: 0 },
      { dryRun: true },
    );
    expect(payload.event).toBe(ENRICH_MEDIA_SUMMARY_EVENT);
    expect(payload.medio_id).toBeNull();
    expect(payload.processed).toBe(2);
  });
});
