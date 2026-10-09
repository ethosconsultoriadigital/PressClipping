import { parseSitemapString } from '../parsers/sitemap.js';
import type { RawItem } from '../normalizers/noticia.js';
import { SITEMAP_CURSOR_PAGE_SIZE, parseSitemapCursor } from './sitemapCursor.js';
import type { SurfaceAttemptResult } from './surfaceResult.js';

export interface DurableSitemapCursor {
  v: 2;
  root: string;
  kind: 'urlset' | 'index';
  afterUrl: string | null;
  offset: number;
  nextSubIndex: number;
}

export interface SitemapPageResult {
  items: RawItem[];
  nextCursor: string | null;
  exhausted: boolean;
  failed: boolean;
  cursorNotFound: boolean;
  pendingSubs: number;
  subsFallidos: number;
  truncated: boolean;
  surfaceResult: SurfaceAttemptResult;
  resumedFrom: string | null;
}

export function encodeDurableSitemapCursor(c: DurableSitemapCursor): string {
  return [
    'sm2',
    c.kind,
    `o:${Math.max(0, c.offset)}`,
    `i:${Math.max(0, c.nextSubIndex)}`,
    `a:${c.afterUrl ? encodeURIComponent(c.afterUrl) : ''}`,
    `r:${encodeURIComponent(c.root)}`,
  ].join('|');
}

export function parseDurableSitemapCursor(raw: string | null | undefined): DurableSitemapCursor | 'INVALID' | null {
  if (!raw) return null;
  if (raw.startsWith('sm2|')) {
    const parts = raw.split('|');
    const kind = parts[1] === 'index' ? 'index' : parts[1] === 'urlset' ? 'urlset' : null;
    if (!kind) return 'INVALID';
    const offset = Number.parseInt((parts[2] ?? 'o:0').slice(2), 10);
    const nextSubIndex = Number.parseInt((parts[3] ?? 'i:0').slice(2), 10);
    const afterRaw = (parts[4] ?? 'a:').slice(2);
    const rootRaw = (parts[5] ?? 'r:').slice(2);
    if (!rootRaw) return 'INVALID';
    return {
      v: 2,
      kind,
      offset: Number.isFinite(offset) ? offset : 0,
      nextSubIndex: Number.isFinite(nextSubIndex) ? nextSubIndex : 0,
      afterUrl: afterRaw ? decodeURIComponent(afterRaw) : null,
      root: decodeURIComponent(rootRaw),
    };
  }
  if (raw.startsWith('page:') || raw.startsWith('offset:') || raw.startsWith('after:')) {
    const legacy = parseSitemapCursor(raw);
    return {
      v: 2,
      root: '',
      kind: 'urlset',
      afterUrl: legacy.afterUrl,
      offset: legacy.offset,
      nextSubIndex: 0,
    };
  }
  return 'INVALID';
}

function pageFromItems(
  items: RawItem[],
  cursor: DurableSitemapCursor | null,
  pageSize: number,
): { items: RawItem[]; start: number; notFound: boolean } {
  if (!cursor) return { items: items.slice(0, pageSize), start: 0, notFound: false };
  let start = cursor.offset;
  if (cursor.afterUrl) {
    const idx = items.findIndex((it) => it.url === cursor.afterUrl);
    if (idx < 0) return { items: [], start: 0, notFound: true };
    start = idx + 1;
  } else if (cursor.offset > 0 && cursor.offset > items.length) {
    return { items: [], start: cursor.offset, notFound: true };
  }
  return { items: items.slice(start, start + pageSize), start, notFound: false };
}

