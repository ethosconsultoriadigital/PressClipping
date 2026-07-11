/**
 * Tests para el comportamiento de --dry-run en shadow-alerts.
 *
 * Verifica que --dry-run fuerce output=console (no escribe en 10_Alertas_Sombra)
 * y que --observe-only tenga precedencia sobre --dry-run.
 *
 * La lógica se extrae inline del script para no importar efectos secundarios.
 */
import { describe, it, expect } from 'vitest';

// ─── Replica mínima de parseArgs (lógica de output) ─────────────────────────
// Corresponde al bloque de resolución de `output` en run-shadow-alerts.ts.

type Output = 'console' | 'sheet';

function resolveOutput(argv: string[]): Output {
  let output: Output = 'sheet'; // default
  let observeOnly = false;
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2).split('=')[0];
    const val = arg.slice(2).split('=')[1] ?? '';
    if (key === 'output') output = (val as Output) || output;
    if (key === 'observe-only') observeOnly = true;
  }
  // Fix aplicado: --dry-run fuerza output=console (a menos que observe-only gane).
  if (!observeOnly && argv.some((a) => a === '--dry-run')) output = 'console';
  if (observeOnly) output = 'sheet';
  return output;
}

describe('shadow-alerts: resolución de output según flags', () => {
  it('sin flags, output default es sheet', () => {
    expect(resolveOutput([])).toBe('sheet');
  });

  it('--output=console sobreescribe el default', () => {
    expect(resolveOutput(['--output=console'])).toBe('console');
  });

  it('--output=sheet permanece sheet', () => {
    expect(resolveOutput(['--output=sheet'])).toBe('sheet');
  });

  it('--dry-run solo fuerza output=console (no escribe en 10_Alertas_Sombra)', () => {
    expect(resolveOutput(['--dry-run'])).toBe('console');
  });

  it('--dry-run con --no-send fuerza output=console', () => {
    expect(resolveOutput(['--dry-run', '--no-send', '--no-whatsapp', '--no-email'])).toBe('console');
  });

  it('--dry-run con --shadow-client-allowlist fuerza output=console', () => {
    expect(resolveOutput(['--shadow-client-allowlist=CLI-MERY-TEST', '--dry-run'])).toBe('console');
  });

  it('--observe-only fuerza output=sheet (siempre escribe a 10)', () => {
    expect(resolveOutput(['--observe-only'])).toBe('sheet');
  });

  it('--observe-only tiene precedencia sobre --dry-run', () => {
    expect(resolveOutput(['--observe-only', '--dry-run'])).toBe('sheet');
  });

  it('--dry-run con --output=sheet explícito: --dry-run gana (fuerza console)', () => {
    // El usuario pasó ambos -- dry-run es la intención de no escribir.
    expect(resolveOutput(['--output=sheet', '--dry-run'])).toBe('console');
  });
});

// ─── Invariante de seguridad: output=sheet NUNCA cuando --dry-run ────────────
describe('shadow-alerts: invariante dry-run seguro', () => {
  const casosConDryRun = [
    ['--dry-run'],
    ['--dry-run', '--no-send'],
    ['--dry-run', '--no-send', '--no-whatsapp', '--no-email'],
    ['--shadow-client-allowlist=CLI-MERY-TEST', '--dry-run'],
    ['--window-hours=24', '--dry-run', '--no-email'],
  ];

  for (const argv of casosConDryRun) {
    it(`no escribe Sheet cuando: ${argv.join(' ')}`, () => {
      const output = resolveOutput(argv);
      expect(output).toBe('console');
    });
  }
});

// ─── Casos donde SÍ debe escribir en Sheet ───────────────────────────────────
describe('shadow-alerts: output=sheet cuando se espera', () => {
  it('modo normal (sin --dry-run) escribe a sheet', () => {
    expect(resolveOutput(['--no-send'])).toBe('sheet');
  });

  it('--observe-only escribe siempre a sheet', () => {
    expect(resolveOutput(['--observe-only', '--no-send'])).toBe('sheet');
  });

  it('workflow tier escribe a sheet', () => {
    expect(resolveOutput(['--workflow-label=test', '--no-send'])).toBe('sheet');
  });
});
