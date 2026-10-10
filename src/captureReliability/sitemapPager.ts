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
  failedSubs: string[];
  nestedUrl: string | null;
  nestedNextSubIndex: number;
  nestedFailed: string[];
  depthCapHit?: boolean;
}

export interface SitemapPageResult {
  items: RawItem[];
  nextCursor: string | null;
  exhausted: boolean;
  failed: boolean;
  cursorNotFound: boolean;
  cursorRootMismatch: boolean;
  pendingSubs: number;
  subsFallidos: number;
  truncated: boolean;
  surfaceResult: SurfaceAttemptResult;
  resumedFrom: string | null;
  depthCapHit: boolean;
}

interface CursorExtra {
  failed: string[];
  nestedUrl: string | null;
  nestedIdx: number;
  nestedFailed: string[];
  depthCap?: boolean;
}

const emptyExtra = (): CursorExtra => ({
  failed: [],
  nestedUrl: null,
  nestedIdx: 0,
  nestedFailed: [],
  depthCap: false,
});

export function encodeDurableSitemapCursor(c: DurableSitemapCursor): string {
  const extra: CursorExtra = {
    failed: c.failedSubs,
    nestedUrl: c.nestedUrl,
    nestedIdx: c.nestedNextSubIndex,
    nestedFailed: c.nestedFailed,
    depthCap: c.depthCapHit === true,
  };
  return [
    'sm2',
    c.kind,
    `o:${Math.max(0, c.offset)}`,
    `i:${Math.max(0, c.nextSubIndex)}`,
    `a:${c.afterUrl ? encodeURIComponent(c.afterUrl) : ''}`,
    `r:${encodeURIComponent(c.root)}`,
    `x:${encodeURIComponent(JSON.stringify(extra))}`,
  ].join('|');
}

