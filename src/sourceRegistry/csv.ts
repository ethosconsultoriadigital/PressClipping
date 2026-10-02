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

const NAME_KEYS = ['name', 'nombre_fuente', 'nombre', 'canonical_name', 'medio', 'fuente', 'display_name'];
const URL_KEYS = ['url', 'url_base', 'canonical_url', 'sitio', 'website'];
const DOMAIN_KEYS = ['domain', 'dominio', 'host', 'hostname'];
const ESTADO_KEYS = ['estado', 'entidad', 'state'];
const MUN_KEYS = ['municipios_o_cobertura', 'municipio', 'alcaldia', 'city'];
const CAT_KEYS = ['categoria', 'category', 'vertical', 'tipo'];
const KIND_KEYS = ['source_kind', 'kind', 'tipo_fuente'];
const FB_KEYS = ['facebook', 'facebook_url', 'fb'];
const NOTES_KEYS = ['notes', 'notas', 'observaciones'];
const RECENT_KEYS = ['sample_30d', 'muestra_30d', 'within_30d', 'reciente', 'actividad_documentada'];

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

function inferTier(fileLabel: string, recent: boolean): EvidenceTier {
  if (recent || /muestra_30d|con_muestra/i.test(fileLabel)) return 'RECENT_30D';
  if (/cobertura|directorio|32_entidades/i.test(fileLabel)) return 'DIRECTORY';
  return 'PRIMARY';
}

function inferBatch(fileLabel: string): string {
  if (/acumulad/i.test(fileLabel)) return 'V2_V3';
  if (/v3/i.test(fileLabel)) return 'V3';
  if (/v2/i.test(fileLabel)) return 'V2';
  return 'UNKNOWN';
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
    const recent = truthy(pick(rec, RECENT_KEYS));
    rows.push({
      name,
      url: pick(rec, URL_KEYS),
      domain: pick(rec, DOMAIN_KEYS),
      estado: pick(rec, ESTADO_KEYS),
      municipio: pick(rec, MUN_KEYS),
      categoria: pick(rec, CAT_KEYS),
      source_kind_hint: pick(rec, KIND_KEYS),
      evidence_tier: inferTier(fileLabel, recent),
      astra_batch: inferBatch(fileLabel),
      sample_within_30d: recent || inferTier(fileLabel, recent) === 'RECENT_30D',
      notes: pick(rec, NOTES_KEYS),
      facebook_url: pick(rec, FB_KEYS),
    });
  }
  return rows;
}

export function loadAstraCsvFile(path: string): AstraCandidateRow[] {
  if (!existsSync(path)) return [];
  return parseAstraCsv(readFileSync(path, 'utf8'), path.replace(/\\/g, '/').split('/').pop() ?? path);
}
