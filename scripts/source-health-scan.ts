/**
 * Zero-AI source health scan.
 * --mode=light|deep  --limit=N  --fuente-ids=  --discovered-only
 * Deep reusa scoreMediaAtAnchor. No LLM.
 */
import 'dotenv/config';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';
import { lightProbeWeb } from '../src/sourceRegistry/lightProbe.js';
import { deepScoreFromNotes } from '../src/sourceRegistry/deepProbe.js';
import type { Platform } from '../src/sourceRegistry/types.js';
import { parseRssString } from '../src/parsers/rss.js';
import { parseSitemapString } from '../src/parsers/sitemap.js';
import { fetchTextWithMeta } from '../src/utils/http.js';
import { fetchAndExtract } from '../src/extractors/html.js';
import type { CertProbe } from '../src/mediaValidation/certClassify.js';

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const mode = (arg('mode') ?? 'light') as 'light' | 'deep';
  const limit = Number.parseInt(arg('limit') ?? '50', 10);
  const ids = (arg('fuente-ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const discoveredOnly = process.argv.includes('--discovered-only');
  const dry = process.argv.includes('--dry-run');

  const sb = getSupabase();
  let q = sb.from('fuente_canales').select('*').eq('activo', true);
  if (ids.length) q = sb.from('fuente_canales').select('*').in('fuente_id', ids);
  else if (discoveredOnly) {
    const { data: disc } = await sb.from('fuentes').select('fuente_id').eq('lifecycle_status', 'DISCOVERED');
    const dIds = (disc ?? []).map((r) => r.fuente_id);
    if (!dIds.length) {
      logger.info('No DISCOVERED fuentes');
      return;
    }
    q = sb.from('fuente_canales').select('*').in('fuente_id', dIds);
  }
  const { data: canales, error } = await q.limit(limit);
  if (error) throw error;
  const list = canales ?? [];
  const now = new Date().toISOString();
  const tally: Record<string, number> = {};

  for (const c of list) {
    if (mode === 'light') {
      const out = await lightProbeWeb({
        platform: c.platform as Platform,
        url: c.canonical_url,
        rssUrl: c.rss_url,
        sitemapUrl: c.sitemap_url,
        consecutiveFailures: c.consecutive_failures ?? 0,
        nowIso: now,
      });
      tally[out.health] = (tally[out.health] ?? 0) + 1;
      if (!dry) {
        const patch = {
          health_status: out.health,
          capture_status: out.capture,
          last_http_status: out.httpStatus,
          last_light_probe_at: now,
          last_success_at: out.consecutiveFailures === 0 ? now : c.last_success_at,
          latest_content_at: out.latestContentAt,
          consecutive_failures: out.consecutiveFailures,
          redirect_final_url: out.redirectFinalUrl,
          rss_url: out.rssUrl ?? c.rss_url,
          sitemap_url: out.sitemapUrl ?? c.sitemap_url,
        };
        const { error: u } = await sb.from('fuente_canales').update(patch).eq('canal_id', c.canal_id);
        if (u) throw u;
        await sb
          .from('fuentes')
          .update({ health_status: out.health, capture_status: out.capture, last_seen_at: now })
          .eq('fuente_id', c.fuente_id);
      }
      continue;
    }

    if (c.platform !== 'WEB') {
      tally.UNKNOWN = (tally.UNKNOWN ?? 0) + 1;
      continue;
    }
    const notes = [];
    const src = c.rss_url || c.sitemap_url;
    if (src) {
      try {
        const r = await fetchTextWithMeta(src, { timeoutMs: 12000, retries: 0, maxAttempts: 1 });
        const items = c.rss_url
          ? await parseRssString(r.text)
          : parseSitemapString(r.text).items;
        for (const it of items.slice(0, 8)) {
          const url = it.url;
          if (!url) continue;
          const ex = await fetchAndExtract(url, { timeoutMs: 12000, maxAttempts: 1 });
          notes.push({
            url,
            titulo: ex.titulo ?? it.titulo ?? null,
            fecha: it.fecha ?? null,
            created_at: now,
            texto_cuerpo_nota: ex.texto_cuerpo_nota,
            texto_nota_limpia: ex.texto_nota_limpia,
          });
        }
      } catch {
        /* deep miss */
      }
    }
    const probe: CertProbe = { class: 'HEALTHY', status: 200, error: null };
    const scored = deepScoreFromNotes({
      medioId: c.fuente_id,
      notes,
      probe,
      lastEstado: 'ok',
      lastError: null,
      paywallNotes: false,
      anchorIso: now,
    });
    tally[scored.technical_class] = (tally[scored.technical_class] ?? 0) + 1;
    if (!dry) {
      await sb
        .from('fuente_canales')
        .update({
          technical_class: scored.technical_class,
          last_deep_probe_at: now,
        })
        .eq('canal_id', c.canal_id);
      const life = scored.technical_class === 'A' || scored.technical_class === 'B' ? 'PROBED' : 'PROBED';
      await sb
        .from('fuentes')
        .update({
          technical_class: scored.technical_class,
          lifecycle_status: life,
          notes: scored.reason,
        })
        .eq('fuente_id', c.fuente_id);
    }
  }

  logger.info({ mode, n: list.length, tally, dry, ai_calls: 0 }, 'source-health-scan done');
}

main().catch((err) => {
  logger.error(err, 'source-health-scan fatal');
  process.exit(1);
});
