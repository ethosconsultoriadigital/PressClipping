/**
 * Generador de reporte diario interno shadow.
 *
 * SOLO LECTURA. Sin Sheets, SMTP, Google Docs ni IA.
 * No activa alertas_activas. No llama generate-xml, classify-ia, export-results.
 *
 * Salida: data/reporte-diario-YYYY-MM-DD.md
 *
 * Uso:
 *   npm run generate-shadow-report
 *   npm run generate-shadow-report -- --window-days=7
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

// ─── Configuración ────────────────────────────────────────────────────────────

const CLIENTES_OBJETIVO = new Set(['CLI-0001', 'CLI-0002', 'CLI-0003', 'CLI-MERY-TEST']);
const SHADOW_ONLY_CLIENTES = new Set(['CLI-MERY-TEST']);

const NOMBRES_CLIENTES: Record<string, string> = {
  'CLI-0001': 'Jumex',
  'CLI-0002': 'Bebidas alcohólicas / tequila',
  'CLI-0003': 'Reforma laboral',
  'CLI-MERY-TEST': 'Mery Pozos / Merilyn Gómez Pozos',
};

const AUDIT_PATH = 'data/audit-replacement-readiness.json';

// ─── Tipos exportados ─────────────────────────────────────────────────────────

export type EstadoBacktest =
  | 'ACTIVO_ESTABLE'
  | 'ACTIVO_CON_SENALES'
  | 'SIN_ACTIVIDAD_RECIENTE'
  | 'SHADOW_CONFIG_OK_SIN_DATOS'
  | 'SIN_DATOS';

export interface BacktestResult {
  total_menciones: number;
  dias_con_actividad: number;
  total_alertas: number;
  keywords_distintas: number;
  promedio_score: number;
  max_score: number;
  estado: EstadoBacktest;
}

// ─── Funciones puras exportadas (para tests) ──────────────────────────────────

/** Misma lógica que run-rolling-readiness-backtest.ts para coherencia. */
export function calcEstado(opts: {
  clienteId: string;
  totalMenciones: number;
  diasConActividad: number;
  windowDays: number;
  isShadowOnly: boolean;
}): EstadoBacktest {
  const { totalMenciones, diasConActividad, windowDays, isShadowOnly } = opts;
  if (isShadowOnly && totalMenciones === 0) return 'SHADOW_CONFIG_OK_SIN_DATOS';
  if (totalMenciones === 0) return 'SIN_ACTIVIDAD_RECIENTE';
  const densidad = diasConActividad / windowDays;
  if (densidad >= 0.5) return 'ACTIVO_ESTABLE';
  return 'ACTIVO_CON_SENALES';
}

export function parseArgs(argv: string[]): { windowDays: number } {
  const out = { windowDays: 7 };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'window-days') out.windowDays = parseIntOrNull(val) ?? out.windowDays;
  }
  return out;
}

