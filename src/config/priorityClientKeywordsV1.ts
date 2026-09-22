/**
 * KEYWORD POLICY V1 — Mery + Jumex + Patrón.
 *
 * Fuente de verdad del plan idempotente. No toca red: el script de apply
 * carga LIVE, calcula el plan y (solo con --apply) escribe 02_Keywords +
 * public.keywords.
 *
 * IDs nuevos reservados (sin colisión con KEY-0001..KEY-0069):
 *   KEY-0070..KEY-0077
 */
import { foldText } from '../matchers/text.js';
import { parseBool } from '../utils/parse.js';
import type { Keyword } from '../types/schemas.js';

export const POLICY_CLIENT_IDS = ['CLI-MERY-TEST', 'CLI-0001', 'CLI-0002'] as const;
export type PolicyClientId = (typeof POLICY_CLIENT_IDS)[number];

export const POLICY_CLIENT_NAMES: Record<PolicyClientId, string> = {
  'CLI-MERY-TEST': 'Mery Pozos / Merilyn Gómez Pozos',
  'CLI-0001': 'Jumex',
  'CLI-0002': 'Bebidas alcoholicas',
};

export const KEYWORD_POLICY_FIELDS = [
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

export type KeywordPolicyField = (typeof KEYWORD_POLICY_FIELDS)[number];

const POLICY_NOTE = 'KEYWORD_POLICY_V1';

function row(
  over: Omit<Keyword, 'regla' | 'contexto_incluir' | 'contexto_excluir' | 'notas'> &
    Partial<Pick<Keyword, 'regla' | 'contexto_incluir' | 'contexto_excluir' | 'notas'>>,
): Keyword {
  return {
    regla: over.regla ?? null,
    contexto_incluir: over.contexto_incluir ?? null,
    contexto_excluir: over.contexto_excluir ?? null,
    notas: over.notas ?? null,
    ...over,
  };
}

/** Filas objetivo (CREATE o UPDATE completo). KEY-0069 se maneja como DEACTIVATE. */
export const POLICY_ENSURE_ROWS: Keyword[] = [
  // ── Mery DIRECT_REQUESTED ──────────────────────────────────────────────
  row({
    keyword_id: 'KEY-0040',
    cliente_id: 'CLI-MERY-TEST',
    cliente: POLICY_CLIENT_NAMES['CLI-MERY-TEST'],
    keyword: 'Merilyn Gómez Pozos',
    alias_o_variantes: 'Merilyn Gomez Pozos',
    tipo_keyword: 'frase_exacta',
    activa: true,
    prioridad: 'Alta',
    alerta: true,
    notas: `${POLICY_NOTE}. DIRECT_REQUESTED. Nombre completo. Alias sin acento por trazabilidad.`,
  }),
  row({
    keyword_id: 'KEY-0041',
    cliente_id: 'CLI-MERY-TEST',
    cliente: POLICY_CLIENT_NAMES['CLI-MERY-TEST'],
    keyword: 'Mery Pozos',
    alias_o_variantes: null,
    tipo_keyword: 'frase_exacta',
    activa: true,
    prioridad: 'Alta',
    alerta: true,
    notas: `${POLICY_NOTE}. DIRECT_REQUESTED. Apodo + apellido compuesto.`,
  }),
  row({
    keyword_id: 'KEY-0042',
    cliente_id: 'CLI-MERY-TEST',
    cliente: POLICY_CLIENT_NAMES['CLI-MERY-TEST'],
    keyword: 'Mery Gómez Pozos',
    alias_o_variantes: 'Mery Gomez Pozos',
    tipo_keyword: 'frase_exacta',
    activa: true,
    prioridad: 'Alta',
    alerta: true,
    notas: `${POLICY_NOTE}. DIRECT_REQUESTED. Apodo + apellidos. Alias sin acento.`,
  }),
  row({
    keyword_id: 'KEY-0076',
    cliente_id: 'CLI-MERY-TEST',
    cliente: POLICY_CLIENT_NAMES['CLI-MERY-TEST'],
    keyword: 'diputada Pozos',
    alias_o_variantes: null,
    tipo_keyword: 'frase_exacta',
    activa: true,
    prioridad: 'Alta',
    alerta: true,
    notas: `${POLICY_NOTE}. DIRECT_REQUESTED. Cargo + apellido. No crear Pozos sola.`,
  }),
  row({
    keyword_id: 'KEY-0077',
    cliente_id: 'CLI-MERY-TEST',
    cliente: POLICY_CLIENT_NAMES['CLI-MERY-TEST'],
    keyword: 'diputada Mery',
    alias_o_variantes: null,
    tipo_keyword: 'frase_exacta',
    activa: true,
    prioridad: 'Alta',
    alerta: true,
    notas: `${POLICY_NOTE}. DIRECT_REQUESTED. Cargo + apodo. No crear Mery sola.`,
  }),

  // ── Jumex ─────────────────────────────────────────────────────────────
  row({
    keyword_id: 'KEY-0001',
    cliente_id: 'CLI-0001',
    cliente: POLICY_CLIENT_NAMES['CLI-0001'],
    keyword: 'Jumex',
    alias_o_variantes: 'Jugos Jumex|Grupo Jumex',
    tipo_keyword: 'exacta',
    regla: 'exacta',
    activa: true,
    prioridad: 'Alta',
    alerta: false,
    contexto_incluir: null,
    contexto_excluir: null,
    notas:
      `${POLICY_NOTE}. Marca literal exacta (límite de palabra), all-context. ` +
      `alerta=false durante calibración (CLI-0001 alertas_activas=true). ` +
      `No pasa por puerta contextual Jumex.`,
  }),
  row({
    keyword_id: 'KEY-0074',
    cliente_id: 'CLI-0001',
    cliente: POLICY_CLIENT_NAMES['CLI-0001'],
    keyword: 'Jugos y Néctares',
    alias_o_variantes: 'Jugos y Nectares',
    tipo_keyword: 'frase_exacta',
    activa: true,
    prioridad: 'Media',
    alerta: false,
    notas: `${POLICY_NOTE}. SECTOR_PRODUCTO. frase_exacta. Alias sin acento.`,
  }),
  row({
    keyword_id: 'KEY-0075',
    cliente_id: 'CLI-0001',
    cliente: POLICY_CLIENT_NAMES['CLI-0001'],
    keyword: 'impuesto bebidas azucaradas',
    alias_o_variantes: 'impuesto a bebidas azucaradas|impuesto a las bebidas azucaradas',
    tipo_keyword: 'frase_exacta',
    activa: true,
    prioridad: 'Alta',
    alerta: false,
    notas: `${POLICY_NOTE}. REGULATORIO. frase_exacta con artículos opcionales en alias.`,
  }),

  // ── Patrón DIRECT_BRAND / REGULATORIO ─────────────────────────────────
  row({
    keyword_id: 'KEY-0060',
    cliente_id: 'CLI-0002',
    cliente: POLICY_CLIENT_NAMES['CLI-0002'],
    keyword: 'Tequila Patrón',
    alias_o_variantes: 'Tequila Patron',
    tipo_keyword: 'frase_exacta',
    activa: true,
    prioridad: 'Alta',
    alerta: true,
    notas:
      `${POLICY_NOTE}. DIRECT_BRAND. frase_exacta. Solo "Tequila Patrón/Patron". ` +
      `Sin orden invertido (Patrón Tequila).`,
  }),
  row({
    keyword_id: 'KEY-0061',
    cliente_id: 'CLI-0002',
    cliente: POLICY_CLIENT_NAMES['CLI-0002'],
    keyword: 'Casa Patrón',
    alias_o_variantes: 'Casa Patron',
    tipo_keyword: 'frase_exacta',
    activa: true,
    prioridad: 'Alta',
    alerta: true,
    notas: `${POLICY_NOTE}. DIRECT_BRAND. Destilería. Alias sin acento.`,
  }),
  row({
    keyword_id: 'KEY-0064',
    cliente_id: 'CLI-0002',
    cliente: POLICY_CLIENT_NAMES['CLI-0002'],
    keyword: 'IEPS bebidas alcohólicas',
    alias_o_variantes: 'IEPS bebidas alcoholicas|IEPS alcohol',
    tipo_keyword: 'frase_exacta',
    activa: true,
    prioridad: 'Alta',
    alerta: true,
    notas: `${POLICY_NOTE}. REGULATORIO. Reutiliza KEY-0064 (antes "IEPS alcohol").`,
  }),
  row({
    keyword_id: 'KEY-0070',
    cliente_id: 'CLI-0002',
    cliente: POLICY_CLIENT_NAMES['CLI-0002'],
    keyword: 'Tequila Cazadores',
    alias_o_variantes: null,
    tipo_keyword: 'frase_exacta',
    activa: true,
    prioridad: 'Alta',
    alerta: true,
    notas: `${POLICY_NOTE}. DIRECT_BRAND. frase_exacta.`,
  }),
  row({
    keyword_id: 'KEY-0071',
    cliente_id: 'CLI-0002',
    cliente: POLICY_CLIENT_NAMES['CLI-0002'],
    keyword: 'Patrón Spirits',
    alias_o_variantes: 'Patron Spirits',
    tipo_keyword: 'frase_exacta',
    activa: true,
    prioridad: 'Alta',
    alerta: true,
    notas: `${POLICY_NOTE}. DIRECT_BRAND. Alias sin acento.`,
  }),
  row({
    keyword_id: 'KEY-0072',
    cliente_id: 'CLI-0002',
    cliente: POLICY_CLIENT_NAMES['CLI-0002'],
    keyword: 'Grupo Bacardí',
    alias_o_variantes: 'Grupo Bacardi',
    tipo_keyword: 'frase_exacta',
    activa: true,
    prioridad: 'Alta',
    alerta: true,
    notas: `${POLICY_NOTE}. DIRECT_BRAND. Distinto de KEY-0015 Bacardí broad.`,
  }),
  row({
    keyword_id: 'KEY-0073',
    cliente_id: 'CLI-0002',
    cliente: POLICY_CLIENT_NAMES['CLI-0002'],
    keyword: 'Hacienda Patrón',
    alias_o_variantes: 'Hacienda Patron',
    tipo_keyword: 'frase_exacta',
    activa: true,
    prioridad: 'Alta',
    alerta: true,
    notas: `${POLICY_NOTE}. DIRECT_BRAND. Alias sin acento.`,
  }),
];

export const POLICY_DEACTIVATE_IDS = ['KEY-0069'] as const;

export const POLICY_RESERVED_NEW_IDS = [
  'KEY-0070',
  'KEY-0071',
  'KEY-0072',
  'KEY-0073',
  'KEY-0074',
  'KEY-0075',
  'KEY-0076',
  'KEY-0077',
] as const;

export const FORBIDDEN_REVERSED_TEQUILA_PATRON = ['patron tequila', 'patrón tequila'] as const;

export type PolicyAction = 'CREATE' | 'UPDATE' | 'DEACTIVATE' | 'UNCHANGED';

export interface PolicyOp {
  action: PolicyAction;
  keyword_id: string;
  cliente_id: string;
  keyword: string;
  desired: Keyword;
  live: Keyword | null;
  changed_fields: string[];
}

export interface PolicyPlan {
  ops: PolicyOp[];
  byClient: Record<string, Record<PolicyAction, PolicyOp[]>>;
  conflicts: string[];
  policy_ids: string[];
}

export function isPolicyClient(id: string | null | undefined): id is PolicyClientId {
  return (POLICY_CLIENT_IDS as readonly string[]).includes(id ?? '');
}

export function splitPipes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function canonPipes(raw: string | null | undefined): string {
  return splitPipes(raw)
    .map((s) => foldText(s))
    .sort()
    .join('|');
}

export function canonBool(v: unknown): boolean {
  return parseBool(v, false);
}

export function canonScalar(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v).trim();
}

