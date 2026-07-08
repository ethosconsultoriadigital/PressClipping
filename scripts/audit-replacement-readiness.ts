/**
 * AUDITORÍA DE READINESS DE SUSTITUCIÓN — Ethos vs PressClipping.
 *
 * SOLO LECTURA de Sheets de salida (05/07/08/10). NO escribe, NO envía, NO IA.
 * Combina:
 *   - 05_Comparativo_PressClipping → clasifica SOLO_PRESSCLIPPING fila por fila
 *     (clasificador determinístico) y separa gap real accionable del ruido.
 *   - 07_Metricas_Live            → último run y cobertura bruta/ajustada.
 *   - 08_Cobertura_Medios         → medios en cron / ready / repairable / blocked.
 *   - 10_Alertas_Sombra           → P1, duplicadas, cobertura de cluster_id.
 *   - data/audit-extraction-quality.json (opcional) → score de extracción.
 *
 * Excluye CLI-PRUEBA de las métricas ejecutivas (readiness_excluye_cli_prueba).
 *
 * Uso:
 *   npm run audit-replacement-readiness -- [--json]
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { logger } from '../src/utils/logger.js';
import { readOutputTabRows, type RawRow } from '../src/sheets/read.js';
import {
  clasificarSoloPressclipping,
  esGapAccionable,
  type CategoriaGap,
} from '../src/comparators/soloPressclippingClassifier.js';
import {
  esClientePrueba,
  estadoReadiness,
  siguienteAccion,
} from '../src/comparators/replacementReadiness.js';
import {
  mediosYaCubiertosPorCron,
  mediosDailyNetNew,
} from '../src/config/shadowMedia.js';

const TAB_05 = '05_Comparativo_PressClipping';
const TAB_07 = '07_Metricas_Live';
const TAB_08 = '08_Cobertura_Medios';
const TAB_10 = '10_Alertas_Sombra';

const txt = (v: unknown): string => String(v ?? '').trim();
const low = (v: unknown): string => txt(v).toLowerCase();
const bool = (v: unknown): boolean => /^(true|si|sí|1|yes)$/i.test(txt(v));
function pct(n: number, total: number): number { return total === 0 ? 0 : Math.round((n / total) * 1000) / 10; }

interface Args { json: boolean; }
function parseArgs(argv: string[]): Args {
  return { json: argv.includes('--json') };
}

/** Identidad de cliente robusta: usa cliente_id si existe, si no el nombre. */
function clienteKey(r: RawRow): { id: string; nombre: string } {
  const id = txt(r['cliente_id']);
  const nombre = txt(r['cliente']);
  return { id: id || nombre || 'SIN_CLIENTE', nombre: nombre || id };
}

interface ClienteAgg {
  cliente_id: string;
  cliente: string;
  match: number;
  solo_pc_total: number;
  solo_pc_accionable: number;
  solo_pc_fp: number;
  solo_pc_sindicado: number;
  solo_ethos_total: number;
  solo_ethos_valid: number;
  solo_ethos_fp: number;
  p1: number;
  duplicadas: number;
  con_cluster: number;
  alertas_total: number;
  es_prueba: boolean;
}

function nuevoAgg(id: string, nombre: string): ClienteAgg {
  return {
    cliente_id: id, cliente: nombre, match: 0, solo_pc_total: 0, solo_pc_accionable: 0,
    solo_pc_fp: 0, solo_pc_sindicado: 0, solo_ethos_total: 0, solo_ethos_valid: 0,
    solo_ethos_fp: 0, p1: 0, duplicadas: 0, con_cluster: 0, alertas_total: 0,
    es_prueba: esClientePrueba(id, nombre),
  };
}