/** Agrega menciones por cliente para el rolling backtest. Misma lógica que run-rolling-readiness-backtest. */
export function computeRollingBacktest(
  menciones: any[],
  windowDays: number,
): Map<string, BacktestResult> {
  type DayEntry = { menciones: number; alertas: number; keywords: Set<string>; scores: number[] };
  const dayIdx = new Map<string, DayEntry>();

  for (const m of menciones) {
    const clienteId = String(m.cliente_id ?? '');
    if (!CLIENTES_OBJETIVO.has(clienteId)) continue;
    const fecha = String(m.created_at ?? '').slice(0, 10);
    const k = `${fecha}::${clienteId}`;
    let d = dayIdx.get(k);
    if (!d) {
      d = { menciones: 0, alertas: 0, keywords: new Set(), scores: [] };
      dayIdx.set(k, d);
    }
    d.menciones++;
    if (m.requiere_alerta === true) d.alertas++;
    if (m.keyword_id) d.keywords.add(String(m.keyword_id));
    if (m.score_relevancia != null) d.scores.push(Number(m.score_relevancia));
  }

  const kwByClient = new Map<string, Set<string>>();
  const scoresByClient = new Map<string, number[]>();
  const daysByClient = new Map<string, Set<string>>();
  const alertasByClient = new Map<string, number>();
  const mencionsByClient = new Map<string, number>();

  for (const [k, d] of dayIdx) {
    const sep = k.indexOf('::');
    const fecha = sep === -1 ? '' : k.slice(0, sep);
    const clienteId = sep === -1 ? '' : k.slice(sep + 2);
    if (!clienteId) continue;

    let kws = kwByClient.get(clienteId);
    if (!kws) { kws = new Set(); kwByClient.set(clienteId, kws); }
    for (const kw of d.keywords) kws.add(kw);

    let sc = scoresByClient.get(clienteId);
    if (!sc) { sc = []; scoresByClient.set(clienteId, sc); }
    sc.push(...d.scores);

    let dias = daysByClient.get(clienteId);
    if (!dias) { dias = new Set(); daysByClient.set(clienteId, dias); }
    dias.add(fecha);

    alertasByClient.set(clienteId, (alertasByClient.get(clienteId) ?? 0) + d.alertas);
    mencionsByClient.set(clienteId, (mencionsByClient.get(clienteId) ?? 0) + d.menciones);
  }

  const result = new Map<string, BacktestResult>();

  for (const clienteId of CLIENTES_OBJETIVO) {
    const totalMenciones = mencionsByClient.get(clienteId) ?? 0;
    const diasConActividad = daysByClient.get(clienteId)?.size ?? 0;
    const totalAlertas = alertasByClient.get(clienteId) ?? 0;
    const kwDistintas = kwByClient.get(clienteId)?.size ?? 0;
    const scores = scoresByClient.get(clienteId) ?? [];
    const promedioScore =
      scores.length > 0
        ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
        : 0;
    const maxScore = scores.length > 0 ? Math.max(...scores) : 0;

    result.set(clienteId, {
      total_menciones: totalMenciones,
      dias_con_actividad: diasConActividad,
      total_alertas: totalAlertas,
      keywords_distintas: kwDistintas,
      promedio_score: promedioScore,
      max_score: maxScore,
      estado: calcEstado({
        clienteId,
        totalMenciones,
        diasConActividad,
        windowDays,
        isShadowOnly: SHADOW_ONLY_CLIENTES.has(clienteId),
      }),
    });
  }

  return result;
}

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface AuditResumen {
  cobertura_bruta_pct: number;
  cobertura_ajustada_pct: number;
  solo_pressclipping: number;
  solo_pressclipping_accionable: number;
  solo_ethos: number;
  gapCategorias: Array<{ categoria: string; cantidad: number; porcentaje: number }>;
  topMedios: Array<[string, number]>;
  topKeywords: Array<[string, number]>;
}

// ─── Carga de datos auxiliares ────────────────────────────────────────────────

function loadAuditData(): AuditResumen | null {
  if (!existsSync(AUDIT_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(AUDIT_PATH, 'utf8')) as any;
    const result: AuditResumen = {
      cobertura_bruta_pct: Number(raw?.resumen?.cobertura_bruta_pct ?? 0),
      cobertura_ajustada_pct: Number(raw?.resumen?.cobertura_ajustada_pct ?? 0),
      solo_pressclipping: Number(raw?.resumen?.solo_pressclipping ?? 0),
      solo_pressclipping_accionable: Number(raw?.resumen?.solo_pressclipping_accionable ?? 0),
      solo_ethos: Number(raw?.resumen?.solo_ethos ?? 0),
      gapCategorias: Array.isArray(raw?.gapCategorias) ? (raw.gapCategorias as Array<{ categoria: string; cantidad: number; porcentaje: number }>) : [],
      topMedios: Array.isArray(raw?.topMedios) ? (raw.topMedios as Array<[string, number]>) : [],
      topKeywords: Array.isArray(raw?.topKeywords) ? (raw.topKeywords as Array<[string, number]>) : [],
    };
    return result;
  } catch {
    return null;
  }
}

// ─── Generador de markdown ────────────────────────────────────────────────────

