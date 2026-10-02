import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { classifyLightHealth } from '../src/sourceRegistry/health.js';
import { decideDedupe } from '../src/sourceRegistry/dedupe.js';
import { classifySourceKind, pendingAliasCluster } from '../src/sourceRegistry/classifyKind.js';
import { expansionPriority } from '../src/sourceRegistry/priority.js';
import { parseAstraCsv } from '../src/sourceRegistry/csv.js';
import { mergeAstraCandidates } from '../src/sourceRegistry/astraPackage.js';
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

const V3_BASE_HEADER =
  'candidate_id,nombre_fuente,estado,municipios_o_cobertura,platform,source_kind,content_origin,url_base,canonical_url,sample_url,sample_date,evidence_level,evidence_urls,estado_revision,actividad_documentada,technical_probe_status,notes';
const V3_ENRICH_HEADER =
  'candidate_id,nombre_fuente,estado,municipios_o_cobertura,platform,source_kind,content_origin,url_base,canonical_url,canonical_key,sample_url,sample_date,activity_30d_confirmed,evidence_level,evidence_urls,estado_revision,capture_feasibility,technical_probe_status,status,has_website,social_only,notes';

describe('Astra V3 headers + merge', () => {
  it('T1 nombre_fuente reconocido', () => {
    const csv = `${V3_BASE_HEADER}\nFC-1,88.9 Noticias,Ciudad de México,,WEB,LOCAL_NEWS,EDITORIAL,https://889noticias.mx/,https://889noticias.mx,https://889noticias.mx/nota,2026-10-01,PRIMARY_SITE,,ADICIONAL,CONFIRMED_30D,NOT_RUN,ok`;
    const rows = parseAstraCsv(csv, 'CANDIDATAS_ACUMULADAS_V2_V3.csv');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('88.9 Noticias');
    expect(rows[0]!.candidate_id).toBe('FC-1');
  });

  it('T2 municipios_o_cobertura reconocido', () => {
    const csv = `${V3_ENRICH_HEADER}\nV3-1,Iztapalapa Noticias,Ciudad de México,Iztapalapa; CDMX,WEB,LOCAL_NEWS,EDITORIAL,https://iztapalapanoticias.mx/,https://iztapalapanoticias.mx,iztapalapanoticias.mx,,,true,PRIMARY_SITE,,,UNKNOWN,NOT_RUN,DISCOVERED,TRUE,NO,`;
    const rows = parseAstraCsv(csv, 'CON_MUESTRA_30D_V3.csv');
    expect(rows[0]!.municipio).toContain('Iztapalapa');
  });

  it('T3 activity_30d_confirmed y MUESTRA_30D => sample_within_30d', () => {
    const a = parseAstraCsv(
      `${V3_ENRICH_HEADER}\nV3-1,X,Hidalgo,,WEB,NEWS_MEDIA,EDITORIAL,https://a.mx/,https://a.mx,a.mx,,,true,PRIMARY_SITE,,,UNKNOWN,NOT_RUN,DISCOVERED,TRUE,NO,`,
      'CON_MUESTRA_30D_V3.csv',
    );
    expect(a[0]!.sample_within_30d).toBe(true);
    expect(a[0]!.evidence_tier).toBe('RECENT_30D');
    const b = parseAstraCsv(
      `${V3_BASE_HEADER}\nFC-2,Y,Hidalgo,,WEB,NEWS_MEDIA,EDITORIAL,https://b.mx/,https://b.mx,,,PRIMARY_SEARCH,,POTENTIAL,MUESTRA_30D,NOT_RUN,`,
      'CANDIDATAS_ACUMULADAS_V2_V3.csv',
    );
    expect(b[0]!.sample_within_30d).toBe(true);
    expect(b[0]!.evidence_tier).toBe('RECENT_30D');
  });

  it('T4 canonical_url preferido sobre url_base', () => {
    const csv = `${V3_BASE_HEADER}\nFC-3,Z,Nacional,,WEB,NEWS_MEDIA,EDITORIAL,https://www.ejemplo.mx/path/,https://ejemplo.mx,https://ejemplo.mx/nota,2026-09-28,PRIMARY_SEARCH,,POTENTIAL,CONFIRMED_30D,NOT_RUN,`;
    const rows = parseAstraCsv(csv, 'CANDIDATAS_ACUMULADAS_V2_V3.csv');
    expect(rows[0]!.url).toBe('https://ejemplo.mx');
  });

  it('T5/T6/T8 BASE + CON_MUESTRA mergean por candidate_id y conservan 30d', () => {
    const base = parseAstraCsv(
      `${V3_BASE_HEADER}\nFC-88,88.9 Noticias,Nacional,,WEB,POLITICAL_DIGITAL,EDITORIAL,https://www.889noticias.mx/,https://889noticias.mx,,,,PRIMARY_SEARCH,,POTENTIAL,,NOT_RUN,base`,
      'CANDIDATAS_ACUMULADAS_V2_V3.csv',
    );
    const enrich = parseAstraCsv(
      `${V3_ENRICH_HEADER}\nFC-88,88.9 Noticias,Ciudad de México,CDMX,WEB,LOCAL_NEWS,POR_DETERMINAR,https://889noticias.mx/,https://889noticias.mx,889noticias.mx,https://889noticias.mx/lluvia,2026-10-01,true,PRIMARY_SITE,https://889noticias.mx/lluvia,ADICIONAL,UNKNOWN,NOT_RUN,DISCOVERED,TRUE,NO,enrich`,
      'CON_MUESTRA_30D_V3.csv',
    );
    expect(base[0]!.sample_within_30d).toBe(false);
    expect(base[0]!.evidence_tier).toBe('PRIMARY');
    const { merged } = mergeAstraCandidates(base, enrich);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.candidate_id).toBe('FC-88');
    expect(merged[0]!.sample_within_30d).toBe(true);
    expect(merged[0]!.evidence_tier).toBe('RECENT_30D');
    expect(merged[0]!.municipio).toContain('CDMX');
    expect(merged[0]!.sample_url).toContain('lluvia');
  });

  it('T7 COBERTURA_32_ENTIDADES no crea fuentes', () => {
    const csv = `estado,observaciones,identidades_revisadas,adicionales_v3,con_muestra_30d,ediciones_grupo_existente,pendientes,rechazadas,ya_conocidas,canales_mismo_emisor
Hidalgo,10,8,2,1,0,1,0,0,0`;
    expect(parseAstraCsv(csv, 'COBERTURA_32_ENTIDADES_V3.csv')).toHaveLength(0);
  });

  it('T9 ediciones Quadratín no se colapsan por dominio raíz', () => {
    const base = parseAstraCsv(
      `${V3_BASE_HEADER}
FC-Q1,Quadratín Chiapas,Chiapas,,WEB,REGIONAL_EDITION,EDITORIAL,https://chiapas.quadratin.com.mx/,https://chiapas.quadratin.com.mx,,,,PRIMARY_SEARCH,,POTENTIAL,CONFIRMED_30D,NOT_RUN,
FC-Q2,Quadratín Chihuahua,Chihuahua,,WEB,REGIONAL_EDITION,EDITORIAL,https://chihuahua.quadratin.com.mx/,https://chihuahua.quadratin.com.mx,,,,PRIMARY_SEARCH,,POTENTIAL,CONFIRMED_30D,NOT_RUN,`,
      'CANDIDATAS_ACUMULADAS_V2_V3.csv',
    );
    const { merged } = mergeAstraCandidates(base, []);
    expect(merged).toHaveLength(2);
    const chiapas = decideDedupe({
      name: 'Quadratín Chiapas',
      url: 'https://chiapas.quadratin.com.mx',
      platform: 'WEB',
      estado: 'Chiapas',
      existing: [],
    });
    const chihuahua = decideDedupe({
      name: 'Quadratín Chihuahua',
      url: 'https://chihuahua.quadratin.com.mx',
      platform: 'WEB',
      estado: 'Chihuahua',
      existing: [
        {
          uniqueness_key: chiapas.uniqueness_key,
          name: 'Quadratín Chiapas',
          hostname: hostnameOf('https://chiapas.quadratin.com.mx'),
          estado: 'Chiapas',
        },
      ],
    });
    expect(chihuahua.action).toBe('REGIONAL_EDITION');
    expect(chihuahua.uniqueness_key).not.toBe(chiapas.uniqueness_key);
  });

  it('T10 dry-run no escribe producción (guard if (!dry))', () => {
    const src = readFileSync('scripts/source-registry-ingest-astra.ts', 'utf8');
    expect(src).toMatch(/if \(!dry\)/);
    expect(src).toMatch(/loadAstraV3Package/);
    expect(src).not.toMatch(/for \(const p of found\) rows\.push\(\.\.\.loadAstraCsvFile/);
  });
});
