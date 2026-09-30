/**
 * Control Plane Sync V2 — Google Sheets (03_Clientes + 02_Keywords) → Supabase.
 *
 * Identidad semántica (solo para conflicto de ID, no para UPDATE de campos):
 * - trim + colapso de whitespace + minúsculas + NFD sin diacríticos.
 * - Sin stem, fuzzy ni sinónimos.
 * - "tequila" ≡ "Tequila"; "tequila" ≢ "Tequila Patrón".
 * - Display `cliente` / acentos en industria no conflictúan si cliente_id y
 *   keyword_id conservan la identidad anterior.
 *
 * Ausente en Sheet ≠ delete en Supabase (DB_ONLY_PRESERVED).
 * Default: DRY_RUN. Apply exige --apply y --expected-hash.
 */
import { createHash } from 'node:crypto';
import { mapClienteRow, mapKeywordRowStrict, type Cliente, type Keyword } from '../types/schemas.js';
import type { RawRow } from '../sheets/read.js';
import { isRecognizedBoolCell } from '../utils/parse.js';

export const CONTROL_PLANE_ENTITIES = ['clientes', 'keywords'] as const;
export type ControlPlaneEntity = (typeof CONTROL_PLANE_ENTITIES)[number];

export const CLIENT_FIELDS = [
  'cliente_id',
  'nombre_cliente',
  'industria',
  'marcas',
  'competidores',
  'voceros',
  'temas_sensibles',
  'activo',
  'prioridad_ia',
  'alertas_activas',
  'notas',
] as const;

export const KEYWORD_FIELDS = [
  'keyword_id',
  'cliente_id',
  'cliente',
  'keyword',
  'alias_o_variantes',
  'tipo_keyword',
  'regla',
  'activa',
  'prioridad',
  'alerta',
  'contexto_incluir',
  'contexto_excluir',
  'notas',
] as const;

const CLIENT_DIFF_FIELDS = [
  'nombre_cliente',
  'industria',
  'marcas',
  'competidores',
  'voceros',
  'temas_sensibles',
  'activo',
  'prioridad_ia',
  'alertas_activas',
  'notas',
] as const;

const KEYWORD_DIFF_FIELDS = [
  'cliente_id',
  'cliente',
  'keyword',
  'alias_o_variantes',
  'tipo_keyword',
  'regla',
  'activa',
  'prioridad',
  'alerta',
  'contexto_incluir',
  'contexto_excluir',
  'notas',
] as const;

export type SyncMode = 'DRY_RUN' | 'APPLY';
export type RowDisposition =
  | 'CREATE'
  | 'UPDATE'
  | 'UNCHANGED'
  | 'DB_ONLY_PRESERVED'
  | 'SEMANTIC_ID_CONFLICT';

export interface ControlPlaneArgs {
  apply: boolean;
  auto?: boolean;
  expectedHash: string | null;
  entities: ControlPlaneEntity[];
}

export const AUTO_SYNC_MAX_WRITES = 25;

export type CanonicalSyncVerdict =
  | 'CONTROL_PLANE_SYNC_PASS'
  | 'CONTROL_PLANE_SYNC_NO_CHANGES'
  | 'CONTROL_PLANE_SYNC_ABORTED'
  | 'CONTROL_PLANE_SYNC_INFRA_ERROR';

export interface InvalidRow {
  tab: '03_Clientes' | '02_Keywords';
  row: number;
  issues: string[];
}

export interface SemanticConflict {
  id: string;
  field: string;
  db: string;
  panel: string;
}

export interface FieldDrift {
  id: string;
  field: string;
  expected: unknown;
  actual: unknown;
}

export interface EntityCounts {
  sheet: number;
  db: number;
  create: string[];
  update: string[];
  unchanged: string[];
  db_only_preserved: string[];
  semantic_conflicts: SemanticConflict[];
}

export interface ControlPlanePlan {
  aborted: boolean;
  abort_reason: string | null;
  mode: SyncMode;
  invalid_rows: InvalidRow[];
  duplicate_client_ids: string[];
  duplicate_keyword_ids: string[];
  orphan_keywords: string[];
  clientes: EntityCounts;
  keywords: EntityCounts;
  client_writes: Cliente[];
  keyword_writes: Keyword[];
  control_plane_hash: string;
  plan_hash: string;
}

