import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyLightHealth } from '../src/sourceRegistry/health.js';
import { decideDedupe } from '../src/sourceRegistry/dedupe.js';
import { classifySourceKind, pendingAliasCluster } from '../src/sourceRegistry/classifyKind.js';
import { expansionPriority } from '../src/sourceRegistry/priority.js';
import { parseAstraCsv } from '../src/sourceRegistry/csv.js';
import { rankCandidates, selectSignalWave, selectWave1 } from '../src/sourceRegistry/waveSelect.js';
import { deepScoreFromNotes } from '../src/sourceRegistry/deepProbe.js';
import { foldName, hostnameOf } from '../src/sourceRegistry/identity.js';

describe('Source Registry identity / dedupe', () => {
  it('no colapsa ediciones Quadratín; las agrupa', () => {
    const nacional = decideDedupe({
      name: 'Quadratín Nacional',
      url: 'https://www.quadratin.com.mx',
      platform: 'WEB',
      estado: 'Nacional',
      existing: [],
    });
    expect(nacional.action).toBe('NEW');
    const chiapas = decideDedupe({
      name: 'Quadratín Chiapas',
      url: 'https://chiapas.quadratin.com.mx',
      platform: 'WEB',
      estado: 'Chiapas',
      existing: [
        {
          uniqueness_key: nacional.uniqueness_key,
          name: 'Quadratín Nacional',
          hostname: hostnameOf('https://www.quadratin.com.mx'),
          estado: 'Nacional',
        },
      ],
    });
    expect(chiapas.action).toBe('REGIONAL_EDITION');
    expect(chiapas.uniqueness_key).not.toBe(nacional.uniqueness_key);
  });

  it('marca clusters Iztapalapa/Coyoacán y Guardia/Tráfico como aliases pending', () => {
    expect(pendingAliasCluster('Iztapalapa Noticias')).toBe('noticias-cdmx-alcaldias');
    expect(pendingAliasCluster('Guardia Nocturna')).toBe('trafico-zmg');
  });
});

describe('Source kind — petitions are not NEWS_MEDIA', () => {
  it('CitizenGO / Change.org', () => {
    expect(classifySourceKind({ name: 'CitizenGO', url: 'https://www.citizengo.org' }).source_kind).toBe(
      'PETITION_PLATFORM',
    );
    expect(classifySourceKind({ name: 'Change.org', url: 'https://www.change.org' }).content_origin).toBe(
      'UGC_ADVOCACY',
    );
  });
});

describe('Zero-AI light health', () => {
  const now = '2026-10-01T12:00:00.000Z';
  it('un solo 403 no es DEAD ni BLOCKED_EXTERNAL', () => {
    const r = classifyLightHealth({
      httpStatus: 403,
      timeout: false,
      networkError: false,
      nxdomain: false,
      homepageOk: false,
      latestContentAt: null,
      nowIso: now,
      consecutiveFailuresBefore: 0,
    });
    expect(r.health).toBe('DEGRADED');
  });
  it('un solo timeout no es DEAD', () => {
    const r = classifyLightHealth({
      httpStatus: null,
      timeout: true,
      networkError: false,
      nxdomain: false,
      homepageOk: false,
      latestContentAt: null,
      nowIso: now,
      consecutiveFailuresBefore: 0,
    });
    expect(r.health).toBe('DEGRADED');
  });
  it('404 reiterado sí puede ser DEAD', () => {
    const r = classifyLightHealth({
      httpStatus: 404,
      timeout: false,
      networkError: false,
      nxdomain: false,
      homepageOk: false,
      latestContentAt: null,
      nowIso: now,
      consecutiveFailuresBefore: 4,
    });
    expect(r.health).toBe('DEAD');
  });
  it('200 con contenido viejo es STALE no HEALTHY', () => {
    const r = classifyLightHealth({
      httpStatus: 200,
      timeout: false,
      networkError: false,
      nxdomain: false,
      homepageOk: true,
      latestContentAt: '2026-07-01T00:00:00.000Z',
      nowIso: now,
      consecutiveFailuresBefore: 2,
    });
    expect(r.health).toBe('STALE');
    expect(r.consecutiveFailures).toBe(0);
  });
});

