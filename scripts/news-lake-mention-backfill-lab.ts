/**
 * Mention Lab V1 — backfill exhaustivo de menciones desde News Lake.
 *
 * News Lake → candidatos paginados (FTS + ILIKE) → matchKeyword de TODAS
 * las keywords activas → consolidado 1 fila por client_id+noticia_id →
 * tabs LAB en GOOGLE_OUTPUT_SHEET_ID.
 *
 * NO inserta `menciones`. NO marca menciones_procesado. NO alertas.
 * NO toca tabs finales de clientes ni 01_Noticias_Raw…09_Medios_PressClipping.
 *
 *   npm run news-lake:mentions:lab -- --dry-run=true --window-days=30
 *   npm run news-lake:mentions:lab -- --dry-run=false --window-days=30
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import type { GoogleSpreadsheet } from 'google-spreadsheet';
import { getOutputSpreadsheet, withSheetsRetry } from '../src/sheets/client.js';
import { normalizeHeader } from '../src/utils/parse.js';
import { logger } from '../src/utils/logger.js';
import { defaultLabClients, runClientLab } from '../src/newsLake/mentionLabRun.js';
import {
  LAB_TABS,
  LAB_FORBIDDEN_TABS,
  freezeWindow,
  labRunIdFromCutoff,
  assertWriteAllowed,
} from '../src/newsLake/mentionLabCore.js';
import {
  writeMentionLabSheets,
  type LabSheetPort,
  type LabClientBundle,
} from '../src/newsLake/mentionLabSheets.js';

export interface MentionLabArgs {
  dryRun: boolean;
  windowDays: number;
  pageSize?: number;
  safetyLimit?: number;
}

export function parseLabArgs(argv: string[]): MentionLabArgs {
  let dryRun = true;
  let windowDays = 30;
  let pageSize: number | undefined;
  let safetyLimit: number | undefined;
  for (const raw of argv) {
    const [flag, ...rest] = raw.split('=');
    const value = rest.join('=');
    if (flag === '--dry-run') {
      dryRun = value === '' || value === 'true' || value === '1';
      if (value === 'false' || value === '0') dryRun = false;
    } else if (flag === '--window-days') {
      windowDays = Math.max(1, Number.parseInt(value, 10) || 30);
    } else if (flag === '--page-size') {
      pageSize = Math.max(50, Number.parseInt(value, 10) || 400);
    } else if (flag === '--safety-limit') {
      safetyLimit = Math.max(1, Number.parseInt(value, 10) || 50_000);
    }
  }
  return { dryRun, windowDays, pageSize, safetyLimit };
}

function formatValue(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

const APPEND_CHUNK = 200;

export function googleLabPort(doc: GoogleSpreadsheet): LabSheetPort {
  return {
    async ensure(title, headers) {
      if ((LAB_FORBIDDEN_TABS as readonly string[]).includes(title)) {
        throw new Error(`LAB no puede crear/escribir tab prohibida: ${title}`);
      }
      const existing = doc.sheetsByTitle[title];
      if (existing) {
        try {
          await withSheetsRetry(() => existing.loadHeaderRow(), `loadHeaderRow ${title}`);
          if (!existing.headerValues || existing.headerValues.length === 0) {
            await withSheetsRetry(() => existing.setHeaderRow([...headers]), `setHeaderRow ${title}`);
          }
        } catch {
          await withSheetsRetry(() => existing.setHeaderRow([...headers]), `setHeaderRow ${title}`);
        }
        return;
      }
      logger.info({ tab: title }, 'Creando pestaña Mention Lab');
      await withSheetsRetry(
        () => doc.addSheet({ title, headerValues: [...headers] }),
        `addSheet ${title}`,
      );
    },
    async readKeys(title) {
      const sheet = doc.sheetsByTitle[title];
      if (!sheet) return new Set();
      try {
        await withSheetsRetry(() => sheet.loadHeaderRow(), `loadHeaderRow ${title}`);
        const rows = await withSheetsRetry(() => sheet.getRows(), `getRows ${title}`);
        const set = new Set<string>();
        for (const row of rows) {
          const key = String(row.get('dedupe_key') ?? '').trim();
          if (key) set.add(key);
        }
        return set;
      } catch {
        return new Set();
      }
    },
    async append(title, rows) {
      if (rows.length === 0) return 0;
      const sheet = doc.sheetsByTitle[title];
      if (!sheet) throw new Error(`Pestaña LAB ausente: ${title}`);
      await withSheetsRetry(() => sheet.loadHeaderRow(), `loadHeaderRow ${title}`);
      const normToRaw = new Map<string, string>();
      for (const raw of sheet.headerValues) {
        normToRaw.set(normalizeHeader(raw), raw);
      }
      const mapped = rows.map((row) => {
        const out: Record<string, string> = {};
        for (const [key, value] of Object.entries(row)) {
          const rawHeader = normToRaw.get(normalizeHeader(key));
          if (!rawHeader) continue;
          out[rawHeader] = formatValue(value);
        }
        return out;
      });
      let written = 0;
      for (let i = 0; i < mapped.length; i += APPEND_CHUNK) {
        const chunk = mapped.slice(i, i + APPEND_CHUNK);
        await withSheetsRetry(() => sheet.addRows(chunk), `addRows ${title}`);
        written += chunk.length;
      }
      return written;
    },
  };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseLabArgs(argv);
  const started = Date.now();
  const cutoff = new Date().toISOString();
  const window = freezeWindow(cutoff, args.windowDays);
  const labRunId = labRunIdFromCutoff(cutoff);
  const fechaExport = cutoff;
  const clients = defaultLabClients();

  logger.info(
    {
      dry_run: args.dryRun,
      window_days: args.windowDays,
      run_cutoff: window.cutoff,
      window_start: window.windowStart,
      lab_run_id: labRunId,
      clients,
      tabs: Object.values(LAB_TABS),
    },
    '=== Mention Lab backfill start ===',
  );

  const bundles: LabClientBundle[] = [];
  for (const clientId of clients) {
    const t0 = Date.now();
    const outcome = await runClientLab(clientId, cutoff, args.windowDays, {
      pageSize: args.pageSize,
      safetyLimit: args.safetyLimit,
    });
    bundles.push({
      mentions: outcome.mentions,
      metrics: outcome.metrics,
      keywords: outcome.keywords,
    });
    logger.info(
      {
        ...outcome.metrics,
        duration_ms: Date.now() - t0,
        sample: outcome.mentions.slice(0, 20).map((m) => ({
          medio: m.news.medio_nombre,
          fecha: m.news.fecha_publicacion,
          titulo: m.news.titulo,
          url: m.news.url_original,
          keywords: m.matches.map((x) => x.keyword),
          score: m.best.score,
          categoria: m.editorial_category,
          motivo: m.review_reasons.join('|') || m.best.tipo_keyword,
        })),
      },
      `Mention Lab cliente ${clientId}`,
    );
  }

  const gate = assertWriteAllowed(bundles.map((b) => b.metrics));
  const durationMs = Date.now() - started;

  let port: LabSheetPort | undefined;
  if (!args.dryRun && gate.ok) {
    const doc = await getOutputSpreadsheet();
    port = googleLabPort(doc);
  }

  const write = await writeMentionLabSheets(bundles, {
    labRunId,
    fechaExport,
    cutoff: window.cutoff,
    windowDays: args.windowDays,
    dryRun: args.dryRun,
    durationMs,
    port,
  });

  const summary = {
    lab_run_id: labRunId,
    dry_run: args.dryRun,
    complete: Object.fromEntries(bundles.map((b) => [b.metrics.client_id, b.metrics.complete])),
    safety_limit_hit: bundles.some((b) => b.metrics.safety_limit_hit),
    write,
    menciones_db_writes: 0,
    mark_processed_writes: 0,
    alerts: 0,
    duration_ms: durationMs,
  };
  logger.info(summary, '=== Mention Lab backfill done ===');
  console.log(`MENTION_LAB_SUMMARY ${JSON.stringify(summary)}`);

  if (!gate.ok) {
    logger.error({ reason: gate.reason }, 'Mention Lab incompleto; write prohibido');
    return 2;
  }
  return 0;
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().then((code) => {
    if (code !== 0) process.exit(code);
  }).catch((err) => {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en mention lab');
    process.exit(1);
  });
}
