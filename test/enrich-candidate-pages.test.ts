import { describe, it, expect } from 'vitest';
import {
  ENRICH_CANDIDATE_PAGE_SIZE,
  enrichCandidatePagePlan,
  nextEnrichCandidatePage,
} from '../src/enrichers/enrichCandidatePages.js';

describe('enrichCandidatePagePlan — ningún candidato se pierde en el corte 1000', () => {
  it('999 items: una sola página 0..998', () => {
    const pages = enrichCandidatePagePlan(999);
    expect(pages).toEqual([{ from: 0, to: 998, take: 999 }]);
    expect(pages.reduce((n, p) => n + p.take, 0)).toBe(999);
  });

  it('1000 items: una página que llena el tope PostgREST', () => {
    const pages = enrichCandidatePagePlan(1000);
    expect(pages).toEqual([{ from: 0, to: 999, take: 1000 }]);
    expect(pages[0]!.take).toBe(ENRICH_CANDIDATE_PAGE_SIZE);
  });

  it('1001 items: segunda página con el candidato 1001', () => {
    const pages = enrichCandidatePagePlan(1001);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({ from: 0, to: 999, take: 1000 });
    expect(pages[1]).toEqual({ from: 1000, to: 1000, take: 1 });
    expect(pages.reduce((n, p) => n + p.take, 0)).toBe(1001);
  });

  it('>2000 items: tres páginas, 2500 candidatos cubiertos', () => {
    const pages = enrichCandidatePagePlan(2500);
    expect(pages).toHaveLength(3);
    expect(pages[0]).toEqual({ from: 0, to: 999, take: 1000 });
    expect(pages[1]).toEqual({ from: 1000, to: 1999, take: 1000 });
    expect(pages[2]).toEqual({ from: 2000, to: 2499, take: 500 });
    expect(pages.reduce((n, p) => n + p.take, 0)).toBe(2500);
  });
});

describe('nextEnrichCandidatePage — loop de fetch', () => {
  it('remaining 0 → null (no pide página fantasma)', () => {
    expect(nextEnrichCandidatePage(1000, 0)).toBeNull();
  });

  it('sin tope pide pageSize completo', () => {
    expect(nextEnrichCandidatePage(2000, null, 1000)).toEqual({
      from: 2000,
      to: 2999,
      take: 1000,
    });
  });
});
