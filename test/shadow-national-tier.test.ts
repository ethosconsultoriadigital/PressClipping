/**
 * Tests del TIER NACIONAL B sombra:
 *   - config contiene Uno TV, Publimetro, Milenio (alta 2026-07-17, lote PATRON P1
 *     MEDIA GAP CLOSURE), Aristegui Noticias (alta 2026-07-20, lote NATIONAL MEDIA
 *     COVERAGE RAMP — único de 4 candidatos que pasó viabilidad técnica limpia) y
 *     El Universal (alta 2026-07-20, mismo lote — reparado de BLOQUEADO/404 con
 *     un feed alterno real de Arc Publishing).
 *   - prefiltro bloquea deportes/espectáculos pero NO señales de alto valor.
 *   - flags prohibidos siguen bloqueados por la guarda sombra.
 *   - el workflow nacional existe, comparte concurrency y no usa comandos prohibidos.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SHADOW_MEDIOS_NACIONALES_B,
  mediosNacionalesActivos,
} from '../src/config/shadowMedia.js';
import { decidirPrefiltro } from '../src/shadow/nationalPrefilter.js';
import { verificarFlagsSombra } from '../src/utils/shadowGuard.js';

describe('config Tier Nacional B', () => {
  it('contiene exactamente Uno TV (MED-0025), Publimetro (MED-0053), Milenio (MED-0030), Aristegui (MED-0008) y El Universal (MED-0011)', () => {
    const ids = SHADOW_MEDIOS_NACIONALES_B.map((m) => m.medio_id).sort();
    expect(ids).toEqual(['MED-0008', 'MED-0011', 'MED-0025', 'MED-0030', 'MED-0053']);
  });

  it('El Universal con prefiltro (max 30, 6h) — reparado de BLOQUEADO con feed alterno Arc Publishing', () => {
    const eu = SHADOW_MEDIOS_NACIONALES_B.find((m) => m.medio_id === 'MED-0011')!;
    expect(eu.prefiltro_titulo).toBe(true);
    expect(eu.max_notas_shadow).toBe(30);
    expect(eu.frecuencia_shadow).toBe('6h');
    expect(eu.activo_shadow).toBe(true);
  });

  it('Aristegui con prefiltro (max 30, 6h) — alta 2026-07-20, único candidato viable del sub-lote de 4', () => {
    const ar = SHADOW_MEDIOS_NACIONALES_B.find((m) => m.medio_id === 'MED-0008')!;
    expect(ar.prefiltro_titulo).toBe(true);
    expect(ar.max_notas_shadow).toBe(30);
    expect(ar.frecuencia_shadow).toBe('6h');
    expect(ar.activo_shadow).toBe(true);
  });

  it('Uno TV sin prefiltro (max 50); Publimetro con prefiltro (max 40); ambos 6h', () => {
    const uno = SHADOW_MEDIOS_NACIONALES_B.find((m) => m.medio_id === 'MED-0025')!;
    const pub = SHADOW_MEDIOS_NACIONALES_B.find((m) => m.medio_id === 'MED-0053')!;
    expect(uno.prefiltro_titulo).toBe(false);
    expect(uno.max_notas_shadow).toBe(50);
    expect(uno.frecuencia_shadow).toBe('6h');
    expect(pub.prefiltro_titulo).toBe(true);
    expect(pub.max_notas_shadow).toBe(40);
    expect(pub.frecuencia_shadow).toBe('6h');
  });

  it('Milenio con prefiltro (max 30, 6h) — alta 2026-07-17, revierte exclusión ruido/volumen', () => {
    const mil = SHADOW_MEDIOS_NACIONALES_B.find((m) => m.medio_id === 'MED-0030')!;
    expect(mil.prefiltro_titulo).toBe(true);
    expect(mil.max_notas_shadow).toBe(30);
    expect(mil.frecuencia_shadow).toBe('6h');
    expect(mil.activo_shadow).toBe(true);
  });

  it('mediosNacionalesActivos(B) devuelve solo activos', () => {
    expect(mediosNacionalesActivos('B').map((m) => m.medio_id).sort()).toEqual(['MED-0008', 'MED-0011', 'MED-0025', 'MED-0030', 'MED-0053']);
  });
});

describe('prefiltro nacional (Publimetro)', () => {
  it('bloquea deportes/fútbol/Mundial', () => {
    expect(decidirPrefiltro('México vs Ecuador, Mundial 2026 en vivo').saltar).toBe(true);
    expect(decidirPrefiltro('Resultados de la Liga MX', 'deportes').saltar).toBe(true);
  });

  it('bloquea espectáculos/entretenimiento/virales (con y sin acento)', () => {
    expect(decidirPrefiltro('Lo más viral de los espectáculos', 'entretenimiento').saltar).toBe(true);
    expect(decidirPrefiltro('Famosos en la cartelera', 'espectaculos').saltar).toBe(true);
  });

  it('NO bloquea huelga/sindicato/trabajadores/derechos laborales', () => {
    expect(decidirPrefiltro('Huelga indefinida en la UAS').saltar).toBe(false);
    expect(decidirPrefiltro('El sindicato negocia contrato colectivo').saltar).toBe(false);
    expect(decidirPrefiltro('La formalización del empleo y los derechos laborales').saltar).toBe(false);
  });

  it('alto valor anula el salto aunque el título sea deportivo', () => {
    const d = decidirPrefiltro('Jugadores en huelga durante el Mundial');
    expect(d.saltar).toBe(false);
    expect(d.motivo).toContain('alto_valor');
  });

  it('no bloquea notas neutras sin coincidencia', () => {
    expect(decidirPrefiltro('Gobierno presenta presupuesto estatal').saltar).toBe(false);
  });
});

describe('guarda sombra: flags prohibidos', () => {
  it('rechaza export-results / generate-xml / classify-ia / alerts', () => {
    expect(verificarFlagsSombra(['--export-results']).ok).toBe(false);
    expect(verificarFlagsSombra(['--generate-xml']).ok).toBe(false);
    expect(verificarFlagsSombra(['--classify-ia']).ok).toBe(false);
    expect(verificarFlagsSombra(['--alerts']).ok).toBe(false);
  });

  it('permite las confirmaciones --no-*', () => {
    expect(verificarFlagsSombra(['--no-export-results', '--no-alerts', '--no-generate-xml']).ok).toBe(true);
  });
});

describe('workflow nacional sombra', () => {
  const wf = readFileSync(
    join(process.cwd(), '.github/workflows/live-comparison-shadow-national.yml'),
    'utf-8',
  );

  it('comparte el grupo de concurrency del shadow base', () => {
    expect(wf).toMatch(/group:\s*live-comparison-shadow\b/);
    expect(wf).toMatch(/cancel-in-progress:\s*false/);
  });

  it('cron cada 6h desfasado y workflow_dispatch presente', () => {
    expect(wf).toContain("cron: '30 */6 * * *'");
    expect(wf).toContain('workflow_dispatch');
  });

  it('usa shadow-national-tier con flags de seguridad', () => {
    expect(wf).toContain('npm run shadow-national-tier');
    expect(wf).toContain('--no-alerts');
    expect(wf).toContain('--no-export-results');
    expect(wf).toContain('--no-generate-xml');
  });

  it('el comando ejecutado NO invoca acciones de producción ni alertas', () => {
    // Aísla el bloque del comando real (después de "run: |"), ignorando comentarios.
    const cmd = wf.slice(wf.indexOf('npm run shadow-national-tier'));
    // No debe habilitar flags prohibidos (solo se permiten las confirmaciones --no-*).
    expect(cmd).not.toMatch(/(?<!no-)\bexport-results\b/);
    expect(cmd).not.toMatch(/(?<!no-)\bgenerate-xml\b/);
    expect(cmd).not.toContain('classify-ia');
    expect(cmd).not.toContain('shadow-alerts');
    expect(cmd).not.toContain('export-raw-news');
    expect(cmd).not.toMatch(/twilio|smtp|gmail/i);
  });
});