export interface ControlPlaneResult {
  ok: boolean;
  verdict:
    | 'DRY_RUN_PASS'
    | 'NO_CHANGES_TO_APPLY'
    | 'APPLY_PASS'
    | 'PLAN_ABORTED'
    | 'CONTROL_PLANE_CHANGED_SINCE_DRY_RUN'
    | 'CONFIG_SYNC_FAIL'
    | 'UNSUPPORTED_IN_CONTROL_PLANE_V2';
  sync_verdict: CanonicalSyncVerdict;
  plan: ControlPlanePlan;
  writes: number;
  panel_target_drift: FieldDrift[];
  db_only_preserved_count: number;
  duration_ms: number;
}

export interface ControlPlaneIo {
  readClientesSheet: () => Promise<RawRow[]>;
  readKeywordsSheet: () => Promise<RawRow[]>;
  loadDbClientes: () => Promise<Cliente[]>;
  loadDbKeywords: () => Promise<Keyword[]>;
  writeClientes: (rows: Cliente[]) => Promise<number>;
  writeKeywords: (rows: Keyword[]) => Promise<number>;
}

export function parseControlPlaneArgs(argv: string[]): ControlPlaneArgs | { error: string } {
  let apply = false;
  let auto = false;
  let expectedHash: string | null = null;
  let entities: ControlPlaneEntity[] = ['clientes', 'keywords'];

  for (const raw of argv) {
    if (raw === '--auto') {
      auto = true;
      continue;
    }
    if (raw === '--apply') {
      apply = true;
      continue;
    }
    if (raw.startsWith('--expected-hash=')) {
      expectedHash = raw.slice('--expected-hash='.length).trim() || null;
      continue;
    }
    if (raw === '--expected-hash') {
      return { error: 'APPLY_REQUIRES_EXPECTED_HASH' };
    }
    if (raw.startsWith('--entities=')) {
      const parts = raw
        .slice('--entities='.length)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const unsupported = parts.filter(
        (p) => p !== 'clientes' && p !== 'keywords',
      );
      if (unsupported.length > 0) {
        return { error: 'UNSUPPORTED_IN_CONTROL_PLANE_V2' };
      }
      entities = parts as ControlPlaneEntity[];
      continue;
    }
    if (raw === '--help' || raw === '-h') {
      continue;
    }
    return { error: `UNKNOWN_ARG:${raw}` };
  }

  if (auto && apply) {
    return { error: 'AUTO_INCOMPATIBLE_WITH_APPLY' };
  }
  if (auto && expectedHash) {
    return { error: 'AUTO_GENERATES_EXPECTED_HASH' };
  }

  return { apply, auto, expectedHash, entities };
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === '';
}

function rowIsFullyEmpty(row: RawRow, fields: readonly string[]): boolean {
  return fields.every((f) => isBlank(row[f]));
}

/** Identidad: trim, colapso de espacios, case-insensitive, NFD sin marcas. */
export function foldIdentity(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

function emptyLike(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

export function fieldsEquivalent(a: unknown, b: unknown): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return a === b;
  }
  if (emptyLike(a) && emptyLike(b)) return true;
  if (emptyLike(a) || emptyLike(b)) return false;
  return String(a).trim().normalize('NFC') === String(b).trim().normalize('NFC');
}

function issuesFromZod(error?: { issues: { path: (string | number)[]; message: string }[] }): string[] {
  if (!error) return ['invalid'];
  return error.issues.map((i) => `${i.path.join('.') || '(fila)'}: ${i.message}`);
}

function boolFieldIssues(row: RawRow, fields: readonly string[]): string[] {
  return fields
    .filter((f) => !isRecognizedBoolCell(row[f]))
    .map((f) => `${f}: invalid boolean`);
}

