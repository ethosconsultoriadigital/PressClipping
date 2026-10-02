import { hostnameOfArticleUrl } from '../extractors/transient403Retry.js';
import type { PublisherIdentity } from './publisherIdentity.js';
import { classifyPublisherIdentity } from './publisherIdentity.js';

export interface FuenteCanalRow {
  fuente_id: string;
  canonical_url?: string | null;
  canonical_domain?: string | null;
  hostname?: string | null;
  platform?: string | null;
  activo?: boolean | null;
}

export interface SourceRegistryLoad {
  SOURCE_REGISTRY_READY: boolean;
  SOURCE_REGISTRY_FALLBACK: boolean;
  REGISTRY_CHANNELS_READ: number;
  REGISTRY_IDENTITY_MATCHES: number;
  error: string | null;
  channels: FuenteCanalRow[];
}

export function parseFuenteCanales(rows: unknown): FuenteCanalRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const x = r as Record<string, unknown>;
    return {
      fuente_id: String(x.fuente_id ?? x.fuenteId ?? ''),
      canonical_url: (x.canonical_url as string | null) ?? null,
      canonical_domain: (x.canonical_domain as string | null) ?? null,
      hostname: (x.hostname as string | null) ?? null,
      platform: (x.platform as string | null) ?? null,
      activo: typeof x.activo === 'boolean' ? x.activo : null,
    };
  }).filter((r) => r.fuente_id);
}

export function webChannels(channels: FuenteCanalRow[]): FuenteCanalRow[] {
  const web = channels.filter((c) => {
    if (c.activo === false) return false;
    const p = String(c.platform ?? 'WEB').toUpperCase();
    return p === 'WEB' || p === '' || p === 'HTTP' || p === 'HTTPS';
  });
  return web.length > 0 ? web : channels.filter((c) => c.activo !== false);
}

export function channelsToIdentityInput(channels: FuenteCanalRow[]): Array<{
  fuente_id: string;
  url_base?: string | null;
  hostname?: string | null;
}> {
  return webChannels(channels).map((c) => ({
    fuente_id: c.fuente_id,
    url_base: c.canonical_url ?? (c.canonical_domain ? `https://${c.canonical_domain}` : null),
    hostname: (c.hostname ?? c.canonical_domain ?? hostnameOfArticleUrl(c.canonical_url ?? '')).replace(/^www\./, ''),
  }));
}

export function classifyWithRegistry(
  publisherUrl: string | null,
  medios: Array<{ medio_id: string; url_base: string | null }>,
  registry: SourceRegistryLoad,
): PublisherIdentity & { registry_used: boolean } {
  const ident = classifyPublisherIdentity(
    publisherUrl,
    medios,
    registry.SOURCE_REGISTRY_READY ? channelsToIdentityInput(registry.channels) : [],
  );
  return { ...ident, registry_used: registry.SOURCE_REGISTRY_READY };
}

export function registryLoadFromQueryResult(opts: {
  error: string | null;
  rows: unknown;
}): SourceRegistryLoad {
  if (opts.error) {
    return {
      SOURCE_REGISTRY_READY: false,
      SOURCE_REGISTRY_FALLBACK: true,
      REGISTRY_CHANNELS_READ: 0,
      REGISTRY_IDENTITY_MATCHES: 0,
      error: opts.error,
      channels: [],
    };
  }
  const channels = parseFuenteCanales(opts.rows);
  return {
    SOURCE_REGISTRY_READY: true,
    SOURCE_REGISTRY_FALLBACK: false,
    REGISTRY_CHANNELS_READ: channels.length,
    REGISTRY_IDENTITY_MATCHES: 0,
    error: null,
    channels,
  };
}
