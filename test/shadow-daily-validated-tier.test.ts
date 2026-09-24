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
  SHADOW_MEDIOS_DAILY_VALIDATED_B,
  SHADOW_MEDIOS_DAILY_VALIDATED_C,
  IDS_DAILY_VALIDATED_B,
  IDS_DAILY_VALIDATED_C,
  configDailyValidated,
  mediosDailyValidatedActivos,
  mediosDailyValidatedTodosActivos,
  mediosDailyNetNew,
  mediosYaCubiertosPorCron,
  mediosEnCualquierCron,
  parseDailyValidatedShard,
  solapesEntreDailyShards,
  solapesDailyVsOtrosCrons,
  describirSolapeDailyShard,
} from '../src/config/shadowMedia.js';
import { evaluarGateDaily } from '../src/matching/shadowDailyGate.js';

const IDS_ESPERADOS = [
  'MED-0005', 'MED-0006', 'MED-0012', 'MED-0028', 'MED-0049', 'MED-0055', 'MED-0066', 'MED-0083', 'MED-0084',
  'MED-0172', 'MED-0173',
  'MED-0174', 'MED-0175', 'MED-0176', 'MED-0177', 'MED-0178', 'MED-0179', 'MED-0180', 'MED-0181', 'MED-0182', 'MED-0183',
  'MED-0186', 'MED-0187',
  'MED-0184', 'MED-0185',
  'MED-0189',
  'MED-0192', 'MED-0193', 'MED-0194', 'MED-0195', 'MED-0196', 'MED-0197', 'MED-0198', 'MED-0199',
  'MED-0201', 'MED-0202', 'MED-0203',
  'MED-0029', 'MED-0039', 'MED-0057', 'MED-0069', 'MED-0099',
  'MED-0115', 'MED-0126', 'MED-0149', 'MED-0150', 'MED-0168',
].sort();

