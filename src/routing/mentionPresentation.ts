/**
 * Routing de PRESENTACIÓN de menciones.
 *
 * Detection (Agente B) ya decidió el match. Aquí solo se proyectan
 * keyword_ids_matched → vistas (CLIENTE / PERSONA / TEMA / INTERNO).
 * No reanaliza título ni cuerpo.
 */
import { createHash } from 'node:crypto';
import { isRecognizedBoolCell, parseBool } from '../utils/parse.js';

export const ROUTING_TAB = '08_Ruteo_Menciones';
export const PENDING_TAB = '09_Ruteo_Pendiente';
export const ROUTING_HEADERS = [
  'route_id',
  'keyword_id',
  'detection_scope_id',
  'vista_tipo',
  'vista_nombre',
  'activo',
  'prioridad',
  'notas',
] as const;

export const VISTA_TIPOS = ['CLIENTE', 'PERSONA', 'TEMA', 'INTERNO'] as const;
export type VistaTipo = (typeof VISTA_TIPOS)[number];

export const VIEW_NOTE = 'VISTA DERIVADA — NO EDITAR COMO FUENTE DE VERDAD.';

export interface MentionRoute {
  route_id: string;
  keyword_id: string;
  detection_scope_id: string;
  vista_tipo: VistaTipo;
  vista_nombre: string;
  activo: boolean;
  prioridad: string;
  notas: string | null;
}

export interface RouteValidationIssue {
  code: string;
  detail: string;
}

export interface RouteValidation {
  ok: boolean;
  issues: RouteValidationIssue[];
  duplicate_route_ids: string[];
  duplicate_route_keys: string[];
  invalid_vista_tipo: string[];
  blank_vista_nombre: string[];
  invalid_keyword_id: string[];
  invalid_activo: string[];
}

export interface MasterMentionRow {
  values: Record<string, string>;
  sheetRow?: number;
}

export interface RoutedViewRow {
  view_name: string;
  vista_tipo: VistaTipo;
  vista_nombre: string;
  dedupe_key: string;
  source: MasterMentionRow;
}

export interface RoutePlan {
  routed: RoutedViewRow[];
  unrouted: Array<{
    source: MasterMentionRow;
    keyword_ids: string[];
    reason: string;
  }>;
  duplicate_suppressed: number;
  multi_view_master_keys: string[];
  rows_per_view: Record<string, number>;
}

export function viewTabName(tipo: VistaTipo, nombre: string): string {
  return `${tipo} · ${nombre}`;
}