export function validateControlPlaneSheet(
  clienteRows: RawRow[],
  keywordRows: RawRow[],
): {
  clientes: Cliente[];
  keywords: Keyword[];
  invalid_rows: InvalidRow[];
  duplicate_client_ids: string[];
  duplicate_keyword_ids: string[];
  orphan_keywords: string[];
} {
  const invalid_rows: InvalidRow[] = [];
  const clientes: Cliente[] = [];

  clienteRows.forEach((row, idx) => {
    if (rowIsFullyEmpty(row, CLIENT_FIELDS)) return;
    const bools = boolFieldIssues(row, ['activo', 'alertas_activas']);
    const parsed = mapClienteRow(row);
    if (bools.length > 0 || !parsed.success || !parsed.data) {
      invalid_rows.push({
        tab: '03_Clientes',
        row: idx + 2,
        issues: bools.length > 0 ? bools : issuesFromZod(parsed.error),
      });
      return;
    }
    clientes.push(parsed.data);
  });

  const keywords: Keyword[] = [];
  keywordRows.forEach((row, idx) => {
    if (rowIsFullyEmpty(row, KEYWORD_FIELDS)) return;
    const bools = boolFieldIssues(row, ['activa', 'alerta']);
    const parsed = mapKeywordRowStrict(row);
    if (bools.length > 0 || !parsed.success || !parsed.data) {
      invalid_rows.push({
        tab: '02_Keywords',
        row: idx + 2,
        issues: bools.length > 0 ? bools : issuesFromZod(parsed.error),
      });
      return;
    }
    keywords.push(parsed.data);
  });

  const clientIdCounts = new Map<string, number>();
  for (const c of clientes) {
    clientIdCounts.set(c.cliente_id, (clientIdCounts.get(c.cliente_id) ?? 0) + 1);
  }
  const duplicate_client_ids = [...clientIdCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id)
    .sort();

  const kwIdCounts = new Map<string, number>();
  for (const k of keywords) {
    kwIdCounts.set(k.keyword_id, (kwIdCounts.get(k.keyword_id) ?? 0) + 1);
  }
  const duplicate_keyword_ids = [...kwIdCounts.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id)
    .sort();

  const panelClientIds = new Set(clientes.map((c) => c.cliente_id));
  const orphan_keywords = keywords
    .filter((k) => !k.cliente_id || !panelClientIds.has(k.cliente_id))
    .map((k) => k.keyword_id)
    .sort();

  return {
    clientes,
    keywords,
    invalid_rows,
    duplicate_client_ids,
    duplicate_keyword_ids,
    orphan_keywords,
  };
}

function canonicalCliente(c: Cliente): Record<string, unknown> {
  return {
    cliente_id: c.cliente_id,
    nombre_cliente: c.nombre_cliente,
    industria: c.industria,
    marcas: c.marcas,
    competidores: c.competidores,
    voceros: c.voceros,
    temas_sensibles: c.temas_sensibles,
    activo: c.activo,
    prioridad_ia: c.prioridad_ia,
    alertas_activas: c.alertas_activas,
    notas: c.notas,
  };
}

function canonicalKeyword(k: Keyword): Record<string, unknown> {
  return {
    keyword_id: k.keyword_id,
    cliente_id: k.cliente_id,
    cliente: k.cliente,
    keyword: k.keyword,
    alias_o_variantes: k.alias_o_variantes,
    tipo_keyword: k.tipo_keyword,
    regla: k.regla,
    activa: k.activa,
    prioridad: k.prioridad,
    alerta: k.alerta,
    contexto_incluir: k.contexto_incluir,
    contexto_excluir: k.contexto_excluir,
    notas: k.notas,
  };
}

