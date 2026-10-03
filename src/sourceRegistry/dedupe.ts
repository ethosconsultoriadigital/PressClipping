import { foldName, hostnameOf, registrableDomain, uniquenessKey } from './identity.js';
import { editorialGroupKey } from './classifyKind.js';
import type { Platform } from './types.js';

export type DedupeDecision =
  | { action: 'NEW'; uniqueness_key: string; group_key: string | null }
  | { action: 'ALIAS_OF'; uniqueness_key: string; of_key: string; reason: string }
  | { action: 'REGIONAL_EDITION'; uniqueness_key: string; group_key: string; reason: string };

export interface DedupeSubject {
  name: string;
  url: string | null;
  platform: Platform;
  estado: string | null;
  existing?: { uniqueness_key: string; name: string; hostname: string | null; estado: string | null }[];
}

/**
 * Dedup determinista. Ediciones regionales del mismo grupo NO se colapsan.
 */
export function decideDedupe(s: DedupeSubject): DedupeDecision {
  const host = hostnameOf(s.url);
  const domain = registrableDomain(host);
  const group = editorialGroupKey(s.name, host);
  const pathHint = (() => {
    try {
      if (!s.url) return null;
      const p = new URL(/^https?:/i.test(s.url) ? s.url : `https://${s.url}`).pathname;
      const segs = p.split('/').filter(Boolean);
      return segs[0] ?? null;
    } catch {
      return null;
    }
  })();
  const key = uniquenessKey({
    hostname: host,
    platform: s.platform,
    canonicalName: s.name,
    estado: s.estado,
    pathHint: group ? pathHint : null,
  });

  for (const ex of s.existing ?? []) {
    if (ex.uniqueness_key === key) {
      return { action: 'ALIAS_OF', uniqueness_key: key, of_key: ex.uniqueness_key, reason: 'exact_uniqueness_key' };
    }
    const sameHost = host && ex.hostname && host === ex.hostname;
    const sameName = foldName(ex.name) === foldName(s.name);
    const sameEstado = foldName(ex.estado ?? '') === foldName(s.estado ?? '');
    if (sameHost && sameName && sameEstado) {
      return { action: 'ALIAS_OF', uniqueness_key: key, of_key: ex.uniqueness_key, reason: 'same_host_name_estado' };
    }
  }

  if (group) {
    const sibling = (s.existing ?? []).find((ex) => editorialGroupKey(ex.name, ex.hostname) === group);
    if (!sibling) {
      return { action: 'NEW', uniqueness_key: key, group_key: group };
    }
    return {
      action: 'REGIONAL_EDITION',
      uniqueness_key: key,
      group_key: group,
      reason: `keep_edition group=${group} domain=${domain ?? 'n/a'} sibling=${sibling.name}`,
    };
  }

  return { action: 'NEW', uniqueness_key: key, group_key: group };
}
