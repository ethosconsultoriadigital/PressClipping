/**
 * Tests del TIER DAILY VALIDATED sombra:
 *   - dedupe estructural: net-new excluye medios ya cubiertos (base/nacional B/crisis).
 *   - no incluye boilerplate (MED-0118 El Respetable).
 *   - gate detect real: flood/sinTexto bloquean; limpio pasa; respeta max_notas.
 *   - workflow existe, comparte concurrency, cron diario :45, sin flags de envío.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SHADOW_MEDIOS,
  SHADOW_MEDIOS_NACIONALES_B,
  SHADOW_MEDIOS_CRISIS,
  SHADOW_MEDIOS_DAILY_VALIDATED,
  mediosDailyValidatedActivos,
  mediosDailyNetNew,
  mediosYaCubiertosPorCron,
} from '../src/config/shadowMedia.js';
import { evaluarGateDaily } from '../src/matching/shadowDailyGate.js';

describe('config Tier Daily Validated — dedupe', () => {
  it('la lista contiene Zeta (MED-0083) y Revista Espejo (MED-0066)', () => {
    const ids = SHADOW_MEDIOS_DAILY_VALIDATED.map((m) => m.medio_id).sort();
    expect(ids).toEqual(['MED-0066', 'MED-0083']);
  });

  it('NO incluye boilerplate MED-0118 (El Respetable)', () => {
    expect(SHADOW_MEDIOS_DAILY_VALIDATED.map((m) => m.medio_id)).not.toContain('MED-0118');
  });

  it('net-new excluye cualquier medio ya cubierto por base/nacional B/crisis', () => {
    const cubiertos = mediosYaCubiertosPorCron();
    for (const m of mediosDailyNetNew()) {
      expect(cubiertos.has(m.medio_id)).toBe(false);
    }
  });

  it('los 5 estables ya en cron base NO se agregan al daily-validated', () => {
    // La Crónica, Hidrocálido, Zócalo, EdoMex, Vanguardia están en SHADOW_MEDIOS.
    for (const id of ['MED-0154', 'MED-0166', 'MED-0153', 'MED-0148', 'MED-0155']) {
      expect(SHADOW_MEDIOS).toContain(id);
      expect(mediosDailyNetNew().map((m) => m.medio_id)).not.toContain(id);
    }
  });

  it('net-new actual = Zeta + Revista Espejo (ambos net-new)', () => {
    expect(mediosDailyNetNew().map((m) => m.medio_id).sort()).toEqual(['MED-0066', 'MED-0083']);
  });

  it('respeta max_notas por medio (<=30) y fuente auto', () => {
    for (const m of mediosDailyValidatedActivos()) {
      expect(m.max_notas_shadow).toBeLessThanOrEqual(30);
      expect(m.fuente).toBe('auto');
    }
  });

  it('ningún medio del daily-validated colisiona con nacional B ni crisis', () => {
    const nb = new Set(SHADOW_MEDIOS_NACIONALES_B.map((m) => m.medio_id));
    const cr = new Set(SHADOW_MEDIOS_CRISIS.map((m) => m.medio_id));
    for (const m of SHADOW_MEDIOS_DAILY_VALIDATED) {
      expect(nb.has(m.medio_id)).toBe(false);
      expect(cr.has(m.medio_id)).toBe(false);
    }
  });
});

describe('evaluarGateDaily — gate de detect real', () => {
  it('pasa con dry-run limpio y volumen bajo', () => {
    expect(evaluarGateDaily({ detectCode: 0, sinTexto: 0, potenciales: 6 })).toEqual({ pasa: true, motivo: 'gate_ok' });
  });

  it('bloquea si el dry-run falló (code != 0)', () => {
    expect(evaluarGateDaily({ detectCode: 1, sinTexto: 0, potenciales: 2 }).pasa).toBe(false);
  });

  it('bloquea si hay notas sin texto', () => {
    const r = evaluarGateDaily({ detectCode: 0, sinTexto: 3, potenciales: 2 });
    expect(r.pasa).toBe(false);
    expect(r.motivo).toBe('hay_notas_sin_texto');
  });

  it('bloquea flood de potenciales (>100)', () => {
    const r = evaluarGateDaily({ detectCode: 0, sinTexto: 0, potenciales: 150 });
    expect(r.pasa).toBe(false);
    expect(r.motivo).toMatch(/flood_potenciales/);
  });

  it('bloquea flood por keyword (una keyword acapara el lote)', () => {
    const r = evaluarGateDaily({
      detectCode: 0, sinTexto: 0, potenciales: 20,
      porKeyword: { trabajadores: 18, sindicato: 2 },
    });
    expect(r.pasa).toBe(false);
    expect(r.motivo).toMatch(/flood_keyword/);
  });

  it('bloquea flood por medio (un medio acapara el lote)', () => {
    const r = evaluarGateDaily({
      detectCode: 0, sinTexto: 0, potenciales: 20,
      porMedio: { 'Zeta Tijuana': 19, 'Revista Espejo': 1 },
    });
    expect(r.pasa).toBe(false);
    expect(r.motivo).toMatch(/flood_medio/);
  });

  it('no evalúa flood con volumen mínimo (< umbral)', () => {
    const r = evaluarGateDaily({
      detectCode: 0, sinTexto: 0, potenciales: 4,
      porKeyword: { trabajadores: 4 },
    });
    expect(r.pasa).toBe(true);
  });

  it('sinTexto undefined no bloquea (dato no reportado)', () => {
    expect(evaluarGateDaily({ detectCode: 0, sinTexto: undefined, potenciales: 5 }).pasa).toBe(true);
  });
});

describe('workflow daily-validated sombra', () => {
  const wf = readFileSync(
    join(process.cwd(), '.github/workflows/live-comparison-shadow-daily-validated.yml'),
    'utf-8',
  );

  it('comparte el grupo de concurrency del shadow base', () => {
    expect(wf).toMatch(/group:\s*live-comparison-shadow\b/);
    expect(wf).toMatch(/cancel-in-progress:\s*false/);
  });

  it('cron diario al minuto 45 (12:45 UTC) y workflow_dispatch presente', () => {
    expect(wf).toContain("cron: '45 12 * * *'");
    expect(wf).toContain('workflow_dispatch');
  });

  it('usa shadow-daily-validated-tier con flags de seguridad', () => {
    expect(wf).toContain('npm run shadow-daily-validated-tier');
    expect(wf).toContain('--no-export-results');
    expect(wf).toContain('--no-generate-xml');
    expect(wf).toContain('--max-notas=30');
  });

  it('NO contiene flags de envío real ni acciones de producción', () => {
    const cmd = wf.slice(wf.indexOf('npm run shadow-daily-validated-tier'));
    expect(cmd).toContain('--no-send');
    expect(cmd).toContain('--no-whatsapp');
    expect(cmd).toContain('--no-email');
    expect(cmd).not.toMatch(/--send\b/);
    expect(cmd).not.toMatch(/--whatsapp\b/);
    expect(cmd).not.toMatch(/--email\b/);
    expect(cmd).not.toMatch(/twilio|smtp|gmail/i);
    expect(cmd).not.toMatch(/(?<!no-)\bexport-results\b/);
    expect(cmd).not.toMatch(/(?<!no-)\bgenerate-xml\b/);
    expect(cmd).not.toContain('classify-ia');
    expect(cmd).not.toContain('export-raw-news');
  });
});
