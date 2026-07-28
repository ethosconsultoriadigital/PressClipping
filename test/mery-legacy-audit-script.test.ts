import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  construirReporteLegacy,
  construirRankingMedios,
  calcularMetricasCobertura,
  HEADERS_COMPARATIVO,
} from '../scripts/audit-mery-legacy-google-rss.js';
import { normalizeLegacyRow } from '../src/comparators/meryLegacyComparator.js';
import type { LegacyRowRaw, FilaComparativa } from '../src/comparators/meryLegacyComparator.js';

function legacyRaw(overrides: Partial<LegacyRowRaw> = {}): LegacyRowRaw {
  return {
    title: 'Mery Pozos denuncia crisis del agua en Jalisco',
    description: 'La diputada federal Mery Pozos exigió acciones inmediatas.',
    link: 'https://udgtv.com/noticias/mery-pozos-agua',
    pubDate: '2026-07-20',
    source: 'UDG TV',
    guid: 'GUID-001',
    status: 'procesada',
    sentimiento: 'Nota Neutral ⚪️',
    tema: 'Política nacional',
    ...overrides,
  };
}

describe('parseArgs — defaults y flags', () => {
  it('defaults: windowDays=30, dryRun=false, output=console', () => {
    const a = parseArgs([]);
    expect(a.windowDays).toBe(30);
    expect(a.dryRun).toBe(false);
    expect(a.output).toBe('console');
    expect(a.input).toContain('CONCENTRADO_NOTAS_MERYPOZOS.xlsx');
  });

  it('--dry-run activa dryRun', () => {
    expect(parseArgs(['--dry-run']).dryRun).toBe(true);
  });

  it('--input configura la ruta del archivo', () => {
    expect(parseArgs(['--input=data/otro.xlsx']).input).toBe('data/otro.xlsx');
  });

  it('--window-hours=24 configura windowHours', () => {
    expect(parseArgs(['--window-hours=24']).windowHours).toBe(24);
  });

  it('--window-days=90 configura windowDays', () => {
    expect(parseArgs(['--window-days=90']).windowDays).toBe(90);
  });

  it('--output=sheet configura sheet', () => {
    expect(parseArgs(['--output=sheet']).output).toBe('sheet');
  });

  it('seguridad: ningún flag activa email/WhatsApp/Twilio/SMTP', () => {
    const a = parseArgs(['--dry-run', '--output=sheet', '--window-hours=24']);
    const salidaStr = JSON.stringify(a);
    expect(salidaStr).not.toMatch(/email|smtp|twilio|whatsapp|alertas_activas/i);
  });
});

describe('construirReporteLegacy — FASE 1', () => {
  it('reporta filas_leidas, sources_unicas, links_google_news/directos', () => {
    const rows = [
      normalizeLegacyRow(legacyRaw()),
      normalizeLegacyRow(legacyRaw({ link: 'https://news.google.com/rss/articles/x', source: 'Milenio', guid: 'G2' })),
      normalizeLegacyRow(legacyRaw({ source: 'El Informador', link: 'https://informador.mx/nota', guid: 'G3' })),
    ];
    const reporte = construirReporteLegacy(rows);
    expect(reporte.filas_leidas).toBe(3);
    expect(reporte.links_google_news).toBe(1);
    expect(reporte.links_directos).toBe(2);
    expect(reporte.sources_unicas).toBe(3);
  });

  it('cuenta notas_con_mery_en_title_description y posible_ruido correctamente', () => {
    const rows = [
      normalizeLegacyRow(legacyRaw()), // tiene nombre fuerte
      normalizeLegacyRow(legacyRaw({
        title: 'La UNAM entrega su Cuenta Anual', description: 'Sin relación con Jalisco.', guid: 'G4',
      })),
    ];
    const reporte = construirReporteLegacy(rows);
    expect(reporte.notas_con_mery_en_title_description).toBe(1);
    expect(reporte.posible_ruido).toBe(1);
  });

  it('rango_fechas refleja min/max de fechas parseables', () => {
    const rows = [
      normalizeLegacyRow(legacyRaw({ pubDate: '2025-11-03', guid: 'G5' })),
      normalizeLegacyRow(legacyRaw({ pubDate: '2026-07-26', guid: 'G6' })),
    ];
    const reporte = construirReporteLegacy(rows);
    expect(reporte.rango_fechas.min).toBe('2025-11-03');
    expect(reporte.rango_fechas.max).toBe('2026-07-26');
  });
});

