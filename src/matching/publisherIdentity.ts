import { hostnameOfArticleUrl } from '../extractors/transient403Retry.js';

export type PublisherIdentityKind = 'KNOWN_UNIQUE' | 'KNOWN_AMBIGUOUS' | 'UNKNOWN';

export interface PublisherIdentity {
  kind: PublisherIdentityKind;
  hostname: string | null;
  candidate_medio_ids: string[];
  candidate_fuente_ids: string[];
  medio_id: string | null;
}

function hostMatches(hostname: string, baseUrl: string | null | undefined): boolean {
  const base = hostnameOfArticleUrl(baseUrl ?? '');
  if (!base) return false;
  return hostname === base || hostname.endsWith(`.${base}`);
}

export function classifyPublisherIdentity(
  publisherUrl: string | null,
  medios: Array<{ medio_id: string; nombre_medio?: string; url_base: string | null }>,
  fuentes: Array<{ fuente_id: string; url_base?: string | null; hostname?: string | null }> = [],
): PublisherIdentity {
  if (!publisherUrl) {
    return { kind: 'UNKNOWN', hostname: null, candidate_medio_ids: [], candidate_fuente_ids: [], medio_id: null };
  }
  const hostname = hostnameOfArticleUrl(publisherUrl);
  if (!hostname) {
    return { kind: 'UNKNOWN', hostname: null, candidate_medio_ids: [], candidate_fuente_ids: [], medio_id: null };
  }
  const fuenteIds = [...new Set(fuentes
    .filter((f) => {
      if (f.hostname && (hostname === f.hostname.replace(/^www\./, '') || hostname.endsWith(`.${f.hostname.replace(/^www\./, '')}`))) {
        return true;
      }
      return hostMatches(hostname, f.url_base);
    })
    .map((f) => f.fuente_id))];
  const medioIds = [...new Set(medios.filter((m) => hostMatches(hostname, m.url_base)).map((m) => m.medio_id))];
  if (fuenteIds.length === 1 && medioIds.length <= 1) {
    return {
      kind: 'KNOWN_UNIQUE',
      hostname,
      candidate_medio_ids: medioIds,
      candidate_fuente_ids: fuenteIds,
      medio_id: medioIds[0] ?? null,
    };
  }
  if (fuenteIds.length > 1 || medioIds.length > 1) {
    return {
      kind: 'KNOWN_AMBIGUOUS',
      hostname,
      candidate_medio_ids: medioIds,
      candidate_fuente_ids: fuenteIds,
      medio_id: null,
    };
  }
  if (medioIds.length === 1) {
    return {
      kind: 'KNOWN_UNIQUE',
      hostname,
      candidate_medio_ids: medioIds,
      candidate_fuente_ids: [],
      medio_id: medioIds[0]!,
    };
  }
  return { kind: 'UNKNOWN', hostname, candidate_medio_ids: [], candidate_fuente_ids: [], medio_id: null };
}

export function aggregatePublisherArticles<T extends { publisher_final_url: string | null }>(
  items: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const it of items) {
    const key = (it.publisher_final_url ?? '').trim().toLowerCase();
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(it);
    map.set(key, list);
  }
  return map;
}
