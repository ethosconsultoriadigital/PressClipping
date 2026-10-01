export interface BodyMatchingCounters {
  body_available: number;
  body_trusted: number;
  body_fallback_clean: number;
  body_rejected: number;
  no_body: number;
  signal_matches: number;
  body_matches: number;
  body_only_matches: number;
  multi_field_matches: number;
  raw_text_rejected: number;
  dedupe_suppressed: number;
  rows_appended: number;
}

export function emptyBodyMatchingCounters(): BodyMatchingCounters {
  return {
    body_available: 0,
    body_trusted: 0,
    body_fallback_clean: 0,
    body_rejected: 0,
    no_body: 0,
    signal_matches: 0,
    body_matches: 0,
    body_only_matches: 0,
    multi_field_matches: 0,
    raw_text_rejected: 0,
    dedupe_suppressed: 0,
    rows_appended: 0,
  };
}

export function bump(map: Record<string, number>, key: string, n = 1): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + n;
}