export function parseKeywordIdsMatched(
  keywordIdsMatched: unknown,
  fallbackKeywordId: unknown = '',
): string[] {
  const raw = String(keywordIdsMatched ?? '').trim();
  const parts = raw
    .split(/[|,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const key = p.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  if (out.length > 0) return out;
  const fb = String(fallbackKeywordId ?? '').trim();
  return fb ? [fb] : [];
}

export function masterDedupeKey(row: Record<string, string>): string {
  const explicit = String(row.dedupe_key ?? '').trim();
  if (explicit) return explicit;
  const cliente = String(row.cliente_id ?? '').trim();
  const noticia = String(row.NOTICIA ?? row.noticia ?? '').trim();
  if (cliente && noticia) return `${cliente}//${noticia}`;
  if (noticia) return noticia;
  return '';
}

function isVistaTipo(v: string): v is VistaTipo {
  return (VISTA_TIPOS as readonly string[]).includes(v);
}

export function parseRouteRow(raw: Record<string, unknown>, index = 0): MentionRoute | RouteValidationIssue {
  const route_id = String(raw.route_id ?? '').trim();
  const keyword_id = String(raw.keyword_id ?? '').trim();
  const detection_scope_id = String(raw.detection_scope_id ?? '').trim();
  const vista_tipo = String(raw.vista_tipo ?? '').trim().toUpperCase();
  const vista_nombre = String(raw.vista_nombre ?? '').trim();
  const prioridad = String(raw.prioridad ?? '').trim();
  const notasRaw = raw.notas;
  const notas =
    notasRaw == null || String(notasRaw).trim() === '' ? null : String(notasRaw).trim();
  if (!route_id) return { code: 'BLANK_ROUTE_ID', detail: `row ${index}` };
  if (!keyword_id) return { code: 'INVALID_KEYWORD_ID', detail: route_id };
  if (!isVistaTipo(vista_tipo)) return { code: 'INVALID_VISTA_TIPO', detail: `${route_id}:${vista_tipo}` };
  if (!vista_nombre) return { code: 'BLANK_VISTA_NOMBRE', detail: route_id };
  if (!isRecognizedBoolCell(raw.activo)) return { code: 'INVALID_ACTIVO', detail: route_id };
  return {
    route_id,
    keyword_id,
    detection_scope_id,
    vista_tipo,
    vista_nombre,
    activo: parseBool(raw.activo, true),
    prioridad,
    notas,
  };
}

export function routeIdentityKey(r: Pick<MentionRoute, 'keyword_id' | 'vista_tipo' | 'vista_nombre'>): string {
  return `${r.keyword_id.toUpperCase()}|${r.vista_tipo}|${r.vista_nombre.normalize('NFC')}`;
}

export function validateMentionRoutes(routes: MentionRoute[]): RouteValidation {
  const issues: RouteValidationIssue[] = [];
  const idCounts = new Map<string, number>();
  const keyCounts = new Map<string, number>();
  const duplicate_route_ids: string[] = [];
  const duplicate_route_keys: string[] = [];
  const invalid_vista_tipo: string[] = [];
  const blank_vista_nombre: string[] = [];
  const invalid_keyword_id: string[] = [];
  const invalid_activo: string[] = [];

  for (const r of routes) {
    idCounts.set(r.route_id, (idCounts.get(r.route_id) ?? 0) + 1);
    const k = routeIdentityKey(r);
    keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
    if (!r.keyword_id) invalid_keyword_id.push(r.route_id);
    if (!r.vista_nombre) blank_vista_nombre.push(r.route_id);
    if (!isVistaTipo(r.vista_tipo)) invalid_vista_tipo.push(r.route_id);
  }
  for (const [id, n] of idCounts) {
    if (n > 1) {
      duplicate_route_ids.push(id);
      issues.push({ code: 'DUPLICATE_ROUTE_ID', detail: id });
    }
  }
  for (const [k, n] of keyCounts) {
    if (n > 1) {
      duplicate_route_keys.push(k);
      issues.push({ code: 'DUPLICATE_ROUTE_KEY', detail: k });
    }
  }
  for (const id of invalid_keyword_id) issues.push({ code: 'INVALID_KEYWORD_ID', detail: id });
  for (const id of blank_vista_nombre) issues.push({ code: 'BLANK_VISTA_NOMBRE', detail: id });
  for (const id of invalid_vista_tipo) issues.push({ code: 'INVALID_VISTA_TIPO', detail: id });

  return {
    ok: issues.length === 0,
    issues,
    duplicate_route_ids: duplicate_route_ids.sort(),
    duplicate_route_keys: duplicate_route_keys.sort(),
    invalid_vista_tipo,
    blank_vista_nombre,
    invalid_keyword_id,
    invalid_activo,
  };
}

export function computeRoutingHash(routes: MentionRoute[]): string {
  const payload = [...routes]
    .sort((a, b) => a.route_id.localeCompare(b.route_id))
    .map((r) => ({
      route_id: r.route_id,
      keyword_id: r.keyword_id,
      detection_scope_id: r.detection_scope_id,
      vista_tipo: r.vista_tipo,
      vista_nombre: r.vista_nombre,
      activo: r.activo,
      prioridad: r.prioridad,
      notas: r.notas ?? '',
    }));
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export type RouterRequestedMode = 'incremental' | 'full';
export type RouterRunMode = 'full' | 'incremental' | 'resume_full';

export interface RouterRunDecision {
  mode: RouterRunMode;
  needFull: boolean;
  reason: string | null;
}

/**
 * LAST_PROCESSED_MASTER_ROW y masterLastRow son filas absolutas de Sheet
 * (1 = header). Nunca comparar data-row-count (lastRow-1) con lastProcessed.
 *
 * Rebuild en progreso: si el hash cambia o MASTER retrocede vs snapshot, se
 * reinicia. Si MASTER crece, se termina el snapshot y el incremental posterior
 * cubre las filas nuevas (LAST_PROCESSED queda en el snapshot, no en lastRow actual).
 */
export function decideRouterRun(input: {
  requestedMode: RouterRequestedMode;
  routingHashNow: string;
  routingHashApplied: string | null;
  masterLastRow: number;
  lastProcessedMasterRow: number;
  fullRebuildInProgress: boolean;
  fullRebuildTargetHash: string | null;
  fullRebuildMasterLastRow: number | null;
}): RouterRunDecision {
  const lastProcessed = Number.isFinite(input.lastProcessedMasterRow)
    ? input.lastProcessedMasterRow
    : 1;
  if (input.fullRebuildInProgress) {
    if (input.fullRebuildTargetHash && input.fullRebuildTargetHash !== input.routingHashNow) {
      return { mode: 'full', needFull: true, reason: 'HASH_CHANGED_DURING_REBUILD' };
    }
    const snap = input.fullRebuildMasterLastRow ?? 0;
    if (snap > 0 && input.masterLastRow < snap) {
      return { mode: 'full', needFull: true, reason: 'MASTER_SHRANK_DURING_REBUILD' };
    }
    return { mode: 'resume_full', needFull: true, reason: 'RESUME_FULL_REBUILD' };
  }
  if (input.requestedMode === 'full') {
    return { mode: 'full', needFull: true, reason: 'REQUESTED_FULL' };
  }
  if (!input.routingHashApplied) {
    return { mode: 'full', needFull: true, reason: 'FIRST_RUN' };
  }
  if (input.routingHashApplied !== input.routingHashNow) {
    return { mode: 'full', needFull: true, reason: 'ROUTING_HASH_CHANGED' };
  }
  if (input.masterLastRow < lastProcessed) {
    return { mode: 'full', needFull: true, reason: 'MASTER_SHRANK' };
  }
  if (lastProcessed <= 1) {
    return { mode: 'full', needFull: true, reason: 'FIRST_RUN' };
  }
  return { mode: 'incremental', needFull: false, reason: null };
}

export function shouldFullRebuild(opts: {
  routingHashNow: string;
  routingHashPrev: string | null;
  /** Fila absoluta de Sheet (header=1). */
  masterLastRow: number;
  /** Última fila absoluta de MASTER ya procesada. */
  lastProcessedMasterRow: number;
}): boolean {
  return decideRouterRun({
    requestedMode: 'incremental',
    routingHashNow: opts.routingHashNow,
    routingHashApplied: opts.routingHashPrev,
    masterLastRow: opts.masterLastRow,
    lastProcessedMasterRow: opts.lastProcessedMasterRow,
    fullRebuildInProgress: false,
    fullRebuildTargetHash: null,
    fullRebuildMasterLastRow: null,
  }).needFull;
}

export function incrementalStartRow(
  lastProcessedMasterRow: number,
  overlap = 150,
): number {
  if (lastProcessedMasterRow <= 1) return 2;
  return Math.max(2, lastProcessedMasterRow - overlap + 1);
}

export function routeMasterRows(
  rows: MasterMentionRow[],
  routes: MentionRoute[],
  opts: { includeInternal?: boolean } = {},
): RoutePlan {
  const includeInternal = opts.includeInternal === true;
  const byKw = new Map<string, MentionRoute[]>();
  const skippedInternal = new Set<string>();
  for (const r of routes) {
    if (!r.activo) continue;
    if (!includeInternal && r.vista_tipo === 'INTERNO') {
      skippedInternal.add(r.keyword_id.toUpperCase());
      continue;
    }
    const k = r.keyword_id.toUpperCase();
    const list = byKw.get(k) ?? [];
    list.push(r);
    byKw.set(k, list);
  }

  const routed: RoutedViewRow[] = [];
  const unrouted: RoutePlan['unrouted'] = [];
  let duplicate_suppressed = 0;
  const seen = new Set<string>();
  const viewsByMaster = new Map<string, Set<string>>();

  for (const source of rows) {
    const ids = parseKeywordIdsMatched(
      source.values.keyword_ids_matched,
      source.values.keyword_id,
    );
    const dests: MentionRoute[] = [];
    const destKeys = new Set<string>();
    for (const id of ids) {
      const matches = byKw.get(id.toUpperCase()) ?? [];
      for (const r of matches) {
        const dk = routeIdentityKey(r);
        if (destKeys.has(dk)) continue;
        destKeys.add(dk);
        dests.push(r);
      }
    }
    const masterKey = masterDedupeKey(source.values) || `row:${source.sheetRow ?? routed.length}`;
    if (dests.length === 0) {
      const excluded = ids.some((id) => skippedInternal.has(id.toUpperCase()));
      unrouted.push({
        source,
        keyword_ids: ids,
        reason: excluded
          ? 'EXCLUDED_INTERNAL'
          : ids.length === 0
            ? 'NO_KEYWORD_ID'
            : 'UNKNOWN_KEYWORD_ROUTE',
      });
      continue;
    }
    const viewSet = viewsByMaster.get(masterKey) ?? new Set<string>();
    for (const r of dests) {
      const view_name = viewTabName(r.vista_tipo, r.vista_nombre);
      const dedupe_key = masterKey;
      const uniq = `${r.vista_tipo}|${r.vista_nombre}|${dedupe_key}`;
      if (seen.has(uniq)) {
        duplicate_suppressed += 1;
        continue;
      }
      seen.add(uniq);
      viewSet.add(view_name);
      routed.push({
        view_name,
        vista_tipo: r.vista_tipo,
        vista_nombre: r.vista_nombre,
        dedupe_key,
        source,
      });
    }
    viewsByMaster.set(masterKey, viewSet);
  }

  const rows_per_view: Record<string, number> = {};
  for (const r of routed) {
    rows_per_view[r.view_name] = (rows_per_view[r.view_name] ?? 0) + 1;
  }
  const multi_view_master_keys = [...viewsByMaster.entries()]
    .filter(([, s]) => s.size > 1)
    .map(([k]) => k);

  return {
    routed,
    unrouted,
    duplicate_suppressed,
    multi_view_master_keys,
    rows_per_view,
  };
}

export function routedActiveKeywords(
  routes: MentionRoute[],
  activeKeywordIds: string[],
  opts: { includeInternal?: boolean } = {},
): {
  routed: string[];
  without_route: string[];
} {
  const includeInternal = opts.includeInternal === true;
  const covered = new Set(
    routes
      .filter((r) => r.activo && (includeInternal || r.vista_tipo !== 'INTERNO'))
      .map((r) => r.keyword_id.toUpperCase()),
  );
  const routed: string[] = [];
  const without_route: string[] = [];
  for (const id of activeKeywordIds) {
    const up = id.toUpperCase();
    if (covered.has(up)) routed.push(id);
    else without_route.push(id);
  }
  return { routed, without_route };
}

export const VISIBLE_COLUMNS_FIRST = [
  'fecha_publicacion',
  'fecha_captura',
  'medio',
  'titulo / titular',
  'resumen',
  'url',
  'sentimiento',
  'tema',
  'subtema',
  'palabra',
  'keywords_matched',
  'tipo_mencion',
  'campo_match',
  'score_relevancia',
  'Valoracion del M',
  'AUTOR',
] as const;

export const VISIBLE_COLUMNS_REST = [
  'NOTICIA',
  'cliente_id',
  'medio_id',
  'keyword_id',
  'keyword_ids_matched',
  'match_count',
  'seccion',
  'relevancia_ia',
  'tipo_nota',
  'calidad_extraccion',
  'requiere_alerta',
  'estado_revision',
  'matched_at',
  'dedupe_key',
  'latencia_minutos',
  'estanteria',
  'horaPublicacion',
  'HoraCaptura',
  'nota completa',
] as const;

export function orderViewHeaders(masterHeaders: string[]): string[] {
  const byNorm = new Map(masterHeaders.map((h) => [h.trim().toLowerCase(), h]));
  const used = new Set<string>();
  const out: string[] = [];
  for (const want of [...VISIBLE_COLUMNS_FIRST, ...VISIBLE_COLUMNS_REST]) {
    const hit = byNorm.get(want.toLowerCase());
    if (hit && !used.has(hit)) {
      out.push(hit);
      used.add(hit);
    }
  }
  for (const h of masterHeaders) {
    if (!used.has(h)) out.push(h);
  }
  return out;
}

export function sortKeyForView(row: Record<string, string>): string {
  const a = String(row.fecha_publicacion ?? '').trim();
  const b = String(row.fecha_captura ?? '').trim();
  const c = String(row.matched_at ?? '').trim();
  return `${a}\t${b}\t${c}`;
}

export function compareViewRowsDesc(a: Record<string, string>, b: Record<string, string>): number {
  const ka = sortKeyForView(a);
  const kb = sortKeyForView(b);
  return kb.localeCompare(ka);
}

export function parseRoutesCsv(text: string): MentionRoute[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return [];
  const headerLine = lines[0];
  if (!headerLine) return [];
  const headers = splitCsvLine(headerLine).map((h) => h.trim());
  const routes: MentionRoute[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = splitCsvLine(line);
    const raw: Record<string, string> = {};
    headers.forEach((h, idx) => {
      raw[h] = cols[idx] ?? '';
    });
    const parsed = parseRouteRow(raw, i + 1);
    if ('code' in parsed) {
      throw new Error(`${parsed.code}: ${parsed.detail}`);
    }
    routes.push(parsed);
  }
  return routes;
}

function splitCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          q = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      q = true;
      continue;
    }
    if (ch === ',') {
      cols.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}