function buildMarkdown(opts: {
  fecha: string;
  runId: string;
  windowDays: number;
  menciones24h: any[];
  menciones7d: any[];
  keywords: Map<string, { alerta: boolean; prioridad: string | null }>;
  backtest7d: Map<string, BacktestResult>;
  audit: AuditResumen | null;
}): string {
  const { fecha, runId, windowDays, menciones24h, menciones7d, keywords, backtest7d, audit } = opts;

  // ─ Filtrar clientes objetivo ─────────────────────────────────────────────
  const m24 = menciones24h.filter((m: any) => CLIENTES_OBJETIVO.has(String(m.cliente_id ?? '')));

  // ─ Noticias distintas con menciones (24h) ────────────────────────────────
  const noticias24hIds = new Set<string>();
  for (const m of m24) {
    const nid = String(m.noticia_id ?? '');
    if (nid) noticias24hIds.add(nid);
  }

  // ─ P1/P2/P3 y alertas detalle ────────────────────────────────────────────
  let p1 = 0, p2 = 0, p3 = 0;
  type AlertaRow = { cliente: string; keyword: string; medio: string; titulo: string; motivo: string; url: string; prioridad: string };
  const alertasDetalle: AlertaRow[] = [];

  for (const m of m24) {
    if (m.requiere_alerta !== true) continue;
    const kwData = keywords.get(String(m.keyword_id ?? ''));
    const prioridad = kwData?.prioridad ?? 'P3';
    if (prioridad === 'P1') p1++;
    else if (prioridad === 'P2') p2++;
    else p3++;
    const noticia = m.noticias as any;
    const medio = noticia?.medios as any;
    const cliente = m.clientes as any;
    alertasDetalle.push({
      cliente: String(cliente?.nombre_cliente ?? m.cliente_id ?? ''),
      keyword: String(m.keyword ?? ''),
      medio: String(medio?.nombre_medio ?? 'desconocido'),
      titulo: String(noticia?.titulo ?? 'sin título'),
      motivo: `requiere_alerta (keyword ${prioridad})`,
      url: String(noticia?.url_original ?? ''),
      prioridad,
    });
  }
  alertasDetalle.sort((a, b) => a.prioridad.localeCompare(b.prioridad));

  // ─ Top 5 menciones por score ─────────────────────────────────────────────
  type MencionTop = { cliente: string; keyword: string; medio: string; titulo: string; score: number; extracto: string };
  const top5: MencionTop[] = [...m24]
    .filter((m: any) => m.score_relevancia != null)
    .sort((a: any, b: any) => Number(b.score_relevancia) - Number(a.score_relevancia))
    .slice(0, 5)
    .map((m: any): MencionTop => {
      const noticia = m.noticias as any;
      const medio = noticia?.medios as any;
      const cliente = m.clientes as any;
      const textoRaw = String(noticia?.texto_nota_limpia ?? noticia?.texto_cuerpo_nota ?? noticia?.texto_extraido ?? '');
      return {
        cliente: String(cliente?.nombre_cliente ?? m.cliente_id ?? ''),
        keyword: String(m.keyword ?? ''),
        medio: String(medio?.nombre_medio ?? 'desconocido'),
        titulo: String(noticia?.titulo ?? 'sin título'),
        score: Number(m.score_relevancia),
        extracto: textoRaw.slice(0, 120).replace(/\n/g, ' '),
      };
    });

  // ─ Calidad de texto 24h ──────────────────────────────────────────────────
  let conTexto24h = 0;
  const seenNoticias24h = new Set<string>();
  for (const m of m24) {
    const nid = String(m.noticia_id ?? '');
    if (!nid || seenNoticias24h.has(nid)) continue;
    seenNoticias24h.add(nid);
    const noticia = m.noticias as any;
    if (noticia?.texto_cuerpo_nota || noticia?.texto_nota_limpia || noticia?.texto_extraido) conTexto24h++;
  }
  const totalNotas24h = seenNoticias24h.size;
  const pctOk = totalNotas24h > 0 ? Math.round((conTexto24h / totalNotas24h) * 100) : 0;
  const pctVacio = 100 - pctOk;

  // ─ Medios stats (7d) ─────────────────────────────────────────────────────
  const medioMap = new Map<string, { menciones: number; con_texto: number }>();
  for (const m of menciones7d) {
    if (!CLIENTES_OBJETIVO.has(String(m.cliente_id ?? ''))) continue;
    const noticia = m.noticias as any;
    const medio = noticia?.medios as any;
    const nom = String(medio?.nombre_medio ?? '');
    if (!nom) continue;
    let ms = medioMap.get(nom);
    if (!ms) { ms = { menciones: 0, con_texto: 0 }; medioMap.set(nom, ms); }
    ms.menciones++;
    if (noticia?.texto_cuerpo_nota || noticia?.texto_nota_limpia || noticia?.texto_extraido) ms.con_texto++;
  }

  const mediosOrdenados = [...medioMap.entries()]
    .map(([nombre, s]) => ({
      nombre,
      menciones: s.menciones,
      con_texto: s.con_texto,
      pct: Math.round((s.con_texto / Math.max(s.menciones, 1)) * 100),
    }))
    .sort((a, b) => b.menciones - a.menciones);

  const top10Medios = mediosOrdenados.slice(0, 10);
  const mediosProblematicos = mediosOrdenados.filter(m => m.pct < 50 && m.menciones >= 3);

  // ─ Resumen 24h por cliente ───────────────────────────────────────────────
  const c24byClient = new Map<string, { menciones: number; alertas: number }>();
  for (const m of m24) {
    const cid = String(m.cliente_id ?? '');
    let cs = c24byClient.get(cid);
    if (!cs) { cs = { menciones: 0, alertas: 0 }; c24byClient.set(cid, cs); }
    cs.menciones++;
    if (m.requiere_alerta === true) cs.alertas++;
  }

  type ClienteRow = { cliente_id: string; nombre: string; menciones_24h: number; alertas_24h: number; estado_backtest: string; estado_readiness: string };
  const clientes: ClienteRow[] = [...CLIENTES_OBJETIVO].map(cid => {
    const b = backtest7d.get(cid);
    const c24 = c24byClient.get(cid) ?? { menciones: 0, alertas: 0 };
    return {
      cliente_id: cid,
      nombre: NOMBRES_CLIENTES[cid] ?? cid,
      menciones_24h: c24.menciones,
      alertas_24h: c24.alertas,
      estado_backtest: b?.estado ?? 'SIN_DATOS',
      estado_readiness: cid === 'CLI-MERY-TEST' ? 'N/A' : 'NO_LISTO',
    };
  });

  const mery7d = backtest7d.get('CLI-MERY-TEST');
  const mery24 = c24byClient.get('CLI-MERY-TEST') ?? { menciones: 0, alertas: 0 };

  // ─ Riesgos derivados ─────────────────────────────────────────────────────
  const riesgos: Array<{ riesgo: string; nivel: string; accion: string }> = [];
  if (pctOk < 80) riesgos.push({ riesgo: `Texto limpio < 80% (${pctOk}% hoy)`, nivel: 'Medio', accion: 'enrich-news para medios prioritarios' });
  if (p1 > 0) riesgos.push({ riesgo: `${p1} alertas P1 sin revisar`, nivel: 'Alto', accion: 'Revisar y confirmar FP o escalar' });
  if (mediosProblematicos.length > 0) riesgos.push({ riesgo: `${mediosProblematicos.length} medios con < 50% texto limpio (≥3 menciones)`, nivel: 'Medio', accion: 'enrich-news o revisar extractor' });
  if (mery24.menciones === 0) riesgos.push({ riesgo: 'Mery Pozos: 0 menciones hoy', nivel: 'Info', accion: 'Revisar fuentes Jalisco/político en cron' });
  riesgos.push({ riesgo: '10_Alertas_Sombra mismatch', nivel: 'Alto', accion: 'verificar write.ts / Sheets (si se corrió shadow-alerts)' });

  // ─ Construir markdown ────────────────────────────────────────────────────
  const L: string[] = [];

  L.push('# Reporte Diario Interno Shadow — Ethos PR Intelligence');
  L.push('');
  L.push('_Modo shadow only. Sin envíos reales. Para uso interno del equipo Ethos._');
  L.push('');
  L.push('---');
  L.push('');

  // §1 Resumen ejecutivo
  L.push('## 1. Resumen ejecutivo');
  L.push('');
  L.push('| campo | valor |');
  L.push('|---|---|');
  L.push(`| Fecha | ${fecha} |`);
  L.push(`| Run ID | ${runId} |`);
  L.push(`| Noticias con menciones (24h) | ${noticias24hIds.size} |`);
  L.push(`| Menciones detectadas (24h) | ${m24.length} |`);
  L.push(`| Alertas shadow candidatas | ${alertasDetalle.length} |`);
  L.push(`| P1 inmediatas | ${p1} |`);
  L.push(`| P2 resumen | ${p2} |`);
  L.push(`| P3 dashboard | ${p3} |`);
  L.push('| Clientes activos | CLI-0001, CLI-0002, CLI-0003, CLI-MERY-TEST |');
  L.push('| Envíos reales | 0 (shadow only) |');
  L.push('| Mismatch Sheets | N/D |');
  L.push('');
  L.push('---');
  L.push('');

  // §2 Estado por cliente
  L.push('## 2. Estado por cliente');
  L.push('');
  L.push('| cliente_id | nombre | menciones_24h | alertas_shadow | estado_backtest | estado_readiness |');
  L.push('|---|---|---|---|---|---|');
  for (const c of clientes) {
    L.push(`| ${c.cliente_id} | ${c.nombre} | ${c.menciones_24h} | ${c.alertas_24h} | ${c.estado_backtest} | ${c.estado_readiness} |`);
  }
  L.push('');
  L.push(`_Backtest ventana: ${windowDays} días._`);
  L.push('');
  L.push('---');
  L.push('');

  // §3 Alertas P1/P2 del día
  L.push('## 3. Alertas P1/P2 del día');
  L.push('');
  L.push('_Nota: sin envío real. Las alertas P1 son solo candidatas para revisión interna._');
  L.push('');
  const alertasP1P2 = alertasDetalle.filter(a => a.prioridad === 'P1' || a.prioridad === 'P2').slice(0, 20);
  if (alertasP1P2.length === 0) {
    L.push('_Sin alertas P1/P2 en las últimas 24h._');
  } else {
    for (const a of alertasP1P2) {
      L.push(`- cliente: ${a.cliente}`);
      L.push(`  keyword: ${a.keyword}`);
      L.push(`  medio: ${a.medio}`);
      L.push(`  título: ${a.titulo}`);
      L.push(`  motivo: ${a.motivo}`);
      if (a.url) L.push(`  URL: ${a.url}`);
      L.push('');
    }
  }
  L.push('---');
  L.push('');

  // §4 Menciones nuevas destacadas
  L.push('## 4. Menciones nuevas destacadas');
  L.push('');
  L.push('Top 5 menciones del día (por score_relevancia):');
  L.push('');
  if (top5.length === 0) {
    L.push('_Sin menciones con score registrado hoy._');
  } else {
    top5.forEach((md, i) => {
      L.push(`${i + 1}. cliente: ${md.cliente}`);
      L.push(`   keyword: ${md.keyword}`);
      L.push(`   medio: ${md.medio}`);
      L.push(`   título: ${md.titulo}`);
      L.push(`   score: ${md.score}`);
      L.push(`   texto_match: ${md.extracto || 'sin texto'}`);
      L.push('');
    });
  }
  L.push('---');
  L.push('');

  // §5 Medios con mejor señal
  L.push(`## 5. Medios con mejor señal (últimos ${windowDays} días)`);
  L.push('');
  L.push('| medio | menciones | % con texto limpio |');
  L.push('|---|---|---|');
  if (top10Medios.length === 0) {
    L.push('| sin datos | 0 | 0% |');
  } else {
    for (const m of top10Medios) {
      L.push(`| ${m.nombre} | ${m.menciones} | ${m.pct}% |`);
    }
  }
  L.push('');
  L.push('---');
  L.push('');

  // §6 Medios problemáticos
  L.push('## 6. Medios problemáticos');
  L.push('');
  L.push('| medio | problema | acción recomendada |');
  L.push('|---|---|---|');
  if (mediosProblematicos.length === 0) {
    L.push('| — | sin problemas detectados (umbral: ≥3 menciones, <50% texto) | — |');
  } else {
    for (const m of mediosProblematicos.slice(0, 10)) {
      L.push(`| ${m.nombre} | texto_limpio ${m.pct}% (${m.con_texto}/${m.menciones}) | enrich-news / revisar extractor |`);
    }
  }
  L.push('');
  L.push('---');
  L.push('');

  // §7 Texto limpio
  L.push('## 7. Texto limpio');
  L.push('');
  L.push('| métrica | valor |');
  L.push('|---|---|');
  L.push(`| Noticias con texto (24h) | ${conTexto24h} / ${totalNotas24h} |`);
  L.push(`| % texto OK | ${pctOk}% |`);
  L.push(`| % cuerpo vacío | ${pctVacio}% |`);
  L.push(`| Mediana chars | N/D |`);
  L.push('');
  const fuentesRiesgo = mediosProblematicos.slice(0, 5).map(m => m.nombre).join(', ');
  L.push(`Fuentes de mayor riesgo de boilerplate: ${fuentesRiesgo || 'ninguna detectada con ≥3 menciones y <50% texto'}`);
  L.push('');
  L.push('---');
  L.push('');

  // §8 Gaps PressClipping vs Ethos
  L.push('## 8. Gaps PressClipping vs Ethos');
  L.push('');
  L.push('_Basado en 05_Comparativo_PressClipping y audit-replacement-readiness._');
  L.push('');
  if (audit) {
    L.push('| categoría | cantidad |');
    L.push('|---|---|');
    L.push(`| SOLO_PRESSCLIPPING total | ${audit.solo_pressclipping} |`);
    const pctAccionable = Math.round((audit.solo_pressclipping_accionable / Math.max(audit.solo_pressclipping, 1)) * 100);
    L.push(`| GAP_REAL_ACCIONABLE | ${audit.solo_pressclipping_accionable} (${pctAccionable}%) |`);
    for (const g of audit.gapCategorias) {
      if (g.categoria !== 'GAP_REAL_ACCIONABLE') {
        L.push(`| ${g.categoria} | ${g.cantidad} (${g.porcentaje}%) |`);
      }
    }
    L.push(`| SOLO_ETHOS | ${audit.solo_ethos} |`);
    L.push(`| Cobertura bruta | ${audit.cobertura_bruta_pct}% |`);
    L.push(`| Cobertura ajustada | ${audit.cobertura_ajustada_pct}% |`);
    L.push('');
    if (audit.topMedios.length > 0) {
      const lista = audit.topMedios.slice(0, 5).map(([n, c]) => `${n} (${c})`).join(', ');
      L.push(`Top medios con gap accionable: ${lista}`);
    }
    if (audit.topKeywords.length > 0) {
      const lista = audit.topKeywords.slice(0, 5).map(([n, c]) => `${n} (${c})`).join(', ');
      L.push(`Top keywords con gap: ${lista}`);
    }
  } else {
    L.push('_N/D — ejecutar `npm run audit-replacement-readiness` para actualizar datos._');
  }
  L.push('');
  L.push('---');
  L.push('');

  // §9 Mery Pozos
  L.push('## 9. Mery Pozos / persona pública (CLI-MERY-TEST)');
  L.push('');
  L.push('| campo | valor |');
  L.push('|---|---|');
  L.push(`| Menciones hoy | ${mery24.menciones} |`);
  L.push(`| Matches últimos ${windowDays} días | ${mery7d?.total_menciones ?? 0} |`);
  L.push('| FP detectados | 0 |');
  L.push(`| Estado | ${mery7d?.estado ?? 'SHADOW_CONFIG_OK_SIN_DATOS'} |`);
  L.push('| alertas_activas | false (inmutable hasta autorización) |');
  L.push('| Última simulación | `npm run simulate-mery-pozos-shadow -- --window-days=7` |');
  L.push('');
  L.push('_Sin cobertura hasta ahora. El sistema detectará automáticamente en el próximo crawl._');
  L.push('');
  L.push('---');
  L.push('');

  // §10 Riesgos
  L.push('## 10. Riesgos');
  L.push('');
  L.push('| riesgo | nivel | acción |');
  L.push('|---|---|---|');
  for (const r of riesgos) {
    L.push(`| ${r.riesgo} | ${r.nivel} | ${r.accion} |`);
  }
  L.push('');
  L.push('---');
  L.push('');

  // §11 Siguiente acción
  L.push('## 11. Siguiente acción');
  L.push('');
  L.push('```');
  L.push('Hoy:');
  L.push('[ ] Revisar P1s nuevas → confirmar FP o escalar');
  L.push('[ ] Verificar medios con texto_ok < 80% → escalar a enrich');
  L.push('[ ] Correr rolling-readiness-backtest -- --window-days=7');
  L.push('');
  L.push('Esta semana:');
  L.push('[ ] Evaluar gate GO_ENVIO_INTERNO_LIMITADO para CLI-0002');
  L.push('[ ] Ejecutar simulate-mery-pozos-shadow -- --window-days=7');
  L.push('[ ] Revisar medios accionables con gap Reforma laboral');
  L.push('```');
  L.push('');
  L.push('---');
  L.push('');
  L.push(`_Generado: ${new Date().toISOString()}. Solo lectura. Sin envíos. NADA escrito en Supabase ni Sheets._`);

  return L.join('\n');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const now = new Date();
  const fecha = now.toISOString().slice(0, 10);
  const runId = `SA-${now.toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;

  logger.info({ fecha, runId, windowDays: args.windowDays }, '=== Generando reporte diario interno shadow (SOLO LECTURA) ===');

  const sb = getSupabase();
  const hace24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const haceNd = new Date(now.getTime() - args.windowDays * 24 * 60 * 60 * 1000).toISOString();

  logger.info('Consultando Supabase...');

  const [menciones24hResult, keywordsResult, mencionesNdResult] = await Promise.all([
    sb
      .from('menciones')
      .select(
        'mencion_id, noticia_id, cliente_id, keyword_id, keyword, requiere_alerta, score_relevancia, created_at, noticias(titulo, url_original, texto_cuerpo_nota, texto_nota_limpia, texto_extraido, medios(nombre_medio)), clientes(nombre_cliente)',
      )
      .gte('created_at', hace24h)
      .order('created_at', { ascending: false })
      .limit(2000),

    sb.from('keywords').select('keyword_id, alerta, prioridad'),

    sb
      .from('menciones')
      .select(
        'mencion_id, cliente_id, keyword_id, keyword, requiere_alerta, score_relevancia, created_at, noticias(texto_cuerpo_nota, texto_nota_limpia, texto_extraido, medios(nombre_medio))',
      )
      .gte('created_at', haceNd)
      .order('created_at', { ascending: true })
      .limit(5000),
  ]);

  if (menciones24hResult.error) {
    logger.error({ error: menciones24hResult.error.message }, 'Error leyendo menciones 24h');
    process.exit(1);
  }
  if (mencionesNdResult.error) {
    logger.error({ error: mencionesNdResult.error.message }, `Error leyendo menciones ${args.windowDays}d`);
    process.exit(1);
  }
  if (keywordsResult.error) {
    logger.warn({ error: keywordsResult.error.message }, 'Error en keywords (clasificación P1/P2/P3 no disponible)');
  }

  const menciones24h = (menciones24hResult.data ?? []) as any[];
  const mencionesNd = (mencionesNdResult.data ?? []) as any[];

  logger.info(
    { menciones_24h: menciones24h.length, [`menciones_${args.windowDays}d`]: mencionesNd.length },
    'Datos leídos de Supabase',
  );

  const keywords = new Map<string, { alerta: boolean; prioridad: string | null }>();
  for (const k of (keywordsResult.data ?? []) as any[]) {
    keywords.set(String(k.keyword_id ?? ''), {
      alerta: k.alerta === true,
      prioridad: k.prioridad ?? null,
    });
  }

  const backtest7d = computeRollingBacktest(mencionesNd, args.windowDays);
  const audit = loadAuditData();

  if (audit) {
    logger.info({ audit_path: AUDIT_PATH }, 'Datos de audit-replacement-readiness cargados');
  } else {
    logger.info({ audit_path: AUDIT_PATH }, 'audit-replacement-readiness.json no disponible — §8 mostrará N/D');
  }

  const markdown = buildMarkdown({
    fecha,
    runId,
    windowDays: args.windowDays,
    menciones24h,
    menciones7d: mencionesNd,
    keywords,
    backtest7d,
    audit,
  });

  try { mkdirSync('data', { recursive: true }); } catch { /* ya existe */ }
  const outPath = `data/reporte-diario-${fecha}.md`;
  writeFileSync(outPath, markdown, 'utf8');

  logger.info(
    { archivo: outPath, bytes: markdown.length },
    '=== Reporte generado. NADA escrito en Supabase ni Sheets. ===',
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
