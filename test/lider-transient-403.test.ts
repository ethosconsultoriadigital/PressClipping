import { describe, it, expect } from 'vitest';
import { HttpRequestError } from '../src/utils/http.js';
import {
  shouldRetryOnceOn403,
  fetchHtmlRespectingTransient403,
  hostnameOfArticleUrl,
} from '../src/extractors/transient403Retry.js';
import { fetchAndExtract } from '../src/extractors/html.js';

const LIDER = 'https://www.liderempresarial.com/medtrack-startup-queretaro-historial-medico-digital/';
const OTHER = 'https://www.eluniversal.com.mx/nota/algo';

describe('transient 403 retry (Líder Empresarial, same UA)', () => {
  it('retries once on 403 only for liderempresarial.com', () => {
    expect(hostnameOfArticleUrl(LIDER)).toBe('liderempresarial.com');
    expect(shouldRetryOnceOn403(LIDER, 403)).toBe(true);
    expect(shouldRetryOnceOn403(OTHER, 403)).toBe(false);
    expect(shouldRetryOnceOn403(LIDER, 404)).toBe(false);
    expect(shouldRetryOnceOn403(LIDER, 200)).toBe(false);
  });

  it('second GET after 403 returns the body (no UA spoof)', async () => {
    const html = `<html><body><article><p>${'Cuerpo Líder Empresarial sobre INEGI y empleo formal. '.repeat(8)}</p></article></body></html>`;
    let n = 0;
    const fetchHtml = async () => {
      n += 1;
      if (n === 1) {
        throw new HttpRequestError(`HTTP 403 en ${LIDER} (no reintentable)`, {
          kind: 'http_status',
          url: LIDER,
          status: 403,
          retryable: false,
        });
      }
      return { text: html, status: 200, finalUrl: LIDER };
    };
    const r = await fetchHtmlRespectingTransient403(LIDER, {}, fetchHtml);
    expect(n).toBe(2);
    expect(r.status).toBe(200);
    expect(r.text).toContain('Cuerpo Líder');
  });

  it('other hosts do not retry 403', async () => {
    let n = 0;
    const fetchHtml = async () => {
      n += 1;
      throw new HttpRequestError(`HTTP 403 en ${OTHER} (no reintentable)`, {
        kind: 'http_status',
        url: OTHER,
        status: 403,
        retryable: false,
      });
    };
    await expect(fetchHtmlRespectingTransient403(OTHER, {}, fetchHtml)).rejects.toMatchObject({
      status: 403,
    });
    expect(n).toBe(1);
  });

  it('fetchAndExtract recovers Líder article after a 403 then 200', async () => {
    const html = `<html><head><meta property="og:title" content="MedTrack"></head>
      <body><article><div class="entry-content"><p>${'La startup queretana digitaliza el expediente clínico de pacientes. '.repeat(10)}</p></div></article></body></html>`;
    let n = 0;
    const fetchHtml = async () => {
      n += 1;
      if (n === 1) {
        throw new HttpRequestError(`HTTP 403 en ${LIDER} (no reintentable)`, {
          kind: 'http_status',
          url: LIDER,
          status: 403,
          retryable: false,
        });
      }
      return { text: html, status: 200, finalUrl: LIDER };
    };
    const r = await fetchAndExtract(LIDER, { fetchHtml });
    expect(n).toBe(2);
    expect(r.ok).toBe(true);
    expect((r.cuerpo_nota_chars ?? 0) >= 200).toBe(true);
    expect(r.texto_cuerpo_nota ?? '').toContain('expediente clínico');
  });
});
