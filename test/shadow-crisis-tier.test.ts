/**
 * Tests del TIER CRISIS sombra:
 *   - config contiene UNO MAS UNO (MED-0170, sitemap) y El Sol de Irapuato (MED-0169, rss).
 *   - fuente POR MEDIO: MED-0170 usa sitemap, MED-0169 usa rss (nunca forzar sitemap).
 *   - NO incluye El Otro Enfoque (MED-0171).
 *   - flags prohibidos siguen bloqueados por la guarda sombra.
 *   - notas de trazabilidad incluyen workflow/tier/medios/fuente/frecuencia.
 *   - el workflow crisis existe, comparte concurrency, cron cada 6h al minuto 15 y sin comandos prohibidos.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SHADOW_MEDIOS_CRISIS,
  mediosCrisisActivos,
  mediosYaCubiertosPorCron,
} from '../src/config/shadowMedia.js';
import { verificarFlagsSombra, notasTrazabilidadWorkflow } from '../src/utils/shadowGuard.js';

describe('config Tier Crisis', () => {
  it('contiene exactamente UNO MAS UNO (MED-0170) y El Sol de Irapuato (MED-0169)', () => {
    const ids = SHADOW_MEDIOS_CRISIS.map((m) => m.medio_id).sort();
    expect(ids).toEqual(['MED-0169', 'MED-0170']);
  });

  it('NO incluye El Otro Enfoque (MED-0171)', () => {
    const ids = SHADOW_MEDIOS_CRISIS.map((m) => m.medio_id);
    expect(ids).not.toContain('MED-0171');
  });

  it('UNO MAS UNO usa fuente=sitemap, 6h, max 80', () => {
    const uno = SHADOW_MEDIOS_CRISIS.find((m) => m.medio_id === 'MED-0170')!;
    expect(uno.fuente_preferida).toBe('sitemap');
    expect(uno.frecuencia_shadow).toBe('6h');
    expect(uno.max_notas_shadow).toBe(80);
  });

  it('El Sol de Irapuato usa fuente=rss (nunca sitemap), 6h', () => {
    const sol = SHADOW_MEDIOS_CRISIS.find((m) => m.medio_id === 'MED-0169')!;
    expect(sol.fuente_preferida).toBe('rss');
    expect(sol.fuente_preferida).not.toBe('sitemap');
    expect(sol.frecuencia_shadow).toBe('6h');
    expect(sol.activo_shadow).toBe(true);
  });

  it('soporta fuentes DISTINTAS por medio en el tier (sitemap + rss)', () => {
    const fuentes = new Set(SHADOW_MEDIOS_CRISIS.map((m) => m.fuente_preferida));
    expect(fuentes.has('sitemap')).toBe(true);
    expect(fuentes.has('rss')).toBe(true);
  });

  it('mediosCrisisActivos() devuelve ambos activos (MED-0169, MED-0170)', () => {
    expect(mediosCrisisActivos().map((m) => m.medio_id).sort()).toEqual(['MED-0169', 'MED-0170']);
  });

  it('MED-0169 queda cubierto por cron (dedupe estructural: daily no lo recrawlea)', () => {
    const cubiertos = mediosYaCubiertosPorCron();
    expect(cubiertos.has('MED-0169')).toBe(true);
    expect(cubiertos.has('MED-0170')).toBe(true);
  });
});

describe('dedupe de menciones — unique(noticia_id, keyword_id)', () => {
  const schema = readFileSync(
    join(process.cwd(), 'supabase/migrations/0001_initial_schema.sql'),
    'utf-8',
  );

  it('la migración declara el UNIQUE que garantiza dedupe de MED-0169', () => {
    expect(schema).toMatch(/unique\s*\(\s*noticia_id\s*,\s*keyword_id\s*\)/i);
  });
});

describe('notasTrazabilidadWorkflow — tier crisis', () => {
  it('incluye workflow/tier/medios/fuente/frecuencia en ese orden', () => {
    const notas = notasTrazabilidadWorkflow({
      workflow: 'shadow-crisis-tier',
      tier: 'crisis',
      medios: 'MED-0170',
      fuente: 'sitemap',
      frecuencia: '6h',
    });
    expect(notas).toBe(
      'workflow=shadow-crisis-tier; tier=crisis; medios=MED-0170; fuente=sitemap; frecuencia=6h',
    );
  });

  it('omite fuente si no se provee (retrocompatible con nacional B)', () => {
    const notas = notasTrazabilidadWorkflow({
      workflow: 'shadow-national-tier',
      tier: 'nacional_b',
      medios: 'MED-0025,MED-0053',
      frecuencia: '6h',
    });
    expect(notas).not.toContain('fuente=');
    expect(notas).toContain('workflow=shadow-national-tier');
  });
});

describe('guarda sombra: tier crisis', () => {
  it('rechaza export-results / generate-xml / classify-ia / alerts / whatsapp / smtp', () => {
    expect(verificarFlagsSombra(['--export-results']).ok).toBe(false);
    expect(verificarFlagsSombra(['--generate-xml']).ok).toBe(false);
    expect(verificarFlagsSombra(['--classify-ia']).ok).toBe(false);
    expect(verificarFlagsSombra(['--alerts']).ok).toBe(false);
  });

  it('permite las confirmaciones --no-*', () => {
    expect(verificarFlagsSombra(['--no-export-results', '--no-alerts', '--no-generate-xml']).ok).toBe(true);
  });
});

describe('workflow crisis sombra', () => {
  const wf = readFileSync(
    join(process.cwd(), '.github/workflows/live-comparison-shadow-crisis.yml'),
    'utf-8',
  );

  it('comparte el grupo de concurrency del shadow base', () => {
    expect(wf).toMatch(/group:\s*live-comparison-shadow\b/);
    expect(wf).toMatch(/cancel-in-progress:\s*false/);
  });

  it('cron cada 6h al minuto 15 (desfasado) y workflow_dispatch presente', () => {
    expect(wf).toContain("cron: '15 */6 * * *'");
    expect(wf).toContain('workflow_dispatch');
  });

  it('usa shadow-crisis-tier con flags de seguridad', () => {
    expect(wf).toContain('npm run shadow-crisis-tier');
    expect(wf).toContain('--no-export-results');
    expect(wf).toContain('--no-generate-xml');
  });

  it('integra la observación shadow-alerts con allowlist CLI-0002 y sin envío', () => {
    const cmd = wf.slice(wf.indexOf('npm run shadow-crisis-tier'));
    expect(cmd).toContain('--run-shadow-alerts');
    expect(cmd).toContain('--shadow-client-allowlist=CLI-0002');
    expect(cmd).toContain('--shadow-alerts-output=sheet');
    expect(cmd).toContain('--no-send');
    expect(cmd).toContain('--no-whatsapp');
    expect(cmd).toContain('--no-email');
  });

  it('NO usa --no-alerts (impediría la observación) ni flags de envío real', () => {
    const cmd = wf.slice(wf.indexOf('npm run shadow-crisis-tier'));
    expect(cmd).not.toContain('--no-alerts');
    // Sin flags de envío real (--no-send/--no-whatsapp/--no-email SÍ están permitidos).
    expect(cmd).not.toMatch(/--send\b/);
    expect(cmd).not.toMatch(/--whatsapp\b/);
    expect(cmd).not.toMatch(/--email\b/);
    expect(cmd).not.toMatch(/twilio|smtp|gmail/i);
  });

  it('el comando ejecutado NO invoca acciones de producción', () => {
    const cmd = wf.slice(wf.indexOf('npm run shadow-crisis-tier'));
    expect(cmd).not.toMatch(/(?<!no-)\bexport-results\b/);
    expect(cmd).not.toMatch(/(?<!no-)\bgenerate-xml\b/);
    expect(cmd).not.toContain('classify-ia');
    expect(cmd).not.toContain('export-raw-news');
  });
});
