import type { ContentOrigin, SourceKind } from './types.js';
import { foldName, hostnameOf, platformFromUrl } from './identity.js';

const PETITION_HOSTS = /change\.org|citizengo\.org|avaaz\.org/i;
const NGO_NAMES =
  /el poder del consumidor|alianza por la salud alimentaria|fundar|greenpeace|mexicanos contra la corrupcion/i;
const INSTITUTIONAL =
  /\.gob\.mx$|secretaria |instituto nacional |congreso |presidencia |ayuntamiento /i;
const REPUBLISHER = /google news|news\.google|msn\.com|yahoo news|flipboard/i;
const BLOG = /\bblog\b|medium\.com|substack\.com|wordpress\.com/i;

export function classifySourceKind(input: {
  name: string;
  url?: string | null;
  hint?: string | null;
}): { source_kind: SourceKind; content_origin: ContentOrigin } {
  const hint = foldName(input.hint ?? '');
  const name = foldName(input.name);
  const host = hostnameOf(input.url) ?? '';
  const platform = platformFromUrl(input.url);

  if (hint.includes('petition') || PETITION_HOSTS.test(host) || PETITION_HOSTS.test(name)) {
    return { source_kind: 'PETITION_PLATFORM', content_origin: 'UGC_ADVOCACY' };
  }
  if (hint.includes('ngo') || NGO_NAMES.test(name)) {
    return { source_kind: 'NGO', content_origin: 'INSTITUTIONAL' };
  }
  if (hint.includes('institutional') || INSTITUTIONAL.test(host) || INSTITUTIONAL.test(name)) {
    return { source_kind: 'INSTITUTIONAL', content_origin: 'INSTITUTIONAL' };
  }
  if (platform !== 'WEB' && platform !== 'PETITION' && platform !== 'OTHER') {
    return { source_kind: 'SOCIAL_COMMUNITY', content_origin: 'SOCIAL' };
  }
  if (REPUBLISHER.test(host) || REPUBLISHER.test(name) || hint.includes('republish')) {
    return { source_kind: 'REPUBLISHER', content_origin: 'MIXED' };
  }
  if (BLOG.test(host) || BLOG.test(name) || hint.includes('blog')) {
    return { source_kind: 'BLOG', content_origin: 'EDITORIAL' };
  }
  if (hint.includes('edition') || hint.includes('regional')) {
    return { source_kind: 'REGIONAL_EDITION', content_origin: 'EDITORIAL' };
  }
  return { source_kind: 'NEWS_MEDIA', content_origin: 'EDITORIAL' };
}

/** Familias editoriales que NO se colapsan; se agrupan con parent. */
export function editorialGroupKey(name: string, host: string | null): string | null {
  const n = foldName(name);
  const h = (host ?? '').toLowerCase();
  if (/quadrat/.test(n) || /quadratin/.test(h)) return 'quadratin';
  if (/el sol de /.test(n) || /oem\.com\.mx/.test(h)) return 'oem-el-sol';
  if (/milenio/.test(n) && /milenio\.com/.test(h || 'milenio.com')) return 'milenio';
  if (/la jornada/.test(n)) return 'la-jornada';
  if (/uniradio/.test(n) || /uniradio/.test(h)) return 'uniradio';
  if (/e consulta|e-consulta/.test(n) || /e-consulta/.test(h)) return 'e-consulta';
  return null;
}

export const ALIAS_CLUSTERS_PENDING: { cluster: string; members: string[] }[] = [
  {
    cluster: 'noticias-cdmx-alcaldias',
    members: ['iztapalapa noticias', 'noticias coyoacan', 'noticias de mexico'],
  },
  {
    cluster: 'trafico-zmg',
    members: ['guardia nocturna', 'trafico zmg'],
  },
];

export function pendingAliasCluster(name: string): string | null {
  const n = foldName(name);
  for (const c of ALIAS_CLUSTERS_PENDING) {
    if (c.members.some((m) => n.includes(m) || m.includes(n))) return c.cluster;
  }
  return null;
}