const PIPE_FIELDS = new Set(['alias_o_variantes', 'contexto_incluir', 'contexto_excluir']);
const BOOL_FIELDS = new Set(['activa', 'alerta']);

export function fieldEquals(field: string, a: unknown, b: unknown): boolean {
  if (BOOL_FIELDS.has(field)) return canonBool(a) === canonBool(b);
  if (PIPE_FIELDS.has(field)) return canonPipes(String(a ?? '')) === canonPipes(String(b ?? ''));
  return canonScalar(a) === canonScalar(b);
}

export function diffKeywordFields(live: Keyword, desired: Keyword): string[] {
  const changed: string[] = [];
  for (const f of KEYWORD_POLICY_FIELDS) {
    if (f === 'keyword_id') continue;
    if (!fieldEquals(f, live[f], desired[f])) changed.push(f);
  }
  return changed;
}

export function hasReversedTequilaPatronAlias(alias: string | null | undefined, keyword: string): boolean {
  const terms = [...splitPipes(alias), keyword].map((t) => foldText(t).trim());
  return terms.some((t) => (FORBIDDEN_REVERSED_TEQUILA_PATRON as readonly string[]).includes(t));
}

function emptyByClient(): PolicyPlan['byClient'] {
  const out: PolicyPlan['byClient'] = {};
  for (const id of POLICY_CLIENT_IDS) {
    out[id] = { CREATE: [], UPDATE: [], DEACTIVATE: [], UNCHANGED: [] };
  }
  return out;
}

