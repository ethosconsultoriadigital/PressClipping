import { readFileSync, existsSync } from 'node:fs';
import type { AstraCandidateRow, EvidenceTier } from './types.js';

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else q = !q;
    } else if (ch === ',' && !q) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function normHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

const NAME_KEYS = [
  'nombre_fuente',
  'name',
  'nombre',
  'canonical_name',
  'medio',
  'fuente',
  'display_name',
];
const URL_KEYS = ['canonical_url', 'url', 'url_base', 'sitio', 'website'];
const DOMAIN_KEYS = ['domain', 'dominio', 'host', 'hostname', 'canonical_key'];
const ESTADO_KEYS = ['estado', 'entidad', 'state'];
const MUN_KEYS = ['municipios_o_cobertura', 'municipio', 'alcaldia', 'city'];
const CAT_KEYS = ['categoria', 'category', 'vertical', 'tipo'];
const KIND_KEYS = ['source_kind', 'kind', 'tipo_fuente'];
const ORIGIN_KEYS = ['content_origin', 'origen'];
const FB_KEYS = ['facebook', 'facebook_url', 'fb'];
const NOTES_KEYS = ['notes', 'notas', 'observaciones'];
const RECENT_KEYS = [
  'activity_30d_confirmed',
  'sample_30d',
  'muestra_30d',
  'within_30d',
  'reciente',
];

function pick(row: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (v && v.trim()) return v.trim();
  }
  return null;
}

function truthy(v: string | null): boolean {
  if (!v) return false;
  return /^(1|true|si|yes|y|x|confirmed_30d)$/i.test(v.trim());
}

export function isRecentActivity(rec: Record<string, string>): boolean {
  if (truthy(pick(rec, RECENT_KEYS))) return true;
  const act = (pick(rec, ['actividad_documentada']) ?? '').toUpperCase();
  return /CONFIRMED_30D|MUESTRA_30D|ACTIVITY_30D/.test(act);
}

export function evidenceRank(t: EvidenceTier): number {
  if (t === 'RECENT_30D') return 3;
  if (t === 'PRIMARY') return 2;
  return 1;
}

function inferTier(fileLabel: string, rec: Record<string, string>, recent: boolean): EvidenceTier {
  if (recent) return 'RECENT_30D';
  const level = pick(rec, ['evidence_level', 'evidence_tier']) ?? '';
  if (/recent|30d/i.test(level)) return 'RECENT_30D';
  if (/director/i.test(level)) return 'DIRECTORY';
  if (/primary/i.test(level)) return 'PRIMARY';
  if (/cobertura|directorio|32_entidades/i.test(fileLabel)) return 'DIRECTORY';
  return 'PRIMARY';
}

function inferBatch(fileLabel: string): string {
  if (/acumulad/i.test(fileLabel)) return 'V2_V3';
  if (/v3/i.test(fileLabel)) return 'V3';
  if (/v2/i.test(fileLabel)) return 'V2';
  return 'UNKNOWN';
}

function emptyMeta(): Omit<
  AstraCandidateRow,
  'name' | 'evidence_tier' | 'astra_batch' | 'sample_within_30d'
> {
  return {
    url: null,
    domain: null,
    estado: null,
    municipio: null,
    categoria: null,
    source_kind_hint: null,
    content_origin_hint: null,
    notes: null,
    facebook_url: null,
    candidate_id: null,
    canonical_key: null,
    sample_url: null,
    sample_date: null,
    evidence_level: null,
    evidence_urls: null,
    estado_revision: null,
    capture_feasibility: null,
    technical_probe_status: null,
    platform_hint: null,
    status: null,
    has_website: null,
    social_only: null,
  };
}

export function parseAstraCsv(text: string, fileLabel: string): AstraCandidateRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]!).map(normHeader);
  const rows: AstraCandidateRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      rec[h] = cols[i] ?? '';
    });
    const name = pick(rec, NAME_KEYS);
    if (!name) continue;
    const recent = isRecentActivity(rec);
    rows.push({
      ...emptyMeta(),
      name,
      url: pick(rec, URL_KEYS),
      domain: pick(rec, DOMAIN_KEYS),
      estado: pick(rec, ESTADO_KEYS),
      municipio: pick(rec, MUN_KEYS),
      categoria: pick(rec, CAT_KEYS),
      source_kind_hint: pick(rec, KIND_KEYS),
      content_origin_hint: pick(rec, ORIGIN_KEYS),
      evidence_tier: inferTier(fileLabel, rec, recent),
      astra_batch: inferBatch(fileLabel),
      sample_within_30d: recent,
      notes: pick(rec, NOTES_KEYS),
      facebook_url: pick(rec, FB_KEYS),
      candidate_id: pick(rec, ['candidate_id']),
      canonical_key: pick(rec, ['canonical_key']),
      sample_url: pick(rec, ['sample_url']),
      sample_date: pick(rec, ['sample_date']),
      evidence_level: pick(rec, ['evidence_level']),
      evidence_urls: pick(rec, ['evidence_urls']),
      estado_revision: pick(rec, ['estado_revision']),
      capture_feasibility: pick(rec, ['capture_feasibility']),
      technical_probe_status: pick(rec, ['technical_probe_status']),
      platform_hint: pick(rec, ['platform']),
      status: pick(rec, ['status']),
      has_website: pick(rec, ['has_website']) == null ? null : truthy(pick(rec, ['has_website'])),
      social_only: pick(rec, ['social_only']) == null ? null : truthy(pick(rec, ['social_only'])),
    });
  }
  return rows;
}

export function countAstraDataRows(text: string): number {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return Math.max(0, lines.length - 1);
}

export function loadAstraCsvFile(path: string): AstraCandidateRow[] {
  if (!existsSync(path)) return [];
  return parseAstraCsv(readFileSync(path, 'utf8'), path.replace(/\\/g, '/').split('/').pop() ?? path);
}

export function loadAstraCsvRowCount(path: string): number {
  if (!existsSync(path)) return 0;
  return countAstraDataRows(readFileSync(path, 'utf8'));
}
