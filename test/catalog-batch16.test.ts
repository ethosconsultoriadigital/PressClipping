import { describe, it, expect } from 'vitest';
import { MEDIOS_BATCH16 } from '../scripts/catalog-batch16.js';

describe('catalog-batch16 — discovery v3 batch 8', () => {
  it('contiene 17 medios MED-0563..0579', () => {
    expect(MEDIOS_BATCH16).toHaveLength(17);
    expect(MEDIOS_BATCH16[0]?.medio_id).toBe('MED-0563');
    expect(MEDIOS_BATCH16.at(-1)?.medio_id).toBe('MED-0579');
    expect(new Set(MEDIOS_BATCH16.map((m) => m.medio_id)).size).toBe(17);
  });
  it('hosts y feeds únicos', () => {
    const hosts = MEDIOS_BATCH16.map((m) => new URL(m.url_base!).hostname.replace(/^www\./, ''));
    const feeds = MEDIOS_BATCH16.map((m) => (m.rss_url ?? m.sitemap_url)!.replace(/\/+$/, '').toLowerCase());
    expect(new Set(hosts).size).toBe(17);
    expect(new Set(feeds).size).toBe(17);
  });
  it('no reutiliza IDs 0513-0562 ni Omnia/MSN', () => {
    const blob = MEDIOS_BATCH16.map((m) => `${m.medio_id} ${m.url_base}`).join(' ');
    expect(blob).not.toMatch(/MED-051[3-9]|MED-052|MED-053|MED-054|MED-055|MED-056[0-2]|omnia\.com\.mx|msn\.com/);
  });
});