export function computeControlPlaneHash(clientes: Cliente[], keywords: Keyword[]): string {
  const payload = {
    clientes: [...clientes]
      .sort((a, b) => a.cliente_id.localeCompare(b.cliente_id))
      .map(canonicalCliente),
    keywords: [...keywords]
      .sort((a, b) => a.keyword_id.localeCompare(b.keyword_id))
      .map(canonicalKeyword),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function computePlanHash(plan: Omit<ControlPlanePlan, 'plan_hash'>): string {
  const payload = {
    mode: plan.mode,
    aborted: plan.aborted,
    abort_reason: plan.abort_reason,
    invalid_rows: plan.invalid_rows,
    duplicate_client_ids: plan.duplicate_client_ids,
    duplicate_keyword_ids: plan.duplicate_keyword_ids,
    orphan_keywords: plan.orphan_keywords,
    clientes: {
      create: plan.clientes.create,
      update: plan.clientes.update,
      unchanged: plan.clientes.unchanged,
      db_only_preserved: plan.clientes.db_only_preserved,
      semantic_conflicts: plan.clientes.semantic_conflicts,
    },
    keywords: {
      create: plan.keywords.create,
      update: plan.keywords.update,
      unchanged: plan.keywords.unchanged,
      db_only_preserved: plan.keywords.db_only_preserved,
      semantic_conflicts: plan.keywords.semantic_conflicts,
    },
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function emptyCounts(sheet: number, db: number): EntityCounts {
  return {
    sheet,
    db,
    create: [],
    update: [],
    unchanged: [],
    db_only_preserved: [],
    semantic_conflicts: [],
  };
}

function clientIdentityConflict(panel: Cliente, db: Cliente): SemanticConflict | null {
  if (foldIdentity(panel.nombre_cliente) === foldIdentity(db.nombre_cliente)) return null;
  return {
    id: panel.cliente_id,
    field: 'nombre_cliente',
    db: db.nombre_cliente,
    panel: panel.nombre_cliente,
  };
}

function keywordIdentityConflict(panel: Keyword, db: Keyword): SemanticConflict | null {
  if (panel.cliente_id !== db.cliente_id) {
    return {
      id: panel.keyword_id,
      field: 'cliente_id',
      db: String(db.cliente_id ?? ''),
      panel: String(panel.cliente_id ?? ''),
    };
  }
  if (foldIdentity(panel.keyword) !== foldIdentity(db.keyword)) {
    return {
      id: panel.keyword_id,
      field: 'keyword',
      db: db.keyword,
      panel: panel.keyword,
    };
  }
  return null;
}

function rowChanged<T extends Record<string, unknown>>(
  panel: T,
  db: T,
  fields: readonly string[],
): boolean {
  return fields.some((f) => !fieldsEquivalent(panel[f], db[f]));
}

export function buildControlPlanePlan(input: {
  mode: SyncMode;
  sheetClientes: Cliente[];
  sheetKeywords: Keyword[];
  dbClientes: Cliente[];
  dbKeywords: Keyword[];
  invalid_rows: InvalidRow[];
  duplicate_client_ids: string[];
  duplicate_keyword_ids: string[];
  orphan_keywords: string[];
}): ControlPlanePlan {
  const control_plane_hash = computeControlPlaneHash(input.sheetClientes, input.sheetKeywords);
  const abort =
    input.invalid_rows.length > 0 ||
    input.duplicate_client_ids.length > 0 ||
    input.duplicate_keyword_ids.length > 0 ||
    input.orphan_keywords.length > 0;

  const clientes = emptyCounts(input.sheetClientes.length, input.dbClientes.length);
  const keywords = emptyCounts(input.sheetKeywords.length, input.dbKeywords.length);
  const client_writes: Cliente[] = [];
  const keyword_writes: Keyword[] = [];

  if (abort) {
    let abort_reason = 'VALIDATION_ERROR';
    if (input.invalid_rows.length > 0) abort_reason = 'VALIDATION_ERROR';
    else if (input.duplicate_client_ids.length > 0) abort_reason = 'DUPLICATE_CLIENT_IDS';
    else if (input.duplicate_keyword_ids.length > 0) abort_reason = 'DUPLICATE_KEYWORD_IDS';
    else abort_reason = 'ORPHAN_KEYWORDS';
    const partial: Omit<ControlPlanePlan, 'plan_hash'> = {
      aborted: true,
      abort_reason,
      mode: input.mode,
      invalid_rows: input.invalid_rows,
      duplicate_client_ids: input.duplicate_client_ids,
      duplicate_keyword_ids: input.duplicate_keyword_ids,
      orphan_keywords: input.orphan_keywords,
      clientes,
      keywords,
      client_writes: [],
      keyword_writes: [],
      control_plane_hash,
    };
    return { ...partial, plan_hash: computePlanHash(partial) };
  }

  const dbC = new Map(input.dbClientes.map((c) => [c.cliente_id, c]));
  const dbK = new Map(input.dbKeywords.map((k) => [k.keyword_id, k]));
  const sheetCIds = new Set(input.sheetClientes.map((c) => c.cliente_id));
  const sheetKIds = new Set(input.sheetKeywords.map((k) => k.keyword_id));

  for (const panel of [...input.sheetClientes].sort((a, b) => a.cliente_id.localeCompare(b.cliente_id))) {
    const db = dbC.get(panel.cliente_id);
    if (!db) {
      clientes.create.push(panel.cliente_id);
      client_writes.push(panel);
      continue;
    }
    const conflict = clientIdentityConflict(panel, db);
    if (conflict) {
      clientes.semantic_conflicts.push(conflict);
      continue;
    }
    if (rowChanged(panel as unknown as Record<string, unknown>, db as unknown as Record<string, unknown>, CLIENT_DIFF_FIELDS)) {
      clientes.update.push(panel.cliente_id);
      client_writes.push(panel);
    } else {
      clientes.unchanged.push(panel.cliente_id);
    }
  }
  for (const db of input.dbClientes) {
    if (!sheetCIds.has(db.cliente_id)) clientes.db_only_preserved.push(db.cliente_id);
  }
  clientes.db_only_preserved.sort();

  for (const panel of [...input.sheetKeywords].sort((a, b) => a.keyword_id.localeCompare(b.keyword_id))) {
    const db = dbK.get(panel.keyword_id);
    if (!db) {
      keywords.create.push(panel.keyword_id);
      keyword_writes.push(panel);
      continue;
    }
    const conflict = keywordIdentityConflict(panel, db);
    if (conflict) {
      keywords.semantic_conflicts.push(conflict);
      continue;
    }
    if (rowChanged(panel as unknown as Record<string, unknown>, db as unknown as Record<string, unknown>, KEYWORD_DIFF_FIELDS)) {
      keywords.update.push(panel.keyword_id);
      keyword_writes.push(panel);
    } else {
      keywords.unchanged.push(panel.keyword_id);
    }
  }
  for (const db of input.dbKeywords) {
    if (!sheetKIds.has(db.keyword_id)) keywords.db_only_preserved.push(db.keyword_id);
  }
  keywords.db_only_preserved.sort();

  const semanticAbort =
    clientes.semantic_conflicts.length > 0 || keywords.semantic_conflicts.length > 0;
  const partial: Omit<ControlPlanePlan, 'plan_hash'> = {
    aborted: semanticAbort,
    abort_reason: semanticAbort ? 'SEMANTIC_ID_CONFLICT' : null,
    mode: input.mode,
    invalid_rows: [],
    duplicate_client_ids: [],
    duplicate_keyword_ids: [],
    orphan_keywords: [],
    clientes,
    keywords,
    client_writes: semanticAbort ? [] : client_writes,
    keyword_writes: semanticAbort ? [] : keyword_writes,
    control_plane_hash,
  };
  return { ...partial, plan_hash: computePlanHash(partial) };
}

export function panelTargetDrift(
  sheetClientes: Cliente[],
  sheetKeywords: Keyword[],
  dbClientes: Cliente[],
  dbKeywords: Keyword[],
): FieldDrift[] {
  const drift: FieldDrift[] = [];
  const dbC = new Map(dbClientes.map((c) => [c.cliente_id, c]));
  const dbK = new Map(dbKeywords.map((k) => [k.keyword_id, k]));
  for (const panel of sheetClientes) {
    const db = dbC.get(panel.cliente_id);
    if (!db) {
      drift.push({ id: panel.cliente_id, field: '(row)', expected: 'present', actual: 'missing' });
      continue;
    }
    for (const f of CLIENT_FIELDS) {
      if (!fieldsEquivalent((panel as Record<string, unknown>)[f], (db as Record<string, unknown>)[f])) {
        drift.push({
          id: panel.cliente_id,
          field: f,
          expected: (panel as Record<string, unknown>)[f],
          actual: (db as Record<string, unknown>)[f],
        });
      }
    }
  }
  for (const panel of sheetKeywords) {
    const db = dbK.get(panel.keyword_id);
    if (!db) {
      drift.push({ id: panel.keyword_id, field: '(row)', expected: 'present', actual: 'missing' });
      continue;
    }
    for (const f of KEYWORD_FIELDS) {
      if (!fieldsEquivalent((panel as Record<string, unknown>)[f], (db as Record<string, unknown>)[f])) {
        drift.push({
          id: panel.keyword_id,
          field: f,
          expected: (panel as Record<string, unknown>)[f],
          actual: (db as Record<string, unknown>)[f],
        });
      }
    }
  }
  return drift;
}

function abortPlan(mode: SyncMode, reason: string, hash = ''): ControlPlanePlan {
  const partial: Omit<ControlPlanePlan, 'plan_hash'> = {
    aborted: true,
    abort_reason: reason,
    mode,
    invalid_rows: [],
    duplicate_client_ids: [],
    duplicate_keyword_ids: [],
    orphan_keywords: [],
    clientes: emptyCounts(0, 0),
    keywords: emptyCounts(0, 0),
    client_writes: [],
    keyword_writes: [],
    control_plane_hash: hash,
  };
  return { ...partial, plan_hash: computePlanHash(partial) };
}

export function canonicalSyncVerdict(
  verdict: ControlPlaneResult['verdict'],
  plannedWrites: number,
): CanonicalSyncVerdict {
  switch (verdict) {
    case 'APPLY_PASS':
      return 'CONTROL_PLANE_SYNC_PASS';
    case 'NO_CHANGES_TO_APPLY':
      return 'CONTROL_PLANE_SYNC_NO_CHANGES';
    case 'DRY_RUN_PASS':
      return plannedWrites === 0 ? 'CONTROL_PLANE_SYNC_NO_CHANGES' : 'CONTROL_PLANE_SYNC_PASS';
    case 'CONFIG_SYNC_FAIL':
      return 'CONTROL_PLANE_SYNC_INFRA_ERROR';
    default:
      return 'CONTROL_PLANE_SYNC_ABORTED';
  }
}

function plannedWriteCount(plan: ControlPlanePlan): number {
  return plan.client_writes.length + plan.keyword_writes.length;
}

function finishResult(
  partial: Omit<ControlPlaneResult, 'sync_verdict' | 'duration_ms'>,
  startedAt: number,
): ControlPlaneResult {
  return {
    ...partial,
    sync_verdict: canonicalSyncVerdict(partial.verdict, plannedWriteCount(partial.plan)),
    duration_ms: Date.now() - startedAt,
  };
}

async function runControlPlaneOnce(
  args: ControlPlaneArgs,
  io: ControlPlaneIo,
  startedAt: number,
): Promise<ControlPlaneResult> {
  const mode: SyncMode = args.apply ? 'APPLY' : 'DRY_RUN';

  if (args.entities.some((e) => e !== 'clientes' && e !== 'keywords')) {
    const plan = abortPlan(mode, 'UNSUPPORTED_IN_CONTROL_PLANE_V2');
    return finishResult({
      ok: false,
      verdict: 'UNSUPPORTED_IN_CONTROL_PLANE_V2',
      plan,
      writes: 0,
      panel_target_drift: [],
      db_only_preserved_count: 0,
    }, startedAt);
  }

  if (args.apply && !args.expectedHash) {
    const plan = abortPlan('APPLY', 'APPLY_REQUIRES_EXPECTED_HASH');
    return finishResult({
      ok: false,
      verdict: 'PLAN_ABORTED',
      plan,
      writes: 0,
      panel_target_drift: [],
      db_only_preserved_count: 0,
    }, startedAt);
  }

  const sheetClientesRaw = await io.readClientesSheet();
  const sheetKeywordsRaw = await io.readKeywordsSheet();
  const validated = validateControlPlaneSheet(sheetClientesRaw, sheetKeywordsRaw);
  const hashNow = computeControlPlaneHash(validated.clientes, validated.keywords);

  const sheetInvalid =
    validated.invalid_rows.length > 0 ||
    validated.duplicate_client_ids.length > 0 ||
    validated.duplicate_keyword_ids.length > 0 ||
    validated.orphan_keywords.length > 0;

  if (sheetInvalid) {
    const plan = buildControlPlanePlan({
      mode,
      sheetClientes: validated.clientes,
      sheetKeywords: validated.keywords,
      dbClientes: [],
      dbKeywords: [],
      invalid_rows: validated.invalid_rows,
      duplicate_client_ids: validated.duplicate_client_ids,
      duplicate_keyword_ids: validated.duplicate_keyword_ids,
      orphan_keywords: validated.orphan_keywords,
    });
    return finishResult({
      ok: false,
      verdict: 'PLAN_ABORTED',
      plan,
      writes: 0,
      panel_target_drift: [],
      db_only_preserved_count: 0,
    }, startedAt);
  }

  if (args.apply && args.expectedHash && hashNow !== args.expectedHash) {
    const plan = abortPlan('APPLY', 'CONTROL_PLANE_CHANGED_SINCE_DRY_RUN', hashNow);
    return finishResult({
      ok: false,
      verdict: 'CONTROL_PLANE_CHANGED_SINCE_DRY_RUN',
      plan,
      writes: 0,
      panel_target_drift: [],
      db_only_preserved_count: 0,
    }, startedAt);
  }

  const dbClientes = await io.loadDbClientes();
  const dbKeywords = await io.loadDbKeywords();

  const plan = buildControlPlanePlan({
    mode,
    sheetClientes: validated.clientes,
    sheetKeywords: validated.keywords,
    dbClientes,
    dbKeywords,
    invalid_rows: validated.invalid_rows,
    duplicate_client_ids: validated.duplicate_client_ids,
    duplicate_keyword_ids: validated.duplicate_keyword_ids,
    orphan_keywords: validated.orphan_keywords,
  });

  if (plan.aborted) {
    return finishResult({
      ok: false,
      verdict: 'PLAN_ABORTED',
      plan,
      writes: 0,
      panel_target_drift: [],
      db_only_preserved_count:
        plan.clientes.db_only_preserved.length + plan.keywords.db_only_preserved.length,
    }, startedAt);
  }

  if (mode === 'DRY_RUN') {
    return finishResult({
      ok: true,
      verdict: 'DRY_RUN_PASS',
      plan,
      writes: 0,
      panel_target_drift: [],
      db_only_preserved_count:
        plan.clientes.db_only_preserved.length + plan.keywords.db_only_preserved.length,
    }, startedAt);
  }

  if (plan.client_writes.length === 0 && plan.keyword_writes.length === 0) {
    return finishResult({
      ok: true,
      verdict: 'NO_CHANGES_TO_APPLY',
      plan,
      writes: 0,
      panel_target_drift: [],
      db_only_preserved_count:
        plan.clientes.db_only_preserved.length + plan.keywords.db_only_preserved.length,
    }, startedAt);
  }

  const w1 = await io.writeClientes(plan.client_writes);
  const w2 = await io.writeKeywords(plan.keyword_writes);
  const writes = w1 + w2;

  const afterC = await io.loadDbClientes();
  const afterK = await io.loadDbKeywords();
  const drift = panelTargetDrift(validated.clientes, validated.keywords, afterC, afterK);
  if (drift.length > 0) {
    return finishResult({
      ok: false,
      verdict: 'CONFIG_SYNC_FAIL',
      plan,
      writes,
      panel_target_drift: drift,
      db_only_preserved_count:
        plan.clientes.db_only_preserved.length + plan.keywords.db_only_preserved.length,
    }, startedAt);
  }

  return finishResult({
    ok: true,
    verdict: 'APPLY_PASS',
    plan,
    writes,
    panel_target_drift: [],
    db_only_preserved_count:
      plan.clientes.db_only_preserved.length + plan.keywords.db_only_preserved.length,
  }, startedAt);
}

async function runControlPlaneAutoSync(
  args: ControlPlaneArgs,
  io: ControlPlaneIo,
  startedAt: number,
): Promise<ControlPlaneResult> {
  const entities = args.entities;
  const planned = await runControlPlaneOnce(
    { apply: false, auto: false, expectedHash: null, entities },
    io,
    startedAt,
  );
  if (!planned.ok) return planned;

  const n = plannedWriteCount(planned.plan);
  if (n === 0) {
    return {
      ...planned,
      verdict: 'NO_CHANGES_TO_APPLY',
      sync_verdict: 'CONTROL_PLANE_SYNC_NO_CHANGES',
      duration_ms: Date.now() - startedAt,
    };
  }
  if (n > AUTO_SYNC_MAX_WRITES) {
    return finishResult({
      ok: false,
      verdict: 'PLAN_ABORTED',
      plan: {
        ...planned.plan,
        aborted: true,
        abort_reason: `AUTO_SYNC_WRITE_CAP:${n}>${AUTO_SYNC_MAX_WRITES}`,
        client_writes: [],
        keyword_writes: [],
      },
      writes: 0,
      panel_target_drift: [],
      db_only_preserved_count: planned.db_only_preserved_count,
    }, startedAt);
  }

  return runControlPlaneOnce(
    {
      apply: true,
      auto: false,
      expectedHash: planned.plan.control_plane_hash,
      entities,
    },
    io,
    startedAt,
  );
}

export async function runControlPlaneSync(
  args: ControlPlaneArgs,
  io: ControlPlaneIo,
): Promise<ControlPlaneResult> {
  const startedAt = Date.now();
  if (args.auto) return runControlPlaneAutoSync(args, io, startedAt);
  return runControlPlaneOnce(args, io, startedAt);
}

export function controlPlaneObservability(result: ControlPlaneResult): Record<string, unknown> {
  const { plan } = result;
  return {
    CONTROL_PLANE_SYNC: result.sync_verdict,
    mode: plan.mode,
    sheet_clients: plan.clientes.sheet,
    db_clients: plan.clientes.db,
    sheet_keywords: plan.keywords.sheet,
    db_keywords: plan.keywords.db,
    clients_create: plan.clientes.create.length,
    clients_update: plan.clientes.update.length,
    clients_unchanged: plan.clientes.unchanged.length,
    keywords_create: plan.keywords.create.length,
    keywords_update: plan.keywords.update.length,
    keywords_unchanged: plan.keywords.unchanged.length,
    db_only_preserved: result.db_only_preserved_count,
    invalid_rows: plan.invalid_rows.length,
    duplicate_client_ids: plan.duplicate_client_ids.length,
    duplicate_keyword_ids: plan.duplicate_keyword_ids.length,
    orphan_keywords: plan.orphan_keywords.length,
    semantic_conflicts:
      plan.clientes.semantic_conflicts.length + plan.keywords.semantic_conflicts.length,
    control_plane_hash: plan.control_plane_hash,
    writes: result.writes,
    duration: result.duration_ms,
    verdict: result.sync_verdict,
    abort_reason: plan.abort_reason,
  };
}

export function formatControlPlaneReport(result: ControlPlaneResult): string {
  const { plan } = result;
  const lines = [
    `CONTROL_PLANE_SYNC=${result.sync_verdict}`,
    `MODE=${plan.mode}`,
    `VERDICT=${result.verdict}`,
    plan.abort_reason ? `ABORT_REASON=${plan.abort_reason}` : null,
    `DURATION_MS=${result.duration_ms}`,
    '',
    'CLIENTES:',
    `sheet=${plan.clientes.sheet}`,
    `db=${plan.clientes.db}`,
    `create=${plan.clientes.create.length}`,
    `update=${plan.clientes.update.length}`,
    `unchanged=${plan.clientes.unchanged.length}`,
    `db_only_preserved=${plan.clientes.db_only_preserved.length}`,
    `semantic_conflicts=${plan.clientes.semantic_conflicts.length}`,
    '',
    'KEYWORDS:',
    `sheet=${plan.keywords.sheet}`,
    `db=${plan.keywords.db}`,
    `create=${plan.keywords.create.length}`,
    `update=${plan.keywords.update.length}`,
    `unchanged=${plan.keywords.unchanged.length}`,
    `db_only_preserved=${plan.keywords.db_only_preserved.length}`,
    `semantic_conflicts=${plan.keywords.semantic_conflicts.length}`,
    '',
    `ORPHAN_KEYWORDS=${plan.orphan_keywords.length}`,
    `DUPLICATE_CLIENT_IDS=${plan.duplicate_client_ids.length}`,
    `DUPLICATE_KEYWORD_IDS=${plan.duplicate_keyword_ids.length}`,
    `INVALID_ROWS=${plan.invalid_rows.length}`,
    '',
    `WRITES=${result.writes}`,
    `DB_ONLY_PRESERVED_COUNT=${result.db_only_preserved_count}`,
    `PANEL_TARGET_DRIFT=${result.panel_target_drift.length}`,
    '',
    `CONTROL_PLANE_HASH=${plan.control_plane_hash}`,
    `PLAN_HASH=${plan.plan_hash}`,
  ].filter((x) => x !== null);
  if (plan.clientes.semantic_conflicts.length > 0) {
    lines.push('CLIENT_SEMANTIC_ID_CONFLICTS=' + JSON.stringify(plan.clientes.semantic_conflicts));
  }
  if (plan.keywords.semantic_conflicts.length > 0) {
    lines.push('KEYWORD_SEMANTIC_ID_CONFLICTS=' + JSON.stringify(plan.keywords.semantic_conflicts));
  }
  if (result.panel_target_drift.length > 0) {
    lines.push('DRIFT_DETAIL=' + JSON.stringify(result.panel_target_drift));
  }
  if (plan.invalid_rows.length > 0) {
    lines.push('INVALID_DETAIL=' + JSON.stringify(plan.invalid_rows));
  }
  lines.push('');
  lines.push(`${result.sync_verdict}.`);
  return lines.join('\n');
}
