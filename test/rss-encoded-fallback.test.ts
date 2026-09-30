import { describe, it, expect, beforeEach } from 'vitest';
import { HttpRequestError } from '../src/utils/http.js';
import { fetchAndExtract } from '../src/extractors/html.js';
import {
  shouldUseRssEncodedFallback,
  clearRssEncodedFallbackCache,
  fetchHtmlRespectingRssEncodedFallback,
} from '../src/extractors/rssEncodedFallback.js';

const EH =
  'https://energiahoy.com/economia-y-finanzas/mexico-preve-55-mil-mdd-en-inversion-extranjera-directa-en-2026/';
const FEED = 'https://energiahoy.com/feed/';
const OTHER = 'https://www.eluniversal.com.mx/estados/nota.html';

const BODY =
  'La inversión extranjera directa se posicionó como un eje estratégico para la economía mexicana, luego de que autoridades proyectaron que este indicador alcanzó niveles históricos en 2026. ';

function rssXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Energía Hoy</title>
    <item>
      <title>México prevé 55 mil mdd</title>
      <link>${EH}</link>
      <content:encoded><![CDATA[<p>${BODY}${BODY}</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;
}

beforeEach(() => {
  clearRssEncodedFallbackCache();
});

describe('RSS content:encoded fallback (Energía Hoy)', () => {
  it('only Energía Hoy 502/timeout qualify', () => {
    const e502 = new HttpRequestError('HTTP 502', {
      kind: 'http_status',
      url: EH,
      status: 502,
      retryable: true,
    });
    const eTimeout = new HttpRequestError('timeout', {
      kind: 'timeout',
      url: EH,
      status: null,
      retryable: true,
    });
    const e404 = new HttpRequestError('HTTP 404', {
      kind: 'http_status',
      url: EH,
      status: 404,
      retryable: false,
    });
    const other502 = new HttpRequestError('HTTP 502', {
      kind: 'http_status',
      url: OTHER,
      status: 502,
      retryable: true,
    });
    expect(shouldUseRssEncodedFallback(EH, e502)).toBe(true);
    expect(shouldUseRssEncodedFallback(EH, eTimeout)).toBe(true);
    expect(shouldUseRssEncodedFallback(EH, e404)).toBe(false);
    expect(shouldUseRssEncodedFallback(OTHER, other502)).toBe(false);
    expect(
      shouldUseRssEncodedFallback(
        'https://www.diariocambio.com.mx/2026/economia/nota/',
        new HttpRequestError('HTTP 403', { kind: 'http_status', url: 'https://www.diariocambio.com.mx/x', status: 403, retryable: false }),
      ),
    ).toBe(true);
    expect(
      shouldUseRssEncodedFallback(
        'https://www.heraldoleon.mx/nota/',
        new HttpRequestError('HTTP 307', { kind: 'http_status', url: 'https://www.heraldoleon.mx/x', status: 307, retryable: true }),
      ),
    ).toBe(true);
  });

  it('recovers article body from RSS after HTTP 502', async () => {
    let articleGets = 0;
    let feedGets = 0;
    const fetchHtml = async (url: string) => {
      if (url === FEED) {
        feedGets += 1;
        return { text: rssXml(), status: 200, finalUrl: FEED };
      }
      articleGets += 1;
      throw new HttpRequestError(`HTTP 502 en ${url} (no reintentable)`, {
        kind: 'http_status',
        url,
        status: 502,
        retryable: false,
      });
    };
    const r = await fetchHtmlRespectingRssEncodedFallback(EH, {}, fetchHtml);
    expect(articleGets).toBe(1);
    expect(feedGets).toBe(1);
    expect(r.status).toBe(200);
    expect(r.text).toContain('inversión extranjera directa');
  });

  it('other hosts do not hit the RSS fallback on 502', async () => {
    let n = 0;
    const fetchHtml = async (url: string) => {
      n += 1;
      throw new HttpRequestError(`HTTP 502 en ${url}`, {
        kind: 'http_status',
        url,
        status: 502,
        retryable: true,
      });
    };
    await expect(fetchHtmlRespectingRssEncodedFallback(OTHER, {}, fetchHtml)).rejects.toMatchObject({
      status: 502,
    });
    expect(n).toBe(1);
  });

  it('fetchAndExtract recovers Energía Hoy after 502 via RSS content:encoded', async () => {
    const fetchHtml = async (url: string) => {
      if (url.includes('/feed')) {
        return { text: rssXml(), status: 200, finalUrl: FEED };
      }
      throw new HttpRequestError(`HTTP 502 en ${url}`, {
        kind: 'http_status',
        url,
        status: 502,
        retryable: false,
      });
    };
    const r = await fetchAndExtract(EH, { fetchHtml });
    expect(r.ok).toBe(true);
    expect(r.texto_cuerpo_nota ?? '').toContain('inversión extranjera directa');
    expect((r.cuerpo_nota_chars ?? 0) >= 200).toBe(true);
  });
});