describe('Priority score has no political-orientation term', () => {
  it('Hidalgo reciente NEWS puntúa más que directorio CDMX', () => {
    const hidalgo = expansionPriority({
      evidenceTier: 'RECENT_30D',
      sampleWithin30d: true,
      estado: 'Hidalgo',
      categoria: 'política',
      sourceKind: 'NEWS_MEDIA',
      hasWebCaptureHint: true,
      uniquenessVsLegacy: true,
      municipio: null,
    });
    const cdmxDir = expansionPriority({
      evidenceTier: 'DIRECTORY',
      sampleWithin30d: false,
      estado: 'Ciudad de México',
      categoria: 'nacional',
      sourceKind: 'NEWS_MEDIA',
      hasWebCaptureHint: true,
      uniquenessVsLegacy: true,
      municipio: null,
    });
    expect(hidalgo.total).toBeGreaterThan(cdmxDir.total);
    expect(hidalgo.GEO_GAP).toBeGreaterThan(cdmxDir.GEO_GAP);
  });
});

describe('Astra CSV + waves', () => {
  it('parsea fixture, Wave1 ≤25 NEWS, Signal separado, no rellena basura', () => {
    const csv = readFileSync('test/fixtures/source-registry-astra-sample.csv', 'utf8');
    const rows = parseAstraCsv(csv, 'CON_MUESTRA_30D_V3.csv');
    expect(rows.length).toBeGreaterThan(10);
    const ranked = rankCandidates(rows, new Set(['milenio.com']));
    const wave1 = selectWave1(ranked, 25);
    const signal = selectSignalWave(ranked, 15);
    expect(wave1.length).toBeLessThanOrEqual(25);
    expect(wave1.every((w) => w.band === 'NEWS' && w.row.sample_within_30d && w.uniquenessVsLegacy)).toBe(
      true,
    );
    expect(signal.every((w) => w.band === 'SIGNAL')).toBe(true);
    expect(signal.some((s) => foldName(s.row.name).includes('citizengo'))).toBe(true);
    expect(wave1.some((w) => foldName(w.row.name) === 'milenio')).toBe(false);
  });
});

describe('Deep probe reuses official certifier', () => {
  it('notas buenas → A sin bajar umbrales', () => {
    const notes = Array.from({ length: 6 }, (_, i) => {
      const body = `Cuerpo editorial Hidalgo ${i} ${'noticia local '.repeat(20)}`;
      return {
        url: `https://hidalgoinforma.mx/nota-${i}-detalle`,
        titulo: `Nota ${i} Hidalgo apertura presupuestal`,
        fecha: '2026-09-28T12:00:00.000Z',
        created_at: '2026-09-28T12:10:00.000Z',
        texto_cuerpo_nota: body,
        texto_nota_limpia: body,
      };
    });
    const r = deepScoreFromNotes({
      medioId: 'SRC-0001',
      notes,
      probe: { class: 'HEALTHY', status: 200, error: null },
      lastEstado: 'ok',
      lastError: null,
      paywallNotes: false,
      anchorIso: '2026-10-01T12:00:00.000Z',
    });
    expect(r.technical_class).toBe('A');
  });
});

describe('SQL additive', () => {
  it('migración 0015 no toca medios/noticias', () => {
    const sql = readFileSync('supabase/migrations/0015_source_registry.sql', 'utf8');
    expect(sql).toMatch(/create table if not exists public\.fuentes/);
    expect(sql).toMatch(/create table if not exists public\.fuente_canales/);
    expect(sql).toMatch(/create or replace view public\.v_fuentes_master/);
    expect(sql).not.toMatch(/drop table public\.medios/i);
    expect(sql).not.toMatch(/alter table noticias/i);
  });
});