function readExtra(raw: string | undefined): CursorExtra {
  if (!raw?.startsWith('x:')) return emptyExtra();
  try {
    const parsed = JSON.parse(decodeURIComponent(raw.slice(2))) as CursorExtra;
    return {
      failed: Array.isArray(parsed.failed) ? parsed.failed : [],
      nestedUrl: parsed.nestedUrl ?? null,
      nestedIdx: Number.isFinite(parsed.nestedIdx) ? parsed.nestedIdx : 0,
      nestedFailed: Array.isArray(parsed.nestedFailed) ? parsed.nestedFailed : [],
      depthCap: parsed.depthCap === true,
    };
  } catch {
    return emptyExtra();
  }
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
    const extra = readExtra(parts[6]);
    return {
      v: 2,
      kind,
      offset: Number.isFinite(offset) ? offset : 0,
      nextSubIndex: Number.isFinite(nextSubIndex) ? nextSubIndex : 0,
      afterUrl: afterRaw ? decodeURIComponent(afterRaw) : null,
      root: decodeURIComponent(rootRaw),
      failedSubs: extra.failed,
      nestedUrl: extra.nestedUrl,
      nestedNextSubIndex: extra.nestedIdx,
      nestedFailed: extra.nestedFailed,
      depthCapHit: extra.depthCap === true,
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
      failedSubs: [],
      nestedUrl: null,
      nestedNextSubIndex: 0,
      nestedFailed: [],
      depthCapHit: false,
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

function failResult(over: Partial<SitemapPageResult> & { resumedFrom: string | null }): SitemapPageResult {
  return {
    items: [],
    nextCursor: over.nextCursor ?? null,
    exhausted: false,
    failed: true,
    cursorNotFound: over.cursorNotFound ?? false,
    cursorRootMismatch: over.cursorRootMismatch ?? false,
    pendingSubs: over.pendingSubs ?? 0,
    subsFallidos: over.subsFallidos ?? 0,
    truncated: false,
    surfaceResult: 'FAILED',
    resumedFrom: over.resumedFrom,
    depthCapHit: false,
  };
}

export async function paginateSitemap(opts: {
  rootUrl: string;
  fetcher: (url: string) => Promise<string>;
  cursor?: string | null;
  pageSize?: number;
  maxSubsPerRun?: number;
  maxDepth?: number;
}): Promise<SitemapPageResult> {
  const pageSize = opts.pageSize ?? SITEMAP_CURSOR_PAGE_SIZE;
  const maxSubsPerRun = opts.maxSubsPerRun ?? 15;
  const maxDepth = opts.maxDepth ?? 2;
  const parsedCursor = parseDurableSitemapCursor(opts.cursor);
  if (parsedCursor === 'INVALID') {
    return failResult({ resumedFrom: opts.cursor ?? null, cursorNotFound: true });
  }
  if (parsedCursor?.root && parsedCursor.root !== opts.rootUrl) {
    return failResult({
      resumedFrom: opts.cursor ?? null,
      cursorRootMismatch: true,
      nextCursor: opts.cursor ?? null,
    });
  }

  let rootXml: string;
  try {
    rootXml = await opts.fetcher(opts.rootUrl);
  } catch {
    return failResult({
      resumedFrom: opts.cursor ?? null,
      nextCursor: parsedCursor
        ? encodeDurableSitemapCursor({ ...withDefaults(parsedCursor), root: opts.rootUrl })
        : opts.cursor ?? null,
    });
  }

  const root = parseSitemapString(rootXml);
  const isIndex = root.subSitemaps.length > 0 && root.items.length === 0;

  if (!isIndex) {
    const paged = pageFromItems(root.items, parsedCursor, pageSize);
    if (paged.notFound) {
      return failResult({ resumedFrom: opts.cursor ?? null, cursorNotFound: true });
    }
    const consumed = paged.start + paged.items.length;
    const exhausted = consumed >= root.items.length;
    const last = paged.items[paged.items.length - 1];
    const next = withDefaults(parsedCursor, {
      root: opts.rootUrl,
      kind: 'urlset',
      afterUrl: last?.url ?? parsedCursor?.afterUrl ?? null,
      offset: consumed,
    });
    return {
      items: paged.items,
      nextCursor: exhausted ? null : encodeDurableSitemapCursor(next),
      exhausted,
      failed: false,
      cursorNotFound: false,
      cursorRootMismatch: false,
      pendingSubs: 0,
      subsFallidos: 0,
      truncated: false,
      surfaceResult: exhausted ? 'EXHAUSTED' : 'PARTIAL',
      resumedFrom: opts.cursor ?? null,
      depthCapHit: false,
    };
  }

  let budget = maxSubsPerRun;
  const collected: RawItem[] = [];
  let failedSubs = [...(parsedCursor?.failedSubs ?? [])];
  let nestedUrl = parsedCursor?.nestedUrl ?? null;
  let nestedIdx = parsedCursor?.nestedNextSubIndex ?? 0;
  let nestedFailed = [...(parsedCursor?.nestedFailed ?? [])];
  let nextSubIndex = parsedCursor?.nextSubIndex ?? 0;
  let depthCapHit = parsedCursor?.depthCapHit === true;

  const fetchParsed = async (url: string): Promise<{ items: RawItem[]; subs: string[] } | 'FAILED'> => {
    try {
      const parsed = parseSitemapString(await opts.fetcher(url));
      return { items: parsed.items.filter((it) => Boolean(it.url)), subs: parsed.subSitemaps };
    } catch {
      return 'FAILED';
    }
  };

  const processLevel = async (
    indexUrl: string,
    startIdx: number,
    priorFailed: string[],
    depth: number,
  ): Promise<{ items: RawItem[]; failed: string[]; nextIdx: number; complete: boolean; depthCap: boolean }> => {
    if (depth >= maxDepth) {
      return { items: [], failed: [indexUrl], nextIdx: startIdx, complete: false, depthCap: true };
    }
    const parsed = await fetchParsed(indexUrl);
    if (parsed === 'FAILED') {
      return { items: [], failed: [indexUrl], nextIdx: startIdx, complete: false, depthCap: false };
    }
    const items: RawItem[] = [...parsed.items];
    const failed: string[] = [];
    let depthCap = false;
    const take = async (url: string): Promise<'ok' | 'fail' | 'cap'> => {
      if (budget <= 0) return 'fail';
      budget -= 1;
      const got = await fetchParsed(url);
      if (got === 'FAILED') return 'fail';
      if (got.subs.length > 0 && got.items.length === 0) {
        if (depth + 1 >= maxDepth) {
          depthCap = true;
          return 'cap';
        }
        const nested = await processLevel(url, 0, [], depth + 1);
        items.push(...nested.items);
        if (nested.failed.length || !nested.complete) {
          failed.push(...nested.failed);
          if (!nested.complete && nested.failed.length === 0 && nested.depthCap) depthCap = true;
        }
        return nested.complete && nested.failed.length === 0 ? 'ok' : 'fail';
      }
      items.push(...got.items);
      return 'ok';
    };
    for (const f of priorFailed) {
      if (budget <= 0) {
        failed.push(f);
        continue;
      }
      const status = await take(f);
      if (status !== 'ok') failed.push(f);
    }
    let i = startIdx;
    while (i < parsed.subs.length && budget > 0) {
      const status = await take(parsed.subs[i]!);
      if (status === 'fail') failed.push(parsed.subs[i]!);
      i += 1;
    }
    return {
      items,
      failed,
      nextIdx: i,
      complete: i >= parsed.subs.length && failed.length === 0 && !depthCap,
      depthCap,
    };
  };

  if (nestedUrl) {
    const nested = await processLevel(nestedUrl, nestedIdx, nestedFailed, 1);
    collected.push(...nested.items);
    nestedFailed = nested.failed;
    nestedIdx = nested.nextIdx;
    depthCapHit = nested.depthCap;
    if (nested.complete) {
      nestedUrl = null;
      nestedIdx = 0;
      nestedFailed = [];
    }
  }

  const stillFailed: string[] = [];
  for (const f of failedSubs) {
    if (budget <= 0) {
      stillFailed.push(f);
      continue;
    }
    const nested = await processLevel(f, 0, [], 1);
    if (nested.failed.includes(f) && nested.items.length === 0 && nested.nextIdx === 0 && !nested.complete) {
      stillFailed.push(f);
      continue;
    }
    collected.push(...nested.items);
    if (!nested.complete) {
      if (nested.failed.length === 1 && nested.failed[0] === f && nested.items.length === 0) {
        stillFailed.push(f);
      } else {
        nestedUrl = f;
        nestedIdx = nested.nextIdx;
        nestedFailed = nested.failed;
      }
    }
    depthCapHit = depthCapHit || nested.depthCap;
  }
  failedSubs = stillFailed;

  while (nextSubIndex < root.subSitemaps.length && budget > 0 && !nestedUrl) {
    const sub = root.subSitemaps[nextSubIndex]!;
    budget -= 1;
    const got = await fetchParsed(sub);
    if (got === 'FAILED') {
      failedSubs.push(sub);
      nextSubIndex += 1;
      continue;
    }
    if (got.subs.length > 0 && got.items.length === 0) {
      if (1 >= maxDepth) {
        depthCapHit = true;
        failedSubs.push(sub);
        nextSubIndex += 1;
        continue;
      }
      const nested = await processLevel(sub, 0, [], 1);
      collected.push(...nested.items);
      nextSubIndex += 1;
      depthCapHit = depthCapHit || nested.depthCap;
      if (!nested.complete) {
        nestedUrl = sub;
        nestedIdx = nested.nextIdx;
        nestedFailed = nested.failed;
        if (nested.failed.length === 1 && nested.failed[0] === sub && nested.items.length === 0) {
          failedSubs.push(sub);
          nestedUrl = null;
        }
      }
      continue;
    }
    collected.push(...got.items);
    nextSubIndex += 1;
  }

  const unvisited = Math.max(0, root.subSitemaps.length - nextSubIndex);
  const pending = unvisited + failedSubs.length + (nestedUrl ? 1 : 0);
  const exhausted = pending === 0 && !depthCapHit;
  const pageCursor = withDefaults(parsedCursor, {
    root: opts.rootUrl,
    kind: 'index',
    afterUrl: parsedCursor?.afterUrl ?? null,
    offset: parsedCursor?.kind === 'index' ? parsedCursor.offset : 0,
    nextSubIndex,
    failedSubs,
    nestedUrl,
    nestedNextSubIndex: nestedIdx,
    nestedFailed,
    depthCapHit,
  });
  const paged = pageFromItems(
    collected,
    parsedCursor?.kind === 'index' && parsedCursor.afterUrl ? parsedCursor : { ...pageCursor, afterUrl: null, offset: 0 },
    pageSize,
  );
  if (paged.notFound) {
    return failResult({
      resumedFrom: opts.cursor ?? null,
      cursorNotFound: true,
      pendingSubs: pending,
      subsFallidos: failedSubs.length,
    });
  }
  const moreInBatch = paged.start + paged.items.length < collected.length;
  const last = paged.items[paged.items.length - 1];
  const reallyExhausted = exhausted && !moreInBatch;
  const next: DurableSitemapCursor = {
    ...pageCursor,
    afterUrl: moreInBatch ? last?.url ?? null : null,
    offset: moreInBatch ? paged.start + paged.items.length : 0,
  };
  const surfaceResult: SurfaceAttemptResult = reallyExhausted
    ? 'EXHAUSTED'
    : 'PARTIAL';
  return {
    items: paged.items,
    nextCursor: reallyExhausted ? null : encodeDurableSitemapCursor(next),
    exhausted: reallyExhausted,
    failed: false,
    cursorNotFound: false,
    cursorRootMismatch: false,
    pendingSubs: pending + (moreInBatch ? 1 : 0),
    subsFallidos: failedSubs.length + nestedFailed.length,
    truncated: unvisited > 0 || moreInBatch || depthCapHit,
    surfaceResult,
    resumedFrom: opts.cursor ?? null,
    depthCapHit,
  };
}

function withDefaults(
  cursor: DurableSitemapCursor | null | undefined,
  over: Partial<DurableSitemapCursor> = {},
): DurableSitemapCursor {
  return {
    v: 2,
    root: over.root ?? cursor?.root ?? '',
    kind: over.kind ?? cursor?.kind ?? 'index',
    afterUrl: over.afterUrl ?? cursor?.afterUrl ?? null,
    offset: over.offset ?? cursor?.offset ?? 0,
    nextSubIndex: over.nextSubIndex ?? cursor?.nextSubIndex ?? 0,
    failedSubs: over.failedSubs ?? cursor?.failedSubs ?? [],
    nestedUrl: over.nestedUrl ?? cursor?.nestedUrl ?? null,
    nestedNextSubIndex: over.nestedNextSubIndex ?? cursor?.nestedNextSubIndex ?? 0,
    nestedFailed: over.nestedFailed ?? cursor?.nestedFailed ?? [],
    depthCapHit: over.depthCapHit ?? cursor?.depthCapHit ?? false,
  };
}