describe('construirRankingMedios — FASE 3', () => {
  it('agrupa por source_canonico y cuenta mery_fuerte/links/ruido', () => {
    const rows = [
      normalizeLegacyRow(legacyRaw({ guid: 'G1' })),
      normalizeLegacyRow(legacyRaw({ guid: 'G2' })),
      normalizeLegacyRow(legacyRaw({ source: 'Milenio', link: 'https://milenio.com/otra-nota', guid: 'G3' })),
    ];
    const ranking = construirRankingMedios(rows);
    const udg = ranking.find((r) => r.source_canonico === 'UDG TV / Canal 44');
    expect(udg?.total_filas).toBe(2);
    expect(udg?.mery_fuerte).toBe(2);
    const milenio = ranking.find((r) => r.source_canonico === 'Milenio');
    expect(milenio?.total_filas).toBe(1);
  });

  it('ordena por mery_fuerte descendente', () => {
    const rows = [
      normalizeLegacyRow(legacyRaw({ source: 'Medio Bajo', link: 'https://a.com/1', title: 'Sin relación', description: 'Nada', guid: 'G1' })),
      normalizeLegacyRow(legacyRaw({ source: 'Medio Alto', link: 'https://b.com/1', guid: 'G2' })),
    ];
    const ranking = construirRankingMedios(rows);
    expect(ranking[0]!.source_canonico).toBe('Medio Alto');
  });
});

describe('calcularMetricasCobertura — FASE 6', () => {
  function filaComparativa(overrides: Partial<FilaComparativa> = {}): FilaComparativa {
    return {
      fecha_comparacion: '2026-07-28', ventana: '30d', fecha_legacy: '2026-07-20',
      source_legacy: 'UDG TV', source_canonico: 'UDG TV / Canal 44', medio_ethos: 'UDG TV / Canal 44',
      title_legacy: 'Nota', description_legacy: 'Desc', link_legacy: 'https://udgtv.com/nota',
      guid_legacy: 'G1', titulo_ethos: 'Nota', url_ethos: 'https://udgtv.com/nota',
      categoria_ethos: 'MENCION_DIRECTA', estado_ethos: 'GO_DIRECTA', nota_completa_ethos: 'Texto',
      estado_comparativo: 'AMBOS', razon_comparativo: '', medio_id: 'MED-0040',
      esta_en_catalogo: 'true', en_cron_daily_validated: 'true', accion_recomendada: '',
      dedupe_key: 'MERY-LEGACY::G1',
      ...overrides,
    };
  }

  it('separa recall contra legacy_total vs legacy_util', () => {
    const legacyRows = [
      normalizeLegacyRow(legacyRaw({ guid: 'G1' })), // util, con match
      normalizeLegacyRow(legacyRaw({ title: 'Ruido sin relación', description: 'Nada', guid: 'G2' })), // ruido
    ];
    const filas = [filaComparativa({ estado_comparativo: 'AMBOS' })];
    const metricas = calcularMetricasCobertura(legacyRows, 1, filas);
    expect(metricas.legacy_total).toBe(2);
    expect(metricas.legacy_ruido).toBe(1);
    expect(metricas.legacy_util).toBe(1);
    expect(metricas.recall_vs_legacy_total).toBe(0.5);
    expect(metricas.recall_vs_legacy_util).toBe(1);
  });

  it('cuenta medios distintos por estado (faltantes, sin cron, requieren direct, pago convenio)', () => {
    const legacyRows = [normalizeLegacyRow(legacyRaw())];
    const filas = [
      filaComparativa({ estado_comparativo: 'MEDIO_FALTANTE_ETHOS', source_canonico: 'A Fondo Jalisco' }),
      filaComparativa({ estado_comparativo: 'MEDIO_EN_CATALOGO_SIN_CRON', source_canonico: 'MURAL' }),
      filaComparativa({ estado_comparativo: 'MEDIO_REQUIERE_DIRECT', source_canonico: 'Partidero' }),
      filaComparativa({ estado_comparativo: 'MEDIO_D_PAGO_CONVENIO', source_canonico: 'MURAL' }),
    ];
    const metricas = calcularMetricasCobertura(legacyRows, 0, filas);
    expect(metricas.medios_faltantes).toBe(1);
    expect(metricas.medios_en_catalogo_sin_cron).toBe(1);
    expect(metricas.medios_requieren_direct).toBe(1);
    expect(metricas.medios_d_pago_convenio).toBe(1);
  });

  it('precision_estimada_ethos y recall son 0 cuando no hay datos (sin dividir por cero)', () => {
    const metricas = calcularMetricasCobertura([], 0, []);
    expect(metricas.precision_estimada_ethos).toBe(0);
    expect(metricas.recall_vs_legacy_total).toBe(0);
    expect(metricas.recall_vs_legacy_util).toBe(0);
  });
});

describe('HEADERS_COMPARATIVO — columnas requeridas de la tab 19', () => {
  it('incluye todas las columnas del FASE 4', () => {
    const requeridas = [
      'fecha_comparacion', 'ventana', 'fecha_legacy', 'source_legacy', 'source_canonico',
      'medio_ethos', 'title_legacy', 'description_legacy', 'link_legacy', 'guid_legacy',
      'titulo_ethos', 'url_ethos', 'categoria_ethos', 'estado_ethos', 'nota_completa_ethos',
      'estado_comparativo', 'razon_comparativo', 'medio_id', 'esta_en_catalogo',
      'en_cron_daily_validated', 'accion_recomendada',
    ];
    for (const col of requeridas) expect(HEADERS_COMPARATIVO).toContain(col);
  });
});