export async function paginateSitemap(opts: {
  rootUrl: string;
  fetcher: (url: string) => Promise<string>;
  cursor?: string | null;
  pageSize?: number;
  maxSubsPerRun?: number;
}): Promise<SitemapPageResult> {
  const pageSize = opts.pageSize ?? SITEMAP_CURSOR_PAGE_SIZE;
  const maxSubsPerRun = opts.maxSubsPerRun ?? 15;
  const parsedCursor = parseDurableSitemapCursor(opts.cursor);
  if (parsedCursor === 'INVALID') {
    return {
      items: [],
      nextCursor: null,
      exhausted: false,
      failed: true,
      cursorNotFound: true,
      pendingSubs: 0,
      subsFallidos: 0,
      truncated: false,
      surfaceResult: 'FAILED',
      resumedFrom: opts.cursor ?? null,
    };
  }

  let rootXml: string;
  try {
    rootXml = await opts.fetcher(opts.rootUrl);
  } catch {
    return {
      items: [],
      nextCursor: parsedCursor ? encodeDurableSitemapCursor({ ...parsedCursor, root: opts.rootUrl }) : opts.cursor ?? null,
      exhausted: false,
      failed: true,
      cursorNotFound: false,
      pendingSubs: 0,
      subsFallidos: 0,
      truncated: false,
      surfaceResult: 'FAILED',
      resumedFrom: opts.cursor ?? null,
    };
  }

  const root = parseSitemapString(rootXml);
  const isIndex = root.subSitemaps.length > 0 && root.items.length === 0;

  if (!isIndex) {
    const paged = pageFromItems(root.items, parsedCursor, pageSize);
    if (paged.notFound) {
      return {
        items: [],
        nextCursor: null,
        exhausted: false,
        failed: true,
        cursorNotFound: true,
        pendingSubs: 0,
        subsFallidos: 0,
        truncated: false,
        surfaceResult: 'FAILED',
        resumedFrom: opts.cursor ?? null,
      };
    }
    const consumed = paged.start + paged.items.length;
    const exhausted = consumed >= root.items.length;
    const last = paged.items[paged.items.length - 1];
    const next: DurableSitemapCursor = {
      v: 2,
      root: opts.rootUrl,
      kind: 'urlset',
      afterUrl: last?.url ?? parsedCursor?.afterUrl ?? null,
      offset: consumed,
      nextSubIndex: 0,
    };
    return {
      items: paged.items,
      nextCursor: exhausted ? null : encodeDurableSitemapCursor(next),
      exhausted,
      failed: false,
      cursorNotFound: false,
      pendingSubs: 0,
      subsFallidos: 0,
      truncated: false,
      surfaceResult: exhausted ? 'EXHAUSTED' : 'PARTIAL',
      resumedFrom: opts.cursor ?? null,
    };
  }

  const nextSubIndex = parsedCursor?.nextSubIndex ?? 0;
  const batch = root.subSitemaps.slice(nextSubIndex, nextSubIndex + maxSubsPerRun);
  const pendingAfterBatch = Math.max(0, root.subSitemaps.length - (nextSubIndex + batch.length));
  const collected: RawItem[] = [];
  let subsFallidos = 0;
  let visited = 0;
  for (const sub of batch) {
    visited += 1;
    try {
      const parsed = parseSitemapString(await opts.fetcher(sub));
      collected.push(...parsed.items.filter((it) => it.url));
    } catch {
      subsFallidos += 1;
    }
  }
  const truncated = pendingAfterBatch > 0 || nextSubIndex + visited < root.subSitemaps.length;
  const pageCursor: DurableSitemapCursor = {
    v: 2,
    root: opts.rootUrl,
    kind: 'index',
    afterUrl: parsedCursor?.afterUrl ?? null,
    offset: parsedCursor?.kind === 'index' ? parsedCursor.offset : 0,
    nextSubIndex,
  };
  const paged = pageFromItems(collected, parsedCursor?.kind === 'index' && parsedCursor.afterUrl ? parsedCursor : { ...pageCursor, afterUrl: null, offset: 0 }, pageSize);
  if (paged.notFound) {
    return {
      items: [],
      nextCursor: null,
      exhausted: false,
      failed: true,
      cursorNotFound: true,
      pendingSubs: pendingAfterBatch,
      subsFallidos,
      truncated,
      surfaceResult: 'FAILED',
      resumedFrom: opts.cursor ?? null,
    };
  }
  const moreInBatch = paged.start + paged.items.length < collected.length;
  const last = paged.items[paged.items.length - 1];
  const exhausted = !moreInBatch && pendingAfterBatch === 0 && subsFallidos === 0;
  const next: DurableSitemapCursor = {
    v: 2,
    root: opts.rootUrl,
    kind: 'index',
    afterUrl: moreInBatch ? last?.url ?? null : null,
    offset: moreInBatch ? paged.start + paged.items.length : 0,
    nextSubIndex: moreInBatch ? nextSubIndex : nextSubIndex + visited,
  };
  const surfaceResult: SurfaceAttemptResult = exhausted
    ? 'EXHAUSTED'
    : subsFallidos > 0 || truncated || moreInBatch
      ? 'PARTIAL'
      : 'SUCCESS';
  return {
    items: paged.items,
    nextCursor: exhausted ? null : encodeDurableSitemapCursor(next),
    exhausted,
    failed: false,
    cursorNotFound: false,
    pendingSubs: pendingAfterBatch,
    subsFallidos,
    truncated,
    surfaceResult,
    resumedFrom: opts.cursor ?? null,
  };
}
