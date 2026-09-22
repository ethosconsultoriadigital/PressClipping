/**
 * Upsert dirigido de filas en 02_Keywords por keyword_id.
 *
 * No borra, no reordena, no toca otros clientes ni otras tabs.
 * Si el keyword_id existe, actualiza celdas de esa fila.
 * Si no existe, append.
 */
import type { GoogleSpreadsheet } from 'google-spreadsheet';
import { withSheetsRetry, SHEET_TABS } from './client.js';
import { normalizeHeader } from '../utils/parse.js';
import { KEYWORD_POLICY_FIELDS } from '../config/priorityClientKeywordsV1.js';
import type { Keyword } from '../types/schemas.js';

export type KeywordSheetCells = Record<string, string>;

export interface KeywordSheetPort {
  readByIds(ids: string[]): Promise<Map<string, KeywordSheetCells>>;
  upsert(rows: Keyword[]): Promise<{ updated: string[]; appended: string[] }>;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

export function keywordToSheetCells(row: Keyword): KeywordSheetCells {
  const out: KeywordSheetCells = {};
  for (const f of KEYWORD_POLICY_FIELDS) {
    out[f] = formatCell(row[f]);
  }
  return out;
}

export function googleKeywordSheetPort(doc: GoogleSpreadsheet): KeywordSheetPort {
  const title = SHEET_TABS.KEYWORDS;
  return {
    async readByIds(ids) {
      const sheet = doc.sheetsByTitle[title];
      if (!sheet) throw new Error(`Pestaña ausente: ${title}`);
      await withSheetsRetry(() => sheet.loadHeaderRow(), `loadHeaderRow ${title}`);
      const rows = await withSheetsRetry(() => sheet.getRows(), `getRows ${title}`);
      const want = new Set(ids);
      const out = new Map<string, KeywordSheetCells>();
      for (const row of rows) {
        const id = String(row.get('keyword_id') ?? '').trim();
        if (!id || !want.has(id)) continue;
        const cells: KeywordSheetCells = {};
        for (const raw of sheet.headerValues) {
          cells[normalizeHeader(raw)] = String(row.get(raw) ?? '');
        }
        out.set(id, cells);
      }
      return out;
    },
    async upsert(policyRows) {
      const sheet = doc.sheetsByTitle[title];
      if (!sheet) throw new Error(`Pestaña ausente: ${title}`);
      await withSheetsRetry(() => sheet.loadHeaderRow(), `loadHeaderRow ${title}`);
      const normToRaw = new Map<string, string>();
      for (const raw of sheet.headerValues) {
        normToRaw.set(normalizeHeader(raw), raw);
      }
      const existing = await withSheetsRetry(() => sheet.getRows(), `getRows ${title}`);
      const byId = new Map<string, (typeof existing)[number]>();
      for (const row of existing) {
        const id = String(row.get('keyword_id') ?? '').trim();
        if (id) byId.set(id, row);
      }
      const updated: string[] = [];
      const appended: string[] = [];
      const toAppend: Record<string, string>[] = [];

      for (const kw of policyRows) {
        const cells = keywordToSheetCells(kw);
        const mapped: Record<string, string> = {};
        for (const [key, value] of Object.entries(cells)) {
          const raw = normToRaw.get(normalizeHeader(key));
          if (!raw) continue;
          mapped[raw] = value;
        }
        const found = byId.get(kw.keyword_id);
        if (found) {
          for (const [raw, value] of Object.entries(mapped)) {
            found.set(raw, value);
          }
          await withSheetsRetry(() => found.save(), `save ${kw.keyword_id}`);
          updated.push(kw.keyword_id);
        } else {
          toAppend.push(mapped);
          appended.push(kw.keyword_id);
        }
      }
      if (toAppend.length > 0) {
        await withSheetsRetry(() => sheet.addRows(toAppend), `addRows ${title}`);
      }
      return { updated, appended };
    },
  };
}
