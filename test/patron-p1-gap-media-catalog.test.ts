/**
 * Tests del alta de catálogo AM León (MED-0172) y CRT (MED-0173) — lote
 * PATRON P1 MEDIA GAP CLOSURE (2026-07-17). Módulo puro (sin DB): valida forma
 * de los datos que se upsertean, no ejecuta red ni Supabase.
 */
import { describe, it, expect } from 'vitest';
import { NUEVOS_MEDIOS } from '../scripts/catalog-patron-p1-gap-media.js';
import { medioSchema } from '../src/types/schemas.js';
import {
  SHADOW_MEDIOS_DAILY_VALIDATED,
  SHADOW_MEDIOS_NACIONALES_B,
  mediosDailyNetNew,
} from '../src/config/shadowMedia.js';

describe('catalog-patron-p1-gap-media — NUEVOS_MEDIOS', () => {
  it('contiene exactamente MED-0172 (AM León) y MED-0173 (CRT)', () => {
    expect(NUEVOS_MEDIOS.map((m) => m.medio_id).sort()).toEqual(['MED-0172', 'MED-0173']);
  });

  it('cada fila valida contra el esquema real de la tabla medios', () => {
    for (const m of NUEVOS_MEDIOS) {
      const r = medioSchema.safeParse(m);
      expect(r.success, r.success ? '' : JSON.stringify(r.error?.issues)).toBe(true);
    }
  });

  it('ninguno requiere proxy ni JavaScript (sin bypass paywall, sin Playwright)', () => {
    for (const m of NUEVOS_MEDIOS) {
      expect(m.requiere_proxy).toBe(false);
      expect(m.requiere_javascript).toBe(false);
    }
  });

  it('ambos usan metodo_extraccion=SITEMAP con sitemap_url https absoluto', () => {
    for (const m of NUEVOS_MEDIOS) {
      expect(m.metodo_extraccion).toBe('SITEMAP');
      expect(m.sitemap_url).toMatch(/^https:\/\//);
    }
  });

  it('CRT usa el sitemap de posts (no el índice) para evitar páginas/taxonomías/usuarios', () => {
    const crt = NUEVOS_MEDIOS.find((m) => m.medio_id === 'MED-0173')!;
    expect(crt.sitemap_url).toBe('https://www.crt.org.mx/wp-sitemap-posts-post-1.xml');
    expect(crt.sitemap_url).not.toBe('https://www.crt.org.mx/wp-sitemap.xml');
  });

  it('AM León apunta al news-sitemap.xml (Google News/Jetpack)', () => {
    const amLeon = NUEVOS_MEDIOS.find((m) => m.medio_id === 'MED-0172')!;
    expect(amLeon.sitemap_url).toBe('https://www.am.com.mx/news-sitemap.xml');
  });
});

describe('tier daily-validated — AM León y CRT net-new', () => {
  it('ambos están en SHADOW_MEDIOS_DAILY_VALIDATED con max_notas_shadow<=30 y fuente=auto', () => {
    for (const id of ['MED-0172', 'MED-0173']) {
      const m = SHADOW_MEDIOS_DAILY_VALIDATED.find((x) => x.medio_id === id);
      expect(m).toBeDefined();
      expect(m!.fuente).toBe('auto');
      expect(m!.max_notas_shadow).toBeLessThanOrEqual(30);
    }
  });

  it('son net-new (no colisionan con base/nacional B/crisis)', () => {
    const netNewIds = mediosDailyNetNew().map((m) => m.medio_id);
    expect(netNewIds).toContain('MED-0172');
    expect(netNewIds).toContain('MED-0173');
  });

  it('CRT no aparece en el tier nacional B (no se confunde con Milenio ni ningún otro medio)', () => {
    expect(SHADOW_MEDIOS_NACIONALES_B.map((m) => m.medio_id)).not.toContain('MED-0173');
  });
});