/** Score de extracción global desde el JSON opcional (0-100). */
function leerExtraccionScore(): number {
  try {
    const raw = readFileSync('data/audit-extraction-quality.json', 'utf8');
    const parsed = JSON.parse(raw) as { resumen?: { pct_texto_600?: number } };
    return Math.round(parsed.resumen?.pct_texto_600 ?? 0);
  } catch { return 0; }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  logger.info('=== Auditoría de readiness de sustitución (SOLO LECTURA de 05/07/08/10) ===');

  const [filas05, filas07, filas08, filas10] = await Promise.all([
    readOutputTabRows(TAB_05),
    readOutputTabRows(TAB_07),
    readOutputTabRows(TAB_08),
    readOutputTabRows(TAB_10),
  ]);

  const extraccionScore = leerExtraccionScore();
  const clientes = new Map<string, ClienteAgg>();
  const getAgg = (id: string, nombre: string): ClienteAgg => {
    let a = clientes.get(id);
    if (!a) { a = nuevoAgg(id, nombre); clientes.set(id, a); }
    return a;
  };

  // ── 05: comparativo, clasificación de SOLO_PRESSCLIPPING ──
  const gapPorCategoria = new Map<CategoriaGap, number>();
  const gapTopMedios = new Map<string, number>();
  const gapTopKeywords = new Map<string, number>();
  const gapsAccionables: Array<{ cliente: string; medio: string; keyword: string; titulo: string; categoria: CategoriaGap; prioridad: string }> = [];

  for (const r of filas05) {
    const estado = txt(r['estado_comparativo']).toUpperCase();
    const { id, nombre } = clienteKey(r);
    const agg = getAgg(id, nombre);
    if (estado === 'MATCH' || estado === 'MATCH_PROBABLE') {
      agg.match++;
    } else if (estado === 'SOLO_ETHOS') {
      agg.solo_ethos_total++;
      const cat = low(r['categoria']);
      if (cat.includes('false')) agg.solo_ethos_fp++;
      else agg.solo_ethos_valid++;
    } else if (estado === 'SOLO_PRESSCLIPPING') {
      agg.solo_pc_total++;
      const cl = clasificarSoloPressclipping({
        estado_comparativo: estado,
        match_tipo: r['match_tipo'],
        cliente_id: id,
        cliente: nombre,
        medio: r['medio'],
        keyword: r['keyword'],
        titulo: r['titulo'],
        url_pressclipping: r['url_pressclipping'],
        url_ethos: r['url_ethos'],
        score_similitud: r['score_similitud'],
        diferencia_dias: r['diferencia_dias'],
        razon_posible: r['razon_posible'],
        accion_recomendada: r['accion_recomendada'],
        categoria: r['categoria'],
      });
      gapPorCategoria.set(cl.categoria_gap, (gapPorCategoria.get(cl.categoria_gap) ?? 0) + 1);
      if (cl.categoria_gap === 'PC_FALSE_POSITIVE') agg.solo_pc_fp++;
      if (cl.categoria_gap === 'SINDICADA_DUPLICADA_LOW_VALUE') agg.solo_pc_sindicado++;
      if (esGapAccionable(cl.categoria_gap)) {
        agg.solo_pc_accionable++;
        const medio = txt(r['medio']); const kw = txt(r['keyword']);
        if (medio) gapTopMedios.set(medio, (gapTopMedios.get(medio) ?? 0) + 1);
        if (kw) gapTopKeywords.set(kw, (gapTopKeywords.get(kw) ?? 0) + 1);
        gapsAccionables.push({ cliente: nombre, medio, keyword: kw, titulo: txt(r['titulo']), categoria: cl.categoria_gap, prioridad: cl.prioridad_gap });
      }
    }
  }

  // ── 10: alertas sombra ──
  let p1Global = 0, dupGlobal = 0, clusterGlobal = 0, alertasGlobal = 0;
  for (const r of filas10) {
    const { id, nombre } = clienteKey(r);
    const agg = getAgg(id, nombre);
    agg.alertas_total++; alertasGlobal++;
    const esP1 = bool(r['es_p1']) || txt(r['estado_alerta']).toUpperCase() === 'P1' || txt(r['estado_shadow']).toUpperCase() === 'P1_INMEDIATA';
    const esDup = bool(r['es_duplicada']) || txt(r['estado_alerta']).toUpperCase() === 'DUPLICADA' || txt(r['estado_shadow']).toUpperCase() === 'DUPLICADA';
    if (esP1) { agg.p1++; p1Global++; }
    if (esDup) { agg.duplicadas++; dupGlobal++; }
    if (txt(r['cluster_id'])) { agg.con_cluster++; clusterGlobal++; }
  }

  // ── 08: cobertura de medios (conteos de estado de fuente) ──
  let readyNoCron = 0, repairable = 0, blocked = 0;
  const cronSet = new Set<string>(mediosYaCubiertosPorCron());
  for (const m of mediosDailyNetNew()) cronSet.add(m.medio_id);
  for (const r of filas08) {
    const medioId = txt(r['medio_id']);
    const estado = (txt(r['estado_fuente']) || txt(r['estado']) || txt(r['ultimo_estado'])).toUpperCase();
    const enCron = medioId ? cronSet.has(medioId) : false;
    if (/READY/.test(estado) && !enCron) readyNoCron++;
    if (/REPAIRABLE|REPARABLE/.test(estado)) repairable++;
    if (/BLOCK|BLOQUEAD|403|PAYWALL|TIMEOUT/.test(estado)) blocked++;
  }
  const mediosEnCron = cronSet.size;

  // ── 07: último run ──
  const ultimo07 = filas07.length > 0 ? filas07[filas07.length - 1]! : {};
  const ultimoRun = {
    run_id: txt(ultimo07['run_id']),
    pressclipping_registros: txt(ultimo07['pressclipping_registros']),
    ethos_menciones: txt(ultimo07['ethos_menciones']),
    match: txt(ultimo07['match']),
    solo_pressclipping: txt(ultimo07['solo_pressclipping']),
    solo_ethos: txt(ultimo07['solo_ethos']),
    cobertura_bruta: txt(ultimo07['cobertura_bruta']),
    cobertura_ajustada: txt(ultimo07['cobertura_ajustada']),
  };

  // ── Readiness por cliente (excluyendo CLI-PRUEBA de ejecutivo) ──
  const alertasScoreGlobal = pct(clusterGlobal, alertasGlobal); // % de alertas con cluster_id
  const porCliente = [...clientes.values()].map((a) => {
    const denomCobertura = a.match + a.solo_pc_accionable;
    const cobertura_vs_pc = denomCobertura === 0 ? (a.match > 0 ? 100 : 0) : pct(a.match, denomCobertura);
    const gap_real_estimado = pct(a.solo_pc_accionable, a.solo_pc_total || 1);
    const precision_estimada = a.solo_ethos_total === 0 ? (a.match > 0 ? 90 : 50) : pct(a.solo_ethos_valid, a.solo_ethos_total);
    const alertas_score = a.alertas_total === 0 ? 0 : pct(a.con_cluster, a.alertas_total);
    const estado = estadoReadiness({
      cobertura_vs_pc, gap_real_estimado, precision_estimada,
      extraccion_score: extraccionScore, alertas_score, es_prueba: a.es_prueba,
    });
    return {
      cliente_id: a.cliente_id, cliente: a.cliente, es_prueba: a.es_prueba,
      match: a.match, solo_pc_total: a.solo_pc_total, solo_pc_accionable: a.solo_pc_accionable,
      solo_ethos_total: a.solo_ethos_total, p1: a.p1, duplicadas: a.duplicadas,
      cobertura_vs_pc, gap_real_estimado, precision_estimada,
      extraccion_score: extraccionScore, alertas_score,
      estado_readiness: estado, siguiente_accion: siguienteAccion(estado),
    };
  }).sort((x, y) => x.cliente_id.localeCompare(y.cliente_id));

  const ejecutivos = porCliente.filter((c) => !c.es_prueba);
  const soloPcTotal = ejecutivos.reduce((s, c) => s + c.solo_pc_total, 0);
  const soloPcAccionable = ejecutivos.reduce((s, c) => s + c.solo_pc_accionable, 0);
  const matchTotal = ejecutivos.reduce((s, c) => s + c.match, 0);

  const resumen = {
    readiness_excluye_cli_prueba: true,
    ultimo_run: ultimoRun,
    cobertura_bruta_pct: pct(matchTotal, matchTotal + soloPcTotal),
    cobertura_ajustada_pct: pct(matchTotal, matchTotal + soloPcAccionable),
    solo_pressclipping: soloPcTotal,
    solo_pressclipping_accionable: soloPcAccionable,
    solo_pressclipping_false_positive: gapPorCategoria.get('PC_FALSE_POSITIVE') ?? 0,
    solo_pressclipping_sindicado: gapPorCategoria.get('SINDICADA_DUPLICADA_LOW_VALUE') ?? 0,
    solo_ethos: ejecutivos.reduce((s, c) => s + c.solo_ethos_total, 0),
    p1_total: p1Global,
    duplicadas_alerta: dupGlobal,
    alertas_total: alertasGlobal,
    alertas_con_cluster_id: clusterGlobal,
    alertas_con_cluster_id_pct: alertasScoreGlobal,
    medios_en_cron: mediosEnCron,
    medios_ready_no_cron: readyNoCron,
    medios_repairable: repairable,
    medios_blocked: blocked,
    extraccion_score: extraccionScore,
  };

  const gapCategorias = [...gapPorCategoria.entries()]
    .map(([categoria, cantidad]) => ({ categoria, cantidad, porcentaje: pct(cantidad, soloPcTotal || 1) }))
    .sort((a, b) => b.cantidad - a.cantidad);
  const topMedios = [...gapTopMedios.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const topKeywords = [...gapTopKeywords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const top20Gaps = gapsAccionables
    .sort((a, b) => (a.prioridad === 'ALTA' ? -1 : 1) - (b.prioridad === 'ALTA' ? -1 : 1))
    .slice(0, 20);

  logger.info(resumen, 'Resumen de readiness (métricas ejecutivas sin CLI-PRUEBA).');
  logger.info({ gap_categorias: gapCategorias }, 'SOLO_PRESSCLIPPING por categoría.');
  logger.info({ top_medios_gap: topMedios, top_keywords_gap: topKeywords }, 'Top medios/keywords con gap accionable.');
  for (const c of porCliente) {
    logger.info(
      {
        cliente_id: c.cliente_id, cliente: c.cliente, es_prueba: c.es_prueba,
        cobertura_vs_pc: c.cobertura_vs_pc, gap_real_estimado: c.gap_real_estimado,
        precision_estimada: c.precision_estimada, extraccion_score: c.extraccion_score,
        alertas_score: c.alertas_score, estado_readiness: c.estado_readiness,
        siguiente_accion: c.siguiente_accion,
      },
      '[cliente]',
    );
  }

  // Nota lista para 07.notas (NO se escribe a 07 en este script; ver reporte).
  const notaReadiness = [
    'readiness_excluye_cli_prueba=true',
    `readiness_global=${resumen.cobertura_ajustada_pct}`,
    ...ejecutivos.map((c) => `readiness_${c.cliente_id.toLowerCase().replace(/[^a-z0-9]/g, '')}=${c.estado_readiness}`),
    `solo_pc_accionable_pct=${pct(soloPcAccionable, soloPcTotal || 1)}`,
    `alertas_con_cluster_id=${clusterGlobal}`,
  ].join('; ');
  logger.info({ nota_para_07: notaReadiness }, 'Nota readiness sugerida para 07.notas (no escrita).');

  if (args.json) {
    try {
      mkdirSync('data', { recursive: true });
      writeFileSync(
        'data/audit-replacement-readiness.json',
        JSON.stringify({ resumen, gapCategorias, topMedios, topKeywords, porCliente, top20Gaps, notaReadiness }, null, 2),
        'utf8',
      );
      logger.info({ archivo: 'data/audit-replacement-readiness.json' }, 'JSON escrito (no commitear data/).');
    } catch (e) {
      logger.warn({ error: e instanceof Error ? e.message : String(e) }, 'No se pudo escribir JSON local.');
    }
  }

  logger.info('=== Auditoría de readiness completada (sin escrituras, sin envíos) ===');
}

main().catch((err) => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en audit-replacement-readiness');
  process.exit(1);
});
