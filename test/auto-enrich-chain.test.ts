/**
 * Tests de regresión del fix de auto-enrich encadenado (lote ETHOS 200 MEDIA
 * NEWS LAKE, 2026-07-20).
 *
 * Hallazgo: el cron base (`run-shadow-scheduler.ts` → `run-live-comparison.ts`)
 * YA encadenaba enrich tras el crawl — la afirmación repetida en fases
 * anteriores ("el cron base no ejecuta enrich") era IMPRECISA. El problema
 * real: el enrich corría sobre la cola GLOBAL de pendientes (oldest-first,
 * sin acotar por medio), con un cupo compartido (`--limit=250`) entre TODOS
 * los medios de `SHADOW_MEDIOS` — El Heraldo/El Informador/El Economista/La
 * Razón (todos alto volumen, todos en SHADOW_MEDIOS) nunca alcanzaban a
 * limpiarse porque su backlog crecía más rápido que el cupo compartido.
 *
 * Fix: acotar el enrich encadenado a los medios de ESTE ciclo
 * (`--medio-ids=${crawlMedioIds}`) y usar `--recent-first` (prioriza notas
 * recientes en vez de oldest-first) en el scheduler base y los 3 tiers
 * aislados (nacional B, daily-validated, crisis). Estos tests fijan el
 * contrato por contenido de fuente (los scripts no exportan la construcción
 * de argv de forma testeable de otra manera, mismo patrón que los tests de
 * workflow .yml ya existentes en el proyecto).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function leer(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), 'utf-8');
}

describe('auto-enrich chain — cron base (run-live-comparison.ts)', () => {
  const src = leer('scripts/run-live-comparison.ts');

  it('el paso de enrich usa --recent-first', () => {
    const bloque = src.slice(src.indexOf("'3. enrich-news'"), src.indexOf("'3. enrich-news'") + 400);
    expect(bloque).toContain('--recent-first');
  });

  it('el paso de enrich está acotado a los medios de este ciclo (--medio-ids), no a la cola global', () => {
    const bloque = src.slice(src.indexOf("'3. enrich-news'"), src.indexOf("'3. enrich-news'") + 400);
    expect(bloque).toMatch(/--medio-ids=\$\{args\.crawlMedioIds\}/);
  });

  it('conserva only-missing-clean-text y only-pending-mentions (no cambia qué se enriquece, solo el orden/alcance)', () => {
    const bloque = src.slice(src.indexOf("'3. enrich-news'"), src.indexOf("'3. enrich-news'") + 400);
    expect(bloque).toContain('--only-missing-clean-text');
    expect(bloque).toContain('--only-pending-mentions');
  });
});

describe('auto-enrich chain — tiers aislados (nacional B / daily-validated / crisis)', () => {
  const archivos = [
    'scripts/run-shadow-national-tier.ts',
    'scripts/run-shadow-daily-validated-tier.ts',
    'scripts/run-shadow-crisis-tier.ts',
  ];

  it.each(archivos)('%s: el paso de enrich aislado usa --recent-first', (rel) => {
    const src = leer(rel);
    const idxEnrich = src.indexOf("enrich aislado'");
    expect(idxEnrich).toBeGreaterThan(-1);
    const bloque = src.slice(idxEnrich, idxEnrich + 300);
    expect(bloque).toContain('--recent-first');
  });

  it.each(archivos)('%s: sigue acotado por --medio-ids (no toca backlog global)', (rel) => {
    const src = leer(rel);
    const idxEnrich = src.indexOf("enrich aislado'");
    const bloque = src.slice(idxEnrich, idxEnrich + 300);
    expect(bloque).toMatch(/--medio-ids=\$\{medioIds\}/);
  });
});

describe('auto-enrich chain — no afecta a Patrón', () => {
  it('run-patron-no-pc-production-capture.ts no invoca enrich-news.ts (su propio pipeline es independiente)', () => {
    const src = leer('scripts/run-patron-no-pc-production-capture.ts');
    expect(src).not.toContain('enrich-news.ts');
  });
});
