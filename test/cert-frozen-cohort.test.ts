import { describe, it, expect } from 'vitest';
import { scoreMediaAtAnchor, type CertNote } from '../src/mediaValidation/certScore.js';

describe('frozen cohort: same notes+probe+anchor → identical class 3 runs', () => {
  const anchor = '2026-09-29T23:39:31.760Z';
  const notes: CertNote[] = [
    {
      url_original: 'https://www.liderempresarial.com/nota-buena/',
      titulo: 'Nota',
      fecha_publicacion: '2026-09-28T12:00:00.000Z',
      created_at: '2026-09-28T14:00:00.000Z',
      texto_cuerpo_nota: 'x'.repeat(200),
      texto_nota_limpia: 'x'.repeat(200),
    },
    {
      url_original: 'https://www.proceso.com.mx/temas/nfl-543.html',
      titulo: 'Hub',
      fecha_publicacion: '2026-09-28T12:00:00.000Z',
      created_at: '2026-09-28T14:00:00.000Z',
      texto_cuerpo_nota: null,
      texto_nota_limpia: null,
    },
  ];
  const opts = {
    medioId: 'MED-0031',
    notes30: notes,
    probe: { class: 'TRANSIENT' as const, status: 200, error: 'few_items' },
    lastEstado: 'ok',
    lastError: null,
    paywallNotes: false,
    anchorIso: anchor,
  };

  it('RUN1 = RUN2 = RUN3', () => {
    const a = scoreMediaAtAnchor(opts);
    const b = scoreMediaAtAnchor(opts);
    const c = scoreMediaAtAnchor(opts);
    expect(a.certification_class).toBe(b.certification_class);
    expect(b.certification_class).toBe(c.certification_class);
    expect(a.noticias_7d).toBe(b.noticias_7d);
    expect(a.texto_usable_pct_7d).toBe(c.texto_usable_pct_7d);
    expect(a.excluded_non_article_7d).toBe(1);
  });
});
