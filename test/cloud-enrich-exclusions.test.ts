/**
 * S5 — aislamiento del article enrich bloqueado en cloud.
 *
 * MED-0029 (La Jornada): captura sana en Actions, 30/30 HTTP 403 al descargar
 * el artículo, mismas URLs en 200 desde local. Se corta el enrich SOLO en
 * cloud; la captura sigue intacta.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLOUD_ENRICH_BLOCKED,
  esEntornoCloud,
  mediosConEnrichBloqueado,
  articleEnrichBloqueado,
  particionarMediosParaEnrich,
} from '../src/config/cloudEnrichExclusions.js';
import { mediosDailyNetNew } from '../src/config/shadowMedia.js';

const ACTIONS = { GITHUB_ACTIONS: 'true' };
const LOCAL = { GITHUB_ACTIONS: undefined };

describe('detección de entorno', () => {
  it('GitHub Actions cuenta como cloud', () => {
    expect(esEntornoCloud(ACTIONS)).toBe(true);
  });

  it('local no es cloud', () => {
    expect(esEntornoCloud(LOCAL)).toBe(false);
    expect(esEntornoCloud({})).toBe(false);
    expect(esEntornoCloud({ GITHUB_ACTIONS: 'false' })).toBe(false);
  });

  it('se puede forzar explícitamente (canary / pruebas)', () => {
    expect(esEntornoCloud({ ENRICH_CLOUD_TIER: '1' })).toBe(true);
    expect(esEntornoCloud({ ENRICH_CLOUD_TIER: '0' })).toBe(false);
  });
});

describe('MED-0029 — captura sí, article enrich cloud no', () => {
  it('sigue estando en el cron de captura del tier diario', () => {
    expect(mediosDailyNetNew().map((m) => m.medio_id)).toContain('MED-0029');
  });

  it('en GitHub Actions queda excluido del enrich', () => {
    expect(articleEnrichBloqueado('MED-0029', ACTIONS)).toBe(true);
    expect(mediosConEnrichBloqueado(ACTIONS)).toEqual(['MED-0029']);
  });

  it('en local NO se bloquea automáticamente', () => {
    expect(articleEnrichBloqueado('MED-0029', LOCAL)).toBe(false);
    expect(mediosConEnrichBloqueado(LOCAL)).toEqual([]);
  });

  it('su estado aprobado queda documentado con evidencia', () => {
    const jornada = CLOUD_ENRICH_BLOCKED.find((m) => m.medio_id === 'MED-0029');
    expect(jornada?.estado).toBe('C_CAPTURE_ONLY_CLOUD_ENRICH_BLOCKED');
    expect(jornada?.evidencia).toMatch(/403/);
  });
});

describe('MED-0196 — deuda abierta, sin exclusión', () => {
  it('NO está en la lista de bloqueados', () => {
    expect(CLOUD_ENRICH_BLOCKED.map((m) => m.medio_id)).not.toContain('MED-0196');
    expect(articleEnrichBloqueado('MED-0196', ACTIONS)).toBe(false);
  });

  it('sigue en el cron sin cambios', () => {
    expect(mediosDailyNetNew().map((m) => m.medio_id)).toContain('MED-0196');
  });
});

describe('particionarMediosParaEnrich', () => {
  const tier = ['MED-0029', 'MED-0039', 'MED-0196', 'MED-0201'];

  it('en cloud separa el bloqueado y deja el resto intacto', () => {
    const r = particionarMediosParaEnrich(tier, ACTIONS);
    expect(r.excluidos).toEqual(['MED-0029']);
    expect(r.permitidos).toEqual(['MED-0039', 'MED-0196', 'MED-0201']);
  });

  it('en local no excluye a nadie', () => {
    const r = particionarMediosParaEnrich(tier, LOCAL);
    expect(r.excluidos).toEqual([]);
    expect(r.permitidos).toEqual(tier);
  });

  it('preserva el orden y no inventa medios', () => {
    const r = particionarMediosParaEnrich(tier, ACTIONS);
    expect([...r.permitidos, ...r.excluidos].sort()).toEqual([...tier].sort());
  });

  it('lista vacía es segura', () => {
    expect(particionarMediosParaEnrich([], ACTIONS)).toEqual({ permitidos: [], excluidos: [] });
  });

  it('solo hay un medio bloqueado hoy', () => {
    expect(CLOUD_ENRICH_BLOCKED).toHaveLength(1);
  });
});

describe('runner del tier diario', () => {
  const script = readFileSync(
    join(process.cwd(), 'scripts/run-shadow-daily-validated-tier.ts'),
    'utf-8',
  );

  it('la ruta LEGACY también respeta la exclusión', () => {
    expect(script).toContain('particionarMediosParaEnrich');
    expect(script).toContain('--medio-ids=${enrichMedioIds}');
  });

  it('el crawl sigue usando la lista completa de medios', () => {
    expect(script).toContain('--medio-ids=${medioIds}`, `--limit=${medios.length}');
  });

  it('el drain marca el 403 de un medio bloqueado como BLOCKED_REVIEW', () => {
    expect(script).toContain('isEnvironmentBlocked: (medioId) => articleEnrichBloqueado(medioId)');
  });
});
