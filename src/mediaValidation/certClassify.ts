/**
 * Clasificador A–E de certificación operativa (puro).
 *
 * Umbrales de calidad NO se bajan. Cambia quién entra al denominador
 * (artículos elegibles) y qué TRANSIENT cuenta como defecto editorial.
 */
import { LATENCY_P95_THRESHOLD_H } from './certLatency.js';
import { transientAffectsArticleClass, type SourceHealthClass } from './certProbe.js';

export type CertClass = 'A' | 'B' | 'C' | 'D' | 'E';

export interface CertProbe {
  class: SourceHealthClass;
  status: number | null;
  error: string | null;
}

export interface ClassifyInput {
  n7: number;
  n30: number;
  urlOk: number | null;
  titleOk: number | null;
  pubOk: number | null;
  capOk: number | null;
  usable: number | null;
  body: number | null;
  homepage: number | null;
  listing: number | null;
  encoding: number | null;
  clone: number | null;
  boilerplate: number | null;
  shortPct: number | null;
  probe: CertProbe;
  production: SourceHealthClass;
  lastError: string | null;
  lastEstado: string | null;
  paywallNotes: boolean;
  latencyP95: number | null;
  sourceRecent: boolean | null;
  /** Inventario 30d existe pero 0 URLs pasan el filtro de artículo. */
  allInventoryNonArticle?: boolean;
}

export interface ClassifyResult {
  cls: CertClass;
  reason: string;
  primary: string | null;
  secondary: string | null;
  tech: string;
  repairable: boolean | null;
  prio: string | null;
}

