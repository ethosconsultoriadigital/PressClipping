export const SITEMAP_CURSOR_PAGE_SIZE = 400;

export function encodeSitemapPageCursor(page: number): string {
  return `page:${Math.max(1, page)}`;
}

export function encodeSitemapAfterCursor(url: string): string {
  return `after:${url}`;
}

export function encodeSitemapOffsetCursor(offset: number): string {
  return `offset:${Math.max(0, offset)}`;
}

export function parseSitemapCursor(
  cursor: string | null | undefined,
  pageSize = SITEMAP_CURSOR_PAGE_SIZE,
): { kind: 'none' | 'page' | 'after' | 'offset'; page: number; offset: number; afterUrl: string | null } {
  if (!cursor) return { kind: 'none', page: 1, offset: 0, afterUrl: null };
  if (cursor.startsWith('page:')) {
    const page = Math.max(1, Number.parseInt(cursor.slice(5), 10) || 1);
    return { kind: 'page', page, offset: (page - 1) * pageSize, afterUrl: null };
  }
  if (cursor.startsWith('offset:')) {
    const offset = Math.max(0, Number.parseInt(cursor.slice(7), 10) || 0);
    return { kind: 'offset', page: Math.floor(offset / pageSize) + 1, offset, afterUrl: null };
  }
  if (cursor.startsWith('after:')) {
    return { kind: 'after', page: 1, offset: 0, afterUrl: cursor.slice(6) };
  }
  return { kind: 'after', page: 1, offset: 0, afterUrl: cursor };
}

export function sliceSitemapFromCursor<T extends { url: string }>(
  items: T[],
  cursor: string | null | undefined,
  pageSize = SITEMAP_CURSOR_PAGE_SIZE,
): {
  items: T[];
  skipped: number;
  resumedFrom: string | null;
  startedPage: number;
  nextCursor: string | null;
  pageExhausted: boolean;
} {
  const parsed = parseSitemapCursor(cursor, pageSize);
  let start = parsed.offset;
  if (parsed.kind === 'after' && parsed.afterUrl) {
    const idx = items.findIndex((it) => it.url === parsed.afterUrl);
    start = idx >= 0 ? idx + 1 : 0;
  }
  const rest = items.slice(start);
  const page = rest.slice(0, pageSize);
  const last = page[page.length - 1];
  const consumed = start + page.length;
  const pageExhausted = consumed >= items.length;
  const nextCursor = pageExhausted
    ? null
    : last
      ? encodeSitemapAfterCursor(last.url)
      : encodeSitemapPageCursor(parsed.page + 1);
  return {
    items: page,
    skipped: start,
    resumedFrom: parsed.kind === 'none' ? null : cursor ?? null,
    startedPage: parsed.page,
    nextCursor,
    pageExhausted,
  };
}

export function nextUnusedSurface(used: string[], available: string[]): string | null {
  const usedSet = new Set(used.filter((s) => s && s !== 'NO_DISCOVERY_SURFACE'));
  for (const surface of ['sitemap', 'rss', 'listing']) {
    if (available.includes(surface) && !usedSet.has(surface)) return surface;
  }
  return null;
}
