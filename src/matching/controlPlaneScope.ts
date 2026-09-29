/**
 * Scope de menciones V1 derivado del Control Plane LIVE.
 *
 * Participación:
 * - detection: cliente.activo + keyword.activa + cliente_id del Panel
 * - title-only: lo anterior AND tipo exacta|frase_exacta
 * - export: clientes activos (override --clients si se pasa)
 * - alerting: fuera de esta fase
 *
 * No hay segundo registro de clientes. No hay IDs hardcodeados.
 */
import { TITLE_ONLY_TIPOS } from './titleOnlyLane.js';
import type { TipoKeyword } from '../matchers/keyword.js';

export interface ScopeCliente {
  cliente_id: string;
  activo: boolean;
}

export interface ScopeKeyword {
  keyword_id: string;
  cliente_id: string | null;
  keyword: string;
  tipo_keyword: string;
  activa?: boolean;
}

export interface MentionScope {
  detection_client_ids: string[];
  detection_keywords: ScopeKeyword[];
  title_only_keywords: ScopeKeyword[];
  export_client_ids: string[];
  skipped_inactive_clients: string[];
  skipped_inactive_keywords: number;
  skipped_orphan_keywords: number;
}

export function activeClientIds(clientes: readonly ScopeCliente[]): string[] {
  return clientes
    .filter((c) => c.activo && c.cliente_id.trim() !== '')
    .map((c) => c.cliente_id)
    .sort();
}

function keywordActiva(k: ScopeKeyword): boolean {
  return k.activa !== false;
}

export function buildMentionScope(input: {
  clientes: readonly ScopeCliente[];
  keywords: readonly ScopeKeyword[];
  clientFilter?: readonly string[] | null;
}): MentionScope {
  const allActive = activeClientIds(input.clientes);
  const skipped_inactive_clients = input.clientes
    .filter((c) => !c.activo)
    .map((c) => c.cliente_id)
    .sort();
  const filter = (input.clientFilter ?? []).map((s) => s.trim()).filter(Boolean);
  const detection_client_ids =
    filter.length > 0 ? allActive.filter((id) => filter.includes(id)) : allActive;
  const allowed = new Set(detection_client_ids);

  let skipped_inactive_keywords = 0;
  let skipped_orphan_keywords = 0;
  const detection_keywords: ScopeKeyword[] = [];
  for (const k of input.keywords) {
    if (!keywordActiva(k)) {
      skipped_inactive_keywords += 1;
      continue;
    }
    if (!k.cliente_id || !allowed.has(k.cliente_id)) {
      skipped_orphan_keywords += 1;
      continue;
    }
    detection_keywords.push(k);
  }

  const title_only_keywords = detection_keywords.filter((k) =>
    (TITLE_ONLY_TIPOS as readonly string[]).includes(k.tipo_keyword),
  );

  return {
    detection_client_ids,
    detection_keywords,
    title_only_keywords,
    export_client_ids: detection_client_ids,
    skipped_inactive_clients,
    skipped_inactive_keywords,
    skipped_orphan_keywords,
  };
}

/** --clients override gana; --from-control-plane usa activos; si no, null = legado (sin filtro). */
export function resolveExportClients(opts: {
  overrideClients: string[] | null;
  fromControlPlane: boolean;
  controlPlaneClientIds: string[];
}): string[] | null {
  if (opts.overrideClients && opts.overrideClients.length > 0) return opts.overrideClients;
  if (opts.fromControlPlane) return opts.controlPlaneClientIds;
  return null;
}

export function isTitleOnlyTipo(tipo: string): tipo is TipoKeyword {
  return (TITLE_ONLY_TIPOS as readonly string[]).includes(tipo);
}
