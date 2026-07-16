/**
 * Comando único de producción Patrón (CLI-0002) sin PressClipping.
 *
 * Orquesta el pipeline completo, reutilizando los scripts ya validados (no
 * duplica lógica): detect por cliente → staging raw (tab 11) → consolidado
 * editorial (tab 12) → preview final (tab 13) → escritura aprobada a
 * `NoticiasPatron` + revisión humana interna (tab 15). Cada paso ya es
 * append+dedupe (nunca clear/replace), así que correr esto repetidamente es
 * seguro (segunda corrida sin datos nuevos = 0 filas nuevas en todos lados).
 *
 * SOLO CLI-0002. Nunca toca Jumex, nunca envía nada (email/WhatsApp/Twilio/SMTP),
 * nunca usa classify-ia/generate-xml/export-results.
 *
 * Seguro por default: sin --output=sheet, todo corre en modo reporte (dry-run
 * en cada paso); sin --allow-final-sheet=true, NUNCA escribe en NoticiasPatron
 * aunque se pase --output=sheet (solo escribe tabs internas 11/12/13/15).
 *
 * Uso:
 *   npm run patron:no-pc:capture -- --window-hours=24 --dry-run --max-rows=300
 *   npm run patron:no-pc:capture -- --window-hours=24 --output=sheet --max-rows=300 --allow-final-sheet=true
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { logger } from '../src/utils/logger.js';
import { getTabById } from '../src/sheets/client.js';

const CLIENTE = 'CLI-0002';
const PATRON_FINAL_SHEET_ID = '1dKWAGa_U6AgNSWU8oFbqvmwaLRLV2JHREIg8_M48RaU';
const PATRON_FINAL_TAB = 'NoticiasPatron';

interface Args {
  windowHours?: number;
  windowDays?: number;
  dryRun: boolean;
  output: 'console' | 'sheet';
  maxRows: number;
  maxInserts: number;
  allowFinalSheet: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    dryRun: false, // se resuelve al final: default = true si NO se pasa --output=sheet
    output: 'console',
    maxRows: 300,
    maxInserts: 100,
    allowFinalSheet: false,
  };
  let explicitDryRun = false;
  for (const arg of argv) {
    if (arg === '--dry-run') { out.dryRun = true; explicitDryRun = true; continue; }
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'window-hours') out.windowHours = Number(val) || undefined;
    if (key === 'window-days') out.windowDays = Number(val) || undefined;
    if (key === 'output') out.output = (val as 'console' | 'sheet') || out.output;
    if (key === 'max-rows') out.maxRows = Number(val) || out.maxRows;
    if (key === 'max-inserts') out.maxInserts = Number(val) || out.maxInserts;
    if (key === 'allow-final-sheet') out.allowFinalSheet = /^(true|1|yes|si)$/i.test(val);
    // Confirmaciones de seguridad (no habilitan nada, se aceptan tal cual — nunca hay envío real en este pipeline).
    if (key === 'no-send' || key === 'no-whatsapp' || key === 'no-email') { /* no-op */ }
  }
  // Default seguro: si no se pasó --output=sheet, es dry-run SIEMPRE (aunque no se pasara --dry-run explícito).
  if (!explicitDryRun && out.output !== 'sheet') out.dryRun = true;
  return out;
}

function windowFlag(args: Args): string {
  if (args.windowHours != null) return `--window-hours=${args.windowHours}`;
  if (args.windowDays != null) return `--window-days=${args.windowDays}`;
  return '--window-hours=24';
}

interface StepResult { code: number; jsonLines: Record<string, unknown>[]; }

function runStep(label: string, script: string, args: string[]): Promise<StepResult> {
  return new Promise((resolve, reject) => {
    const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    logger.info({ label, cmd: `npx tsx ${script} ${args.join(' ')}` }, `▶ ${label}`);
    const child = spawn(bin, ['tsx', script, ...args], {
      env: { ...process.env, LOG_FORMAT: process.env['LOG_FORMAT'] ?? 'json' },
      shell: process.platform === 'win32',
    });
    const jsonLines: Record<string, unknown>[] = [];
    let buf = '';
    const handle = (chunk: Buffer, isErr: boolean): void => {
      const text = chunk.toString();
      if (isErr) process.stderr.write(text); else process.stdout.write(text);
      buf += text;
      let nl: number;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line.startsWith('{')) { try { jsonLines.push(JSON.parse(line)); } catch { /* no-op */ } }
      }
    };
    child.stdout.on('data', (c) => handle(c, false));
    child.stderr.on('data', (c) => handle(c, true));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 0, jsonLines }));
  });
}