describe('config Tier Daily Validated — dedupe', () => {

  it('la lista contiene todos los medios activos del tier incluyendo los lotes NEWS LAKE 200 FINAL PUSH + 200 MEDIA MILESTONE + Mery Jalisco Priority', () => {
    const ids = SHADOW_MEDIOS_DAILY_VALIDATED.map((m) => m.medio_id).sort();
    expect(ids).toEqual(IDS_ESPERADOS);
  });

  it('NO incluye boilerplate MED-0118 (El Respetable)', () => {
    expect(SHADOW_MEDIOS_DAILY_VALIDATED.map((m) => m.medio_id)).not.toContain('MED-0118');
  });

  it('NO incluye MED-0204 (Página 24 Jalisco): PLANNED_NOT_ONBOARDED, sin fila en `medios`', () => {
    expect(SHADOW_MEDIOS_DAILY_VALIDATED.map((m) => m.medio_id)).not.toContain('MED-0204');
    expect(mediosDailyNetNew().map((m) => m.medio_id)).not.toContain('MED-0204');
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

  it('net-new actual = todos los medios activos del tier (ninguno colisiona con base/nacional B/crisis)', () => {
    expect(mediosDailyNetNew().map((m) => m.medio_id).sort()).toEqual(IDS_ESPERADOS);
  });

  it('respeta max_notas por medio (<=30) y fuente válida (auto/rss/sitemap)', () => {
    const FUENTES_VALIDAS = new Set<string>(['auto', 'rss', 'sitemap']);
    for (const m of mediosDailyValidatedActivos()) {
      expect(m.max_notas_shadow).toBeLessThanOrEqual(30);
      expect(FUENTES_VALIDAS.has(m.fuente)).toBe(true);
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

  it('NO pasa --shard (default A, backward compatible)', () => {
    const cmd = wf.slice(wf.indexOf('npm run shadow-daily-validated-tier'));
    expect(cmd).not.toContain('--shard');
  });
});

const IDS_B = [
  'MED-0019', 'MED-0024', 'MED-0026', 'MED-0040',
  'MED-0041', 'MED-0042', 'MED-0051', 'MED-0103',
  'MED-0107', 'MED-0191', 'MED-0007', 'MED-0058',
  'MED-0092', 'MED-0111', 'MED-0064', 'MED-0109',
  'MED-0113', 'MED-0044', 'MED-0014', 'MED-0086', 'MED-0130',
  'MED-0081', 'MED-0063', 'MED-0105',
] as const;

const IDS_C = [
  'MED-0106', 'MED-0124', 'MED-0072', 'MED-0080',
  'MED-0093', 'MED-0122', 'MED-0018', 'MED-0022',
  'MED-0009', 'MED-0116', 'MED-0091', 'MED-0138',
  'MED-0036', 'MED-0101', 'MED-0052', 'MED-0062',
  'MED-0095',
  'MED-0205', 'MED-0206', 'MED-0210', 'MED-0211', 'MED-0212', 'MED-0214',
] as const;

describe('DailyValidatedShard — A default y B acotado', () => {
  it('sin argumento el shard es A y conserva los 47 net-new', () => {
    expect(parseDailyValidatedShard(undefined)).toEqual({ ok: true, shard: 'A' });
    expect(mediosDailyNetNew().map((m) => m.medio_id).sort()).toEqual(
      mediosDailyNetNew('A').map((m) => m.medio_id).sort(),
    );
    expect(mediosDailyNetNew().map((m) => m.medio_id).sort()).toEqual(IDS_ESPERADOS);
    expect(mediosDailyNetNew().length).toBe(47);
    expect(SHADOW_MEDIOS_DAILY_VALIDATED).toHaveLength(47);
  });

  it('--shard=A resuelve los mismos 47 IDs', () => {
    expect(parseDailyValidatedShard('A')).toEqual({ ok: true, shard: 'A' });
    expect(parseDailyValidatedShard('a')).toEqual({ ok: true, shard: 'A' });
    expect(mediosDailyNetNew('A').map((m) => m.medio_id).sort()).toEqual(IDS_ESPERADOS);
  });

  it('--shard=B resuelve exactamente los 24 IDs aprobados', () => {
    expect(parseDailyValidatedShard('B')).toEqual({ ok: true, shard: 'B' });
    expect(mediosDailyNetNew('B').map((m) => m.medio_id).sort()).toEqual([...IDS_B].sort());
    expect(SHADOW_MEDIOS_DAILY_VALIDATED_B).toHaveLength(24);
    expect(IDS_DAILY_VALIDATED_B).toHaveLength(24);
    expect(new Set(IDS_DAILY_VALIDATED_B).size).toBe(24);
    expect(IDS_DAILY_VALIDATED_B).not.toContain('MED-0118');
    expect(IDS_DAILY_VALIDATED_B).not.toContain('MED-0106');
  });

  it('--shard=C resuelve exactamente los 23 IDs C23', () => {
    expect(parseDailyValidatedShard('C')).toEqual({ ok: true, shard: 'C' });
    expect(parseDailyValidatedShard('c')).toEqual({ ok: true, shard: 'C' });
    expect(mediosDailyNetNew('C').map((m) => m.medio_id).sort()).toEqual([...IDS_C].sort());
    expect(SHADOW_MEDIOS_DAILY_VALIDATED_C).toHaveLength(23);
    expect(IDS_DAILY_VALIDATED_C).toHaveLength(23);
    expect(new Set(IDS_DAILY_VALIDATED_C).size).toBe(23);
  });

  it('shard inválido falla de forma segura (sin default silencioso a A)', () => {
    expect(parseDailyValidatedShard('')).toEqual({ ok: false, raw: '' });
    expect(parseDailyValidatedShard('D')).toMatchObject({ ok: false });
    expect(parseDailyValidatedShard('daily')).toMatchObject({ ok: false });
  });

  it('A/B overlap = 0', () => {
    expect(solapesEntreDailyShards()).toEqual([]);
    expect(describirSolapeDailyShard('A')).toBeNull();
    expect(describirSolapeDailyShard('B')).toBeNull();
    expect(describirSolapeDailyShard('C')).toBeNull();
  });

  it('B vs base/nacional/crisis overlap = 0', () => {
    expect(solapesDailyVsOtrosCrons('B')).toEqual([]);
    const cubiertos = mediosYaCubiertosPorCron();
    for (const id of IDS_B) expect(cubiertos.has(id)).toBe(false);
  });

  it('mediosEnCualquierCron incluye B y C; unique global es 127', () => {
    const cron = mediosEnCualquierCron();
    for (const id of IDS_B) expect(cron.has(id)).toBe(true);
    expect(cron.size).toBe(127);
  });

  it('ningún medio de B está en el shard A', () => {
    const a = new Set(SHADOW_MEDIOS_DAILY_VALIDATED.map((m) => m.medio_id));
    for (const id of IDS_B) expect(a.has(id)).toBe(false);
  });

  it('B no incluye MED-0204 y conserva el lote 1 + lote 2 exactos', () => {
    const b = new Set(IDS_DAILY_VALIDATED_B);
    expect(b.has('MED-0204')).toBe(false);
    for (const id of [
      'MED-0019', 'MED-0024', 'MED-0026', 'MED-0040',
      'MED-0041', 'MED-0042', 'MED-0051', 'MED-0103',
      'MED-0107', 'MED-0191', 'MED-0007', 'MED-0058',
      'MED-0092', 'MED-0111', 'MED-0064', 'MED-0109',
      'MED-0113', 'MED-0044', 'MED-0014', 'MED-0086', 'MED-0130',
    ]) {
      expect(b.has(id)).toBe(true);
    }
    expect(b.has('MED-0118')).toBe(false);
    expect(b.has('MED-0081')).toBe(true);
    expect(b.has('MED-0063')).toBe(true);
    expect(b.has('MED-0105')).toBe(true);
    expect(b.has('MED-0106')).toBe(false);
  });

  it('todos los shards respetan max_notas<=30; C usa 15', () => {
    for (const m of mediosDailyValidatedTodosActivos()) {
      expect(m.max_notas_shadow).toBeLessThanOrEqual(30);
    }
    for (const m of SHADOW_MEDIOS_DAILY_VALIDATED_C) {
      expect(m.max_notas_shadow).toBe(15);
      expect(m.fuente).toBe('rss');
      expect(m.activo_shadow).toBe(true);
    }
  });
});

describe('DailyValidatedShard — C C23 acotado', () => {
  it('configDailyValidated(C) retorna SOLO C', () => {
    const ids = configDailyValidated('C').map((m) => m.medio_id);
    expect(ids).toEqual([...IDS_DAILY_VALIDATED_C]);
    expect(new Set(ids).size).toBe(23);
    const a = new Set(configDailyValidated('A').map((m) => m.medio_id));
    const b = new Set(configDailyValidated('B').map((m) => m.medio_id));
    for (const id of ids) {
      expect(a.has(id)).toBe(false);
      expect(b.has(id)).toBe(false);
    }
    expect(ids).not.toContain('MED-0083');
    expect(ids).not.toContain('MED-0019');
  });

  it('C no contiene ZonaDocs ni El Respetable; incluye C17 y Batch01 READY', () => {
    const c = new Set(IDS_DAILY_VALIDATED_C);
    expect(c.has('MED-0043')).toBe(false);
    expect(c.has('MED-0192')).toBe(false);
    expect(c.has('MED-0118')).toBe(false);
    expect(c.has('MED-0207')).toBe(false);
    expect(c.has('MED-0208')).toBe(false);
    expect(c.has('MED-0209')).toBe(false);
    expect(c.has('MED-0213')).toBe(false);
    expect(c.has('MED-0036')).toBe(true);
    expect(c.has('MED-0101')).toBe(true);
    expect(c.has('MED-0052')).toBe(true);
    expect(c.has('MED-0062')).toBe(true);
    expect(c.has('MED-0095')).toBe(true);
    expect(c.has('MED-0205')).toBe(true);
    expect(c.has('MED-0206')).toBe(true);
    expect(c.has('MED-0210')).toBe(true);
    expect(c.has('MED-0211')).toBe(true);
    expect(c.has('MED-0212')).toBe(true);
    expect(c.has('MED-0214')).toBe(true);
  });

  it('C vs base/nacional/crisis overlap = 0', () => {
    expect(solapesDailyVsOtrosCrons('C')).toEqual([]);
    const cubiertos = mediosYaCubiertosPorCron();
    for (const id of IDS_C) expect(cubiertos.has(id)).toBe(false);
  });

  it('mediosDailyValidatedTodosActivos e EnCualquierCron incluyen C', () => {
    const todos = new Set(mediosDailyValidatedTodosActivos().map((m) => m.medio_id));
    const cron = mediosEnCualquierCron();
    for (const id of IDS_C) {
      expect(todos.has(id)).toBe(true);
      expect(cron.has(id)).toBe(true);
    }
  });
});

describe('workflow daily-validated shard B', () => {
  const wfB = readFileSync(
    join(process.cwd(), '.github/workflows/live-comparison-shadow-daily-validated-b.yml'),
    'utf-8',
  );
  const FLAG_EXPR =
    /^\s*ENRICH_DRAIN_V1:\s*"\$\{\{\s*\(github\.event_name\s*==\s*'schedule'\s*\|\|\s*inputs\.use_enrich_drain_v1\)\s*&&\s*'1'\s*\|\|\s*'0'\s*\}\}"\s*$/m;

  it('schedule 13:20 UTC y mismo concurrency group', () => {
    expect(wfB).toContain("cron: '20 13 * * *'");
    expect(wfB).toMatch(/group:\s*live-comparison-shadow\b/);
    expect(wfB).toMatch(/cancel-in-progress:\s*false/);
  });

  it('timeout 25 y JOB_TIMEOUT_MINUTES 25', () => {
    expect(wfB).toContain('timeout-minutes: 25');
    expect(wfB).toContain("JOB_TIMEOUT_MINUTES: '25'");
  });

  it('invoca el runner común con --shard=B', () => {
    expect(wfB).toContain('npm run shadow-daily-validated-tier');
    expect(wfB).toContain('--shard=B');
    expect(wfB).toContain('--max-notas=30');
  });

  it('schedule drain ON; manual default OFF; checkbox true ON', () => {
    expect(wfB).toMatch(FLAG_EXPR);
    const bloque = wfB.slice(wfB.indexOf('workflow_dispatch:'), wfB.indexOf('concurrency:'));
    expect(bloque).toContain('use_enrich_drain_v1:');
    expect(bloque).toMatch(/type:\s*boolean/);
    expect(bloque).toMatch(/default:\s*false/);
    expect(bloque).toMatch(/required:\s*false/);
    expect(bloque).toContain('window_hours:');
    expect(bloque).toContain("default: '48'");
    expect(wfB).not.toContain("ENRICH_DRAIN_V1: '1'");
  });

  it('flags de seguridad y sin envíos', () => {
    const cmd = wfB.slice(wfB.indexOf('npm run shadow-daily-validated-tier'));
    expect(cmd).toContain('--no-export-results');
    expect(cmd).toContain('--no-generate-xml');
    expect(cmd).toContain('--no-send');
    expect(cmd).toContain('--no-whatsapp');
    expect(cmd).toContain('--no-email');
    expect(cmd).not.toMatch(/--send\b/);
    expect(cmd).not.toContain('classify-ia');
    expect(cmd).not.toContain('export-raw-news');
    expect(cmd).not.toMatch(/twilio|smtp|gmail/i);
  });
});

describe('workflow daily-validated shard C', () => {
  const wfC = readFileSync(
    join(process.cwd(), '.github/workflows/live-comparison-shadow-daily-validated-c.yml'),
    'utf-8',
  );

  it('schedule 13:55 UTC y conserva workflow_dispatch', () => {
    expect(wfC).toContain('workflow_dispatch:');
    expect(wfC).toContain("cron: '55 13 * * *'");
  });

  it('mismo concurrency group, timeout 25, drain ON', () => {
    expect(wfC).toMatch(/group:\s*live-comparison-shadow\b/);
    expect(wfC).toMatch(/cancel-in-progress:\s*false/);
    expect(wfC).toContain('timeout-minutes: 25');
    expect(wfC).toContain("JOB_TIMEOUT_MINUTES: '25'");
    expect(wfC).toContain("ENRICH_DRAIN_V1: '1'");
  });

  it('invoca el runner común con --shard=C, max 15, detect 500', () => {
    expect(wfC).toContain('npm run shadow-daily-validated-tier');
    expect(wfC).toContain('--shard=C');
    expect(wfC).toContain('--max-notas=15');
    expect(wfC).toContain('--enrich-limit=500');
    expect(wfC).toContain('--detect-limit=500');
  });

  it('flags de seguridad y sin export a 02_Menciones', () => {
    const cmd = wfC.slice(wfC.indexOf('npm run shadow-daily-validated-tier'));
    expect(cmd).toContain('--no-export-results');
    expect(cmd).toContain('--no-generate-xml');
    expect(cmd).toContain('--no-send');
    expect(cmd).toContain('--no-whatsapp');
    expect(cmd).toContain('--no-email');
    expect(cmd).not.toMatch(/--send\b/);
    expect(cmd).not.toMatch(/twilio|smtp|gmail/i);
  });
});

describe('runner daily-validated — shard wiring', () => {
  const src = readFileSync(
    join(process.cwd(), 'scripts/run-shadow-daily-validated-tier.ts'),
    'utf-8',
  );

  it('detect limit permanece 300', () => {
    expect(src).toContain('detectLimit: 300');
  });

  it('A conserva workflow-label y ultimo_lote históricos', () => {
    expect(src).toContain("workflowLabel: 'shadow-daily-validated-tier'");
    expect(src).toContain("ultimoLote: 'daily-validated'");
    expect(src).toContain("tierLabel: 'daily_validated'");
  });

  it('B se distingue por workflow-label y ultimo_lote, no por tier-label', () => {
    expect(src).toContain("workflowLabel: 'shadow-daily-validated-tier-b'");
    expect(src).toContain("ultimoLote: 'daily-validated-b'");
  });

  it('C se distingue por workflow-label y ultimo_lote, no por tier-label', () => {
    expect(src).toContain("workflowLabel: 'shadow-daily-validated-tier-c'");
    expect(src).toContain("ultimoLote: 'daily-validated-c'");
    expect(src).toContain("modo: 'shadow_daily_validated_c'");
    expect(src).toContain('--shard=A, --shard=B o --shard=C');
  });

  it('MED-0029 y MED-0196 siguen en A; MED-0204 ausente', () => {
    expect(mediosDailyNetNew('A').map((m) => m.medio_id)).toContain('MED-0029');
    expect(mediosDailyNetNew('A').map((m) => m.medio_id)).toContain('MED-0196');
    expect(mediosDailyNetNew('A').map((m) => m.medio_id)).not.toContain('MED-0204');
    expect(mediosDailyNetNew('B').map((m) => m.medio_id)).not.toContain('MED-0029');
    expect(mediosDailyNetNew('B').map((m) => m.medio_id)).not.toContain('MED-0196');
    expect(mediosDailyNetNew('B').map((m) => m.medio_id)).not.toContain('MED-0204');
  });
});