export function classifyOperational(p: ClassifyInput): ClassifyResult {
  const last = `${p.lastError ?? ''} ${p.lastEstado ?? ''}`;
  const err403 = /403/.test(last) || p.probe.status === 403;
  const err404 = /404|410/.test(last) || p.probe.status === 404 || p.probe.status === 410;
  const timeout =
    /timeout/i.test(last) ||
    (p.probe.class === 'TRANSIENT' && /timeout/i.test(p.probe.error ?? ''));
  const persistentSource =
    p.probe.class === 'PERSISTENT' ||
    (err403 && p.probe.class !== 'HEALTHY' && p.production !== 'HEALTHY');

  if (p.paywallNotes && (err403 || p.probe.class === 'PAYWALL')) {
    return {
      cls: 'D',
      reason: 'paywall_or_convenio_required',
      primary: 'PAYWALL',
      secondary: null,
      tech: 'PAYWALL_NO_VIABLE',
      repairable: false,
      prio: null,
    };
  }

  if (p.allInventoryNonArticle && p.n7 === 0 && p.n30 === 0) {
    return {
      cls: 'B',
      reason: 'no_recent_eligible_article_inventory_is_non_article',
      primary: 'NO_RECENT_CONTENT',
      secondary: persistentSource ? (err403 ? 'SOURCE_403' : 'SOURCE_PARSE') : null,
      tech: 'EN_CRON_SIN_NOTICIAS',
      repairable: null,
      prio: 'P3',
    };
  }

  if (persistentSource && p.n7 === 0) {
    const primary = err404 ? 'SOURCE_PARSE' : err403 ? 'SOURCE_403' : timeout ? 'SOURCE_TIMEOUT' : 'SOURCE_PARSE';
    const nonviable = err404;
    return {
      cls: 'E',
      reason: `persistent_source_failure status=${p.probe.status} n7=0`,
      primary,
      secondary: 'NO_RECENT_CAPTURE',
      tech: nonviable ? 'BLOCKED' : 'NECESITA_REPARAR_FUENTE',
      repairable: !nonviable,
      prio: 'P1',
    };
  }

  if (p.n7 === 0 && p.n30 === 0) {
    if (p.probe.class === 'HEALTHY' && p.sourceRecent === false) {
      return {
        cls: 'A',
        reason: 'low_volume_healthy_source_ok_no_recent_pub',
        primary: 'LOW_VOLUME',
        secondary: null,
        tech: 'EN_CRON_SIN_NOTICIAS',
        repairable: null,
        prio: null,
      };
    }
    if (p.probe.class === 'HEALTHY' && p.sourceRecent === true) {
      return {
        cls: 'E',
        reason: 'source_has_recent_items_but_no_capture',
        primary: 'NO_RECENT_CAPTURE',
        secondary: null,
        tech: 'EN_CRON_SIN_NOTICIAS',
        repairable: true,
        prio: 'P1',
      };
    }
    return {
      cls: 'E',
      reason: 'no_capture_30d',
      primary: 'NO_RECENT_CONTENT',
      secondary: persistentSource ? 'SOURCE_403' : null,
      tech: 'EN_CRON_SIN_NOTICIAS',
      repairable: true,
      prio: 'P2',
    };
  }

  if (p.n7 === 0 && p.n30 > 0) {
    if (persistentSource) {
      return {
        cls: 'E',
        reason: 'persistent_source_failure_stale_capture',
        primary: err403 ? 'SOURCE_403' : 'SOURCE_TIMEOUT',
        secondary: 'NO_RECENT_CAPTURE',
        tech: 'NECESITA_REPARAR_FUENTE',
        repairable: true,
        prio: 'P1',
      };
    }
    return {
      cls: 'B',
      reason: 'no_recent_eligible_article_in_7d',
      primary: 'NO_RECENT_CONTENT',
      secondary: p.sourceRecent ? 'LATENCY' : null,
      tech: 'LISTO_LEYENDO',
      repairable: null,
      prio: 'P3',
    };
  }

  const urlOk = p.urlOk ?? 0;
  const titleOk = p.titleOk ?? 0;
  const pubOk = p.pubOk ?? 0;
  const capOk = p.capOk ?? 0;
  const usable = p.usable ?? 0;
  const body = p.body ?? 0;
  const home = p.homepage ?? 0;
  const list = p.listing ?? 0;
  const enc = p.encoding ?? 0;
  const clone = p.clone ?? 0;
  const boil = p.boilerplate ?? 0;
  const shortP = p.shortPct ?? 0;

  const datesOk = pubOk >= 0.9 && capOk >= 0.95;
  const metaOk = urlOk >= 0.98 && titleOk >= 0.98 && datesOk;
  const metaB = urlOk >= 0.9 && titleOk >= 0.9 && pubOk >= 0.85 && capOk >= 0.9;
  const structureBad = home >= 0.2 || list >= 0.25 || clone >= 0.25 || boil >= 0.3;
  const encodingMat = enc >= 0.08;
  const bodyEmptyIssue = body < 0.5 || (usable < 0.7 && shortP >= 0.4);

  if (persistentSource && p.n7 > 0 && usable >= 0.7) {
    return {
      cls: 'B',
      reason: 'capture_ok_but_source_error_recent',
      primary: err403 ? 'SOURCE_403' : 'SOURCE_TIMEOUT',
      secondary: null,
      tech: 'NECESITA_REPARAR_FUENTE',
      repairable: true,
      prio: 'P2',
    };
  }
  if (persistentSource && usable < 0.7) {
    return {
      cls: 'E',
      reason: 'persistent_source_and_weak_text',
      primary: err403 ? 'SOURCE_403' : 'SOURCE_TIMEOUT',
      secondary: 'BODY_EMPTY',
      tech: 'NECESITA_REPARAR_FUENTE',
      repairable: true,
      prio: 'P1',
    };
  }

  if (structureBad && usable < 0.7) {
    const primary = home >= 0.2 ? 'HOMEPAGE' : list >= 0.25 ? 'LISTING' : clone >= 0.25 ? 'CLONED_BODY' : 'BOILERPLATE';
    return {
      cls: 'C',
      reason: `structural_contamination ${primary}`,
      primary,
      secondary: usable < 0.5 ? 'BODY_EMPTY' : 'BODY_PARTIAL',
      tech: 'EN_CRON_TEXTO_MALO',
      repairable: true,
      prio: 'P1',
    };
  }

  if (usable < 0.7 || bodyEmptyIssue) {
    if (err403) {
      return {
        cls: 'C',
        reason: `blocked_external_fetch_403 usable=${usable.toFixed(3)} body=${body.toFixed(3)}`,
        primary: body < 0.5 ? 'BLOCKED_EXTERNAL' : 'BLOCKED_EXTERNAL_PARTIAL',
        secondary: body < 0.5 ? 'BODY_EMPTY' : 'BODY_PARTIAL',
        tech: 'EN_CRON_TEXTO_MALO',
        repairable: false,
        prio: null,
      };
    }
    return {
      cls: 'C',
      reason: `radar_partial usable=${usable.toFixed(3)} body=${body.toFixed(3)}`,
      primary: body < 0.4 ? 'BODY_EMPTY' : 'BODY_PARTIAL',
      secondary: encodingMat ? 'ENCODING' : list > 0.1 ? 'LISTING' : null,
      tech: 'EN_CRON_TEXTO_MALO',
      repairable: true,
      prio: p.n7 >= 20 ? 'P1' : 'P2',
    };
  }

  const minor: string[] = [];
  if (usable < 0.9) minor.push('BODY_PARTIAL');
  if (enc >= 0.02) minor.push('ENCODING');
  if (list >= 0.08) minor.push('LISTING');
  if (home >= 0.05) minor.push('HOMEPAGE');
  if (clone >= 0.08) minor.push('CLONED_BODY');
  if (boil >= 0.1) minor.push('BOILERPLATE');
  if ((p.latencyP95 ?? 0) > LATENCY_P95_THRESHOLD_H) minor.push('LATENCY');
  if (p.n7 < 3 && p.probe.class === 'HEALTHY') minor.push('LOW_VOLUME');
  if (transientAffectsArticleClass(p.probe.class, p.production)) minor.push('OTHER');
  if (body < 0.85) minor.push('BODY_PARTIAL');

  const aGate =
    metaOk &&
    usable >= 0.9 &&
    body >= 0.85 &&
    home < 0.1 &&
    list < 0.15 &&
    clone < 0.1 &&
    enc < 0.05 &&
    boil < 0.15 &&
    shortP < 0.25 &&
    p.probe.class !== 'PERSISTENT' &&
    !structureBad;

  if (aGate && minor.filter((x) => x !== 'LOW_VOLUME' && x !== 'LATENCY').length === 0) {
    const tech = p.n7 === 0 ? 'EN_CRON_SIN_NOTICIAS' : 'LISTO_LEYENDO';
    return {
      cls: 'A',
      reason: 'certified_operational_7d',
      primary: minor.includes('LOW_VOLUME') ? 'LOW_VOLUME' : null,
      secondary: minor.includes('LATENCY') ? 'LATENCY' : null,
      tech,
      repairable: null,
      prio: null,
    };
  }

  if (aGate && (p.latencyP95 ?? 0) > LATENCY_P95_THRESHOLD_H && usable >= 0.9) {
    return {
      cls: 'B',
      reason: 'operational_high_latency_p95',
      primary: 'LATENCY',
      secondary: null,
      tech: 'LISTO_LEYENDO',
      repairable: true,
      prio: 'P3',
    };
  }

  if (metaB && usable >= 0.7) {
    const primary = minor[0] ?? 'OTHER';
    return {
      cls: 'B',
      reason: `operational_minor_defect ${minor.join(',') || 'secondary_gaps'}`,
      primary,
      secondary: minor[1] ?? null,
      tech: body < 0.9 ? 'NECESITA_REENRICH_RECIENTE' : 'LISTO_LEYENDO',
      repairable: true,
      prio: p.n7 >= 30 && (usable < 0.85 || encodingMat) ? 'P2' : 'P3',
    };
  }

  if (p.n7 > 0 && metaB) {
    return {
      cls: 'C',
      reason: 'partial_capture_below_b_bar',
      primary: 'BODY_PARTIAL',
      secondary: minor[0] ?? null,
      tech: 'EN_CRON_TEXTO_MALO',
      repairable: true,
      prio: 'P2',
    };
  }

  return {
    cls: 'E',
    reason: 'fails_minimum_operational_bar',
    primary: 'OTHER',
    secondary: null,
    tech: 'OTHER',
    repairable: true,
    prio: 'P2',
  };
}