function findNum(lines: Record<string, unknown>[], field: string): number | undefined {
  for (const l of lines) if (typeof l[field] === 'number') return l[field] as number;
  return undefined;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const win = windowFlag(args);
  const outputFlag = `--output=${args.dryRun ? 'console' : args.output}`;
  const maxRowsFlag = `--max-rows=${args.maxRows}`;

  logger.info(
    { cliente: CLIENTE, ...args, targetSheetId: PATRON_FINAL_SHEET_ID, targetTab: PATRON_FINAL_TAB },
    '=== PATRON NO-PC PRODUCTION CAPTURE (solo CLI-0002, nunca Jumex, sin envíos) ===',
  );

  // ── 1. Auditar acceso a NoticiasPatron (solo lectura, informativo) ──────────
  let accesoTargetOk = false;
  try {
    const tab = await getTabById(PATRON_FINAL_SHEET_ID, PATRON_FINAL_TAB);
    await tab.loadHeaderRow();
    accesoTargetOk = true;
    logger.info({ headers: tab.headerValues.length }, '1. Acceso a NoticiasPatron: OK');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn({ error: msg }, '1. Acceso a NoticiasPatron: BLOQUEADO (se continúa el pipeline; solo se omitirá el paso 6 si no hay acceso)');
  }

  // ── 2. Detección de menciones CLI-0002 (dry-run siempre primero) ────────────
  const dry2 = await runStep('2a. detect-mentions dry-run', 'scripts/detect-mentions.ts', [`--client=${CLIENTE}`, '--dry-run', '--only-with-text']);
  const potenciales = findNum(dry2.jsonLines, 'menciones_potenciales') ?? 0;
  logger.info({ potenciales }, 'Resultado detect-mentions dry-run');

  let mencionesInsertadas = 0;
  if (!args.dryRun && potenciales > 0) {
    const real2 = await runStep('2b. detect-mentions real', 'scripts/detect-mentions.ts', [`--client=${CLIENTE}`, '--only-with-text', `--max-inserts=${args.maxInserts}`]);
    mencionesInsertadas = findNum(real2.jsonLines, 'menciones') ?? 0;
    logger.info({ mencionesInsertadas }, 'detect-mentions real completado (solo CLI-0002)');
  } else {
    logger.info({}, args.dryRun ? '2b. Omitido (modo dry-run global)' : '2b. Omitido (0 menciones potenciales)');
  }

  // ── 3. Staging raw (tab 11) — solo CLI-0002 ─────────────────────────────────
  const paso3 = await runStep('3. staging raw (tab 11)', 'scripts/export-operational-news-no-pc.ts', [`--clients=${CLIENTE}`, win, outputFlag, maxRowsFlag]);

  // ── 4. Consolidado editorial (tab 12) — solo CLI-0002, append (nunca --replace) ──
  const paso4 = await runStep('4. consolidado editorial (tab 12)', 'scripts/export-operational-news-consolidated-no-pc.ts', [`--clients=${CLIENTE}`, win, outputFlag, maxRowsFlag]);

  // ── 5. Preview final Patrón (tab 13) ─────────────────────────────────────────
  const paso5 = await runStep('5. preview final (tab 13)', 'scripts/export-patron-final-preview-no-pc.ts', [win, outputFlag, maxRowsFlag]);

  // ── 6. Escritura aprobada a NoticiasPatron + revisión humana (tab 15) ───────
  let paso6Escritas = 0;
  let paso6Gate: Record<string, unknown> | undefined;
  if (!accesoTargetOk && !args.dryRun && args.output === 'sheet' && args.allowFinalSheet) {
    logger.error({}, '6. Sin acceso a NoticiasPatron: se omite la escritura final (nada escrito). Solicitar acceso al service account.');
  } else {
    const args6 = [
      `--target-sheet-id=${PATRON_FINAL_SHEET_ID}`,
      `--target-tab=${PATRON_FINAL_TAB}`,
      `--allow-final-sheet=${args.allowFinalSheet}`,
      outputFlag,
      maxRowsFlag,
    ];
    if (args.dryRun) args6.push('--dry-run');
    const paso6 = await runStep('6. escritura aprobada + revisión humana', 'scripts/export-patron-final-approved-no-pc.ts', args6);
    paso6Escritas = findNum(paso6.jsonLines, 'filas_escritas') ?? 0;
    paso6Gate = paso6.jsonLines.find((l) => 'ready_to_write' in l);
  }

  // ── 9. Resumen de operación ──────────────────────────────────────────────────
  logger.info(
    {
      cliente: CLIENTE,
      modo: args.dryRun ? 'DRY_RUN' : 'REAL',
      acceso_noticias_patron: accesoTargetOk,
      menciones_potenciales: potenciales,
      menciones_insertadas: mencionesInsertadas,
      paso3_codigo: paso3.code,
      paso4_codigo: paso4.code,
      paso5_codigo: paso5.code,
      filas_escritas_noticias_patron: paso6Escritas,
      gate_final: paso6Gate,
      jumex_tocado: false,
      envios_realizados: false,
    },
    '=== RESUMEN — Patrón no-PC production capture completado ===',
  );
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((e) => { console.error(e); process.exit(1); });
}

export { parseArgs, windowFlag };
