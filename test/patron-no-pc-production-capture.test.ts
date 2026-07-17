/**
 * Tests del orquestador `run-patron-no-pc-production-capture.ts` (parseArgs) y
 * del workflow manual `.github/workflows/patron-no-pc-capture.yml`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs, windowFlag } from '../scripts/run-patron-no-pc-production-capture.js';

describe('parseArgs (orquestador Patrón no-PC)', () => {
  it('default: sin --output=sheet, dryRun=true SIEMPRE (aunque no se pase --dry-run explícito)', () => {
    const args = parseArgs(['--window-hours=24']);
    expect(args.dryRun).toBe(true);
    expect(args.output).toBe('console');
  });

  it('con --output=sheet explícito (sin --dry-run), dryRun=false', () => {
    const args = parseArgs(['--output=sheet']);
    expect(args.dryRun).toBe(false);
  });

  it('--dry-run explícito fuerza dryRun=true incluso con --output=sheet', () => {
    const args = parseArgs(['--output=sheet', '--dry-run']);
    expect(args.dryRun).toBe(true);
  });

  it('allowFinalSheet default es false', () => {
    expect(parseArgs([]).allowFinalSheet).toBe(false);
  });

  it('allowFinalSheet solo se activa con --allow-final-sheet=true explícito', () => {
    expect(parseArgs(['--allow-final-sheet=true']).allowFinalSheet).toBe(true);
    expect(parseArgs(['--allow-final-sheet=false']).allowFinalSheet).toBe(false);
    expect(parseArgs(['--allow-final-sheet=yes']).allowFinalSheet).toBe(true);
  });

  it('maxRows y maxInserts tienen defaults seguros (300 y 100)', () => {
    const args = parseArgs([]);
    expect(args.maxRows).toBe(300);
    expect(args.maxInserts).toBe(100);
  });

  it('acepta --max-rows y --max-inserts explícitos', () => {
    const args = parseArgs(['--max-rows=50', '--max-inserts=10']);
    expect(args.maxRows).toBe(50);
    expect(args.maxInserts).toBe(10);
  });

  it('acepta --window-days como alternativa a --window-hours', () => {
    const args = parseArgs(['--window-days=7']);
    expect(args.windowDays).toBe(7);
    expect(args.windowHours).toBeUndefined();
  });
});

describe('windowFlag', () => {
  it('usa --window-hours si está definido', () => {
    expect(windowFlag(parseArgs(['--window-hours=48']))).toBe('--window-hours=48');
  });

  it('usa --window-days si está definido y no hay window-hours', () => {
    expect(windowFlag(parseArgs(['--window-days=7']))).toBe('--window-days=7');
  });

  it('default --window-hours=24 si no se especifica ninguno', () => {
    expect(windowFlag(parseArgs([]))).toBe('--window-hours=24');
  });
});

describe('workflow patron-no-pc-capture.yml (schedule cada 2h + workflow_dispatch manual)', () => {
  const wf = readFileSync(
    join(process.cwd(), '.github/workflows/patron-no-pc-capture.yml'),
    'utf-8',
  );

  it('tiene workflow_dispatch Y schedule cada 2h (activado 2026-07-17 por autorización explícita)', () => {
    expect(wf).toContain('workflow_dispatch');
    expect(wf).toMatch(/schedule:/);
    expect(wf).toContain("cron: '0 */2 * * *'");
  });

  it('el guard de github.event_name fuerza real SOLO en schedule (dry_run=false, output_sheet=true, allow_final_sheet=true)', () => {
    expect(wf).toContain(`github.event_name`);
    expect(wf).toMatch(/"\$\{\{ github\.event_name \}\}"\s*=\s*"schedule"/);
    const bloqueSchedule = wf.slice(wf.indexOf('if [ "${{ github.event_name }}" = "schedule" ]'), wf.indexOf('else'));
    expect(bloqueSchedule).toContain('DRYRUN="false"');
    expect(bloqueSchedule).toContain('OUTPUT="true"');
    expect(bloqueSchedule).toContain('ALLOWFINAL="true"');
  });

  it('el workflow_dispatch manual sigue con sus defaults seguros (rama else, inputs.*)', () => {
    const elseIdx = wf.indexOf('else\n');
    const fiIdx = wf.indexOf('\n          fi\n', elseIdx);
    const bloqueElse = wf.slice(elseIdx, fiIdx);
    expect(bloqueElse).toContain("github.event.inputs.dry_run || 'true'");
    expect(bloqueElse).toContain("github.event.inputs.output_sheet || 'false'");
    expect(bloqueElse).toContain("github.event.inputs.allow_final_sheet || 'false'");
  });

  it('default dry_run=true', () => {
    expect(wf).toMatch(/dry_run:[\s\S]*?default:\s*'true'/);
  });

  it('default output_sheet=false', () => {
    expect(wf).toMatch(/output_sheet:[\s\S]*?default:\s*'false'/);
  });

  it('default allow_final_sheet=false', () => {
    expect(wf).toMatch(/allow_final_sheet:[\s\S]*?default:\s*'false'/);
  });

  it('siempre pasa --no-send --no-whatsapp --no-email', () => {
    expect(wf).toContain('--no-send');
    expect(wf).toContain('--no-whatsapp');
    expect(wf).toContain('--no-email');
  });

  it('NO contiene flags/acciones de producción prohibidas (fuera de comentarios)', () => {
    // Excluye líneas de comentario ('#'), que documentan a propósito qué NO se hace.
    const codigo = wf.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    expect(codigo).not.toMatch(/--send\b/);
    expect(codigo).not.toMatch(/--whatsapp\b/);
    expect(codigo).not.toMatch(/--email\b(?!.*no-email)/);
    expect(codigo).not.toMatch(/twilio|smtp|gmail/i);
    expect(codigo).not.toContain('classify-ia');
    expect(codigo).not.toContain('generate-xml');
    expect(codigo).not.toContain('export-results');
    expect(codigo).not.toContain('export-raw-news');
  });

  it('usa el script patron:no-pc:capture', () => {
    expect(wf).toContain('npm run patron:no-pc:capture');
  });
});
