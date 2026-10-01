import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH15 } from '../scripts/catalog-batch15.js';

describe('catalog-batch15 — overnight factory batch 7', () => {
  it('contiene 24 medios MED-0538..0562 salvo 0543 (Zona Roja HTTP 500)', () => {
    expect(MEDIOS_BATCH15).toHaveLength(24);
    expect(MEDIOS_BATCH15[0]?.medio_id).toBe('MED-0538');
    expect(MEDIOS_BATCH15.at(-1)?.medio_id).toBe('MED-0562');
    expect(MEDIOS_BATCH15.map((m) => m.medio_id)).not.toContain('MED-0543');
    expect(new Set(MEDIOS_BATCH15.map((m) => m.medio_id)).size).toBe(24);
  });
  it('hosts y feeds únicos', () => {
    const hosts = MEDIOS_BATCH15.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    const feeds = MEDIOS_BATCH15.map((m) => (m.rss_url ?? m.sitemap_url)!.replace(/\/+$/, '').toLowerCase());
    expect(new Set(hosts).size).toBe(24);
    expect(new Set(feeds).size).toBe(24);
  });
  it('no reutiliza IDs reservados ni Omnia/MSN', () => {
    const blob = MEDIOS_BATCH15.map((m) => `${m.medio_id} ${m.url_base}`).join(' ');
    expect(blob).not.toMatch(/MED-0185|MED-0204|omnia\.com\.mx|msn\.com/);
  });
});