function findById(live: Keyword[], id: string): Keyword | undefined {
  return live.find((k) => k.keyword_id === id);
}

function findByClientKeyword(live: Keyword[], clienteId: string, keyword: string): Keyword | undefined {
  const folded = foldText(keyword).trim();
  return live.find((k) => k.cliente_id === clienteId && foldText(k.keyword).trim() === folded);
}

/**
 * Calcula el plan contra un snapshot LIVE. No escribe.
 * Aborta lógicamente (conflicts) si un ID reservado está ocupado por otra semántica.
 */
export function planPriorityClientKeywordsV1(live: Keyword[]): PolicyPlan {
  const ops: PolicyOp[] = [];
  const conflicts: string[] = [];
  const byClient = emptyByClient();
  const claimed = new Set<string>();

  for (const desired of POLICY_ENSURE_ROWS) {
    if (!isPolicyClient(desired.cliente_id)) {
      conflicts.push(`${desired.keyword_id}: cliente fuera de política (${desired.cliente_id})`);
      continue;
    }
    const byId = findById(live, desired.keyword_id);
    const bySem = findByClientKeyword(live, desired.cliente_id, desired.keyword);

    if (byId && bySem && byId.keyword_id !== bySem.keyword_id) {
      conflicts.push(
        `${desired.keyword_id}: colisión semántica con ${bySem.keyword_id} (${bySem.keyword})`,
      );
      continue;
    }
    if (byId && byId.cliente_id && byId.cliente_id !== desired.cliente_id) {
      conflicts.push(
        `${desired.keyword_id}: ID pertenece a ${byId.cliente_id}, política pide ${desired.cliente_id}`,
      );
      continue;
    }
    if (
      byId &&
      foldText(byId.keyword).trim() !== foldText(desired.keyword).trim() &&
      desired.keyword_id !== 'KEY-0064'
    ) {
      // KEY-0064 se renombra IEPS alcohol → IEPS bebidas alcohólicas a propósito.
      const allowRename = desired.keyword_id === 'KEY-0064';
      if (!allowRename) {
        conflicts.push(
          `${desired.keyword_id}: LIVE keyword "${byId.keyword}" ≠ política "${desired.keyword}"`,
        );
        continue;
      }
    }

    const existing = byId ?? bySem ?? null;
    if (existing && claimed.has(existing.keyword_id) && existing.keyword_id !== desired.keyword_id) {
      conflicts.push(`${desired.keyword_id}: reutilización ambigua de ${existing.keyword_id}`);
      continue;
    }

    const targetId = existing?.keyword_id ?? desired.keyword_id;
    const desiredFixed: Keyword = { ...desired, keyword_id: targetId };
    claimed.add(targetId);

    if (!existing) {
      ops.push({
        action: 'CREATE',
        keyword_id: targetId,
        cliente_id: desired.cliente_id,
        keyword: desired.keyword,
        desired: desiredFixed,
        live: null,
        changed_fields: [...KEYWORD_POLICY_FIELDS],
      });
      continue;
    }

    const merged: Keyword = {
      ...existing,
      ...desiredFixed,
      keyword_id: existing.keyword_id,
    };
    const changed = diffKeywordFields(existing, merged);
    ops.push({
      action: changed.length === 0 ? 'UNCHANGED' : 'UPDATE',
      keyword_id: existing.keyword_id,
      cliente_id: desired.cliente_id,
      keyword: merged.keyword,
      desired: merged,
      live: existing,
      changed_fields: changed,
    });
  }

  for (const id of POLICY_DEACTIVATE_IDS) {
    const existing = findById(live, id);
    if (!existing) {
      conflicts.push(`${id}: no existe LIVE; no se crea "Patrón" sola`);
      continue;
    }
    if (!isPolicyClient(existing.cliente_id)) {
      conflicts.push(`${id}: cliente ${existing.cliente_id} fuera de política`);
      continue;
    }
    const desired: Keyword = {
      ...existing,
      activa: false,
      notas: existing.notas?.includes(POLICY_NOTE)
        ? existing.notas
        : `${existing.notas ? `${existing.notas} | ` : ''}${POLICY_NOTE}: desactivada. "Patrón" sola no es suficiente.`,
    };
    const changed = diffKeywordFields(existing, desired);
    ops.push({
      action: existing.activa === false && changed.length === 0 ? 'UNCHANGED' : 'DEACTIVATE',
      keyword_id: id,
      cliente_id: existing.cliente_id ?? 'CLI-0002',
      keyword: existing.keyword,
      desired,
      live: existing,
      changed_fields: changed,
    });
  }

  for (const op of ops) {
    const bucket = byClient[op.cliente_id];
    if (!bucket) continue;
    bucket[op.action].push(op);
  }

  return {
    ops,
    byClient,
    conflicts,
    policy_ids: [...new Set(ops.map((o) => o.keyword_id))],
  };
}

export const SUGGESTED_KEYWORDS_NOT_APPLIED: Record<PolicyClientId, string[]> = {
  'CLI-MERY-TEST': [
    'diputada federal Mery Pozos',
    'diputada federal Merilyn Gómez Pozos (ya existe KEY-0047)',
    'alcaldesa Mery Pozos',
    'Morena Guadalajara Mery',
    'SIAPA Mery Pozos',
    'precandidata Mery Pozos',
    'Merilyn Gómez diputada federal',
  ],
  'CLI-0001': [
    'Valle Redondo',
    'Ami Jumex',
    'néctares Jumex',
    'Grupo Jumex (ya alias KEY-0001)',
    'COFEPRIS jugos',
    'sello octágono bebidas',
    'impuesto IEPS jugos',
  ],
  'CLI-0002': [
    'John Paul DeJoria',
    'Patrón Añejo',
    'destilería Patrón',
    'Bacardí Limited',
    'NOM tequila Patrón',
    'agave Patrón',
    'cristalino Patrón',
  ],
};

export function assertPlanSafe(plan: PolicyPlan): void {
  if (plan.conflicts.length > 0) {
    throw new Error(`KEYWORD_POLICY_CONFLICT:\n${plan.conflicts.join('\n')}`);
  }
  for (const op of plan.ops) {
    if (!isPolicyClient(op.cliente_id)) {
      throw new Error(`KEYWORD_POLICY_CONFLICT: op fuera de clientes ${op.keyword_id}`);
    }
  }
}

export function summarizePlan(plan: PolicyPlan): Record<string, Record<PolicyAction, string[]>> {
  const out: Record<string, Record<PolicyAction, string[]>> = {};
  for (const [cid, bucket] of Object.entries(plan.byClient)) {
    out[cid] = {
      CREATE: bucket.CREATE.map((o) => `${o.keyword_id} ${o.keyword}`),
      UPDATE: bucket.UPDATE.map((o) => `${o.keyword_id} ${o.keyword} [${o.changed_fields.join(',')}]`),
      DEACTIVATE: bucket.DEACTIVATE.map((o) => `${o.keyword_id} ${o.keyword}`),
      UNCHANGED: bucket.UNCHANGED.map((o) => `${o.keyword_id} ${o.keyword}`),
    };
  }
  return out;
}
