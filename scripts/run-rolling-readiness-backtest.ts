/**
 * Rolling Readiness Backtest — métricas diarias por cliente/persona (solo Supabase).
 *
 * Lee menciones de los últimos N días, agrupa por fecha+cliente y calcula:
 * menciones detectadas, alertas shadow P1/P2/P3, keyword diversity, texto ok.
 *
 * SOLO LECTURA. Sin escrituras a Sheets. Sin envíos. Sin IA.
 *
 * Complementa audit-replacement-readiness (que compara vs PressClipping en Sheets).
 * Este script mide tendencia y actividad real dentro de Supabase.
 *
 * Clientes incluidos: CLI-0001, CLI-0002, CLI-0003, CLI-MERY-TEST.
 * Excluye: CLI-PRUEBA y variantes de prueba.
 *
 * Uso:
 *   npm run rolling-readiness-backtest                    # ventana 7 días
 *   npm run rolling-readiness-backtest -- --window-days=14
 *   npm run rolling-readiness-backtest -- --window-days=30 --json
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';
import { esClientePrueba } from '../src/comparators/replacementReadiness.js';

// ─── Clientes de interés ─────────────────────────────────────────────────────
const CLIENTES_OBJETIVO = new Set(['CLI-0001', 'CLI-0002', 'CLI-0003', 'CLI-MERY-TEST']);
const SHADOW_ONLY_CLIENTES = new Set(['CLI-MERY-TEST']); // sin comparativo PressClipping

// ─── Estados extendidos para rolling backtest ────────────────────────────────
type EstadoBacktest =
  | 'ACTIVO_ESTABLE'
  | 'ACTIVO_CON_SENALES'
  | 'SIN_ACTIVIDAD_RECIENTE'
  | 'SHADOW_CONFIG_OK_SIN_DATOS'
  | 'SOLO_TEST'
  | 'SIN_DATOS';

const _IDS_PRUEBA_ESTADO = new Set(['CLI-PRUEBA']);

function estadoBacktest(opts: {
  clienteId: string;
  totalMenciones: number;
  diasConActividad: number;
  windowDays: number;
  isShadowOnly: boolean;
}): EstadoBacktest {
  const { clienteId, totalMenciones, diasConActividad, windowDays, isShadowOnly } = opts;
  if (_IDS_PRUEBA_ESTADO.has(clienteId)) return 'SOLO_TEST';
  if (isShadowOnly && totalMenciones === 0) return 'SHADOW_CONFIG_OK_SIN_DATOS';
  if (totalMenciones === 0) return 'SIN_ACTIVIDAD_RECIENTE';
  const densidad = diasConActividad / windowDays;
  if (densidad >= 0.5) return 'ACTIVO_ESTABLE';
  return 'ACTIVO_CON_SENALES';
}

// ─── Argparse ────────────────────────────────────────────────────────────────
interface Args { windowDays: number; json: boolean; }
function parseArgs(argv: string[]): Args {
  const out: Args = { windowDays: 7, json: false };
  for (const arg of argv) {
    if (arg === '--json') { out.json = true; continue; }
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'window-days') out.windowDays = parseIntOrNull(val) ?? out.windowDays;
  }
  return out;
}

// ─── Tipos ───────────────────────────────────────────────────────────────────
interface DiaCliente {
  fecha: string;
  cliente_id: string;
  menciones: number;
  con_alerta: number;
  keywords_distintas: Set<string>;
  con_texto: number;
  scores: number[];
}

interface ResumenCliente {
  cliente_id: string;
  total_menciones: number;
  dias_con_actividad: number;
  total_alertas: number;
  keywords_distintas: number;
  promedio_score: number;
  max_score: number;
  estado: EstadoBacktest;
  dias: DiaResult[];
}

interface DiaResult {
  fecha: string;
  menciones: number;
  con_alerta: number;
  keywords: number;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sb = getSupabase();

  logger.info(
    { windowDays: args.windowDays, clientes: [...CLIENTES_OBJETIVO].join(',') },
    '=== Rolling Readiness Backtest (SOLO LECTURA — sin writes, sin envíos) ===',
  );

  const fechaDesde = new Date();
  fechaDesde.setDate(fechaDesde.getDate() - args.windowDays);
  const isoDesde = fechaDesde.toISOString();

  // ── Leer menciones del período ───────────────────────────────────────────
  const { data: raw, error } = await sb
    .from('menciones')
    .select('mencion_id, cliente_id, keyword_id, keyword, requiere_alerta, score_relevancia, created_at, noticias(texto_cuerpo_nota, texto_nota_limpia, texto_extraido)')
    .gte('created_at', isoDesde)
    .order('created_at', { ascending: true })
    .limit(5000);

  if (error) { logger.error({ error: error.message }, 'Error leyendo menciones'); process.exit(1); }

  const menciones = (raw ?? []) as any[];
  logger.info({ total_menciones_periodo: menciones.length, desde: isoDesde }, 'Menciones leídas del período');

  // ── Construir índice por fecha+cliente ───────────────────────────────────
  const idx = new Map<string, DiaCliente>();

  for (const m of menciones) {
    const clienteId = String(m.cliente_id ?? '');
    if (!CLIENTES_OBJETIVO.has(clienteId)) continue;
    const fecha = String(m.created_at ?? '').slice(0, 10);
    const key = `${fecha}::${clienteId}`;
    let dc = idx.get(key);
    if (!dc) {
      dc = { fecha, cliente_id: clienteId, menciones: 0, con_alerta: 0, keywords_distintas: new Set(), con_texto: 0, scores: [] };
      idx.set(key, dc);
    }
    dc.menciones++;
    if (m.requiere_alerta === true) dc.con_alerta++;
    if (m.keyword_id) dc.keywords_distintas.add(m.keyword_id);
    if (m.score_relevancia != null) dc.scores.push(Number(m.score_relevancia));
    const n = m.noticias;
    if (n && (n.texto_cuerpo_nota || n.texto_nota_limpia || n.texto_extraido)) dc.con_texto++;
  }

  // ── Agregar por cliente ──────────────────────────────────────────────────
  const porCliente = new Map<string, ResumenCliente>();

  // Inicializar todos los clientes objetivo (incluyendo los sin datos).
  // No usar esClientePrueba(id, id) porque el regex "test" falsamente excluiría CLI-MERY-TEST.
  // Solo excluimos ids que son EXPLICITAMENTE de prueba (no shadow reales).
  const IDS_PRUEBA = new Set(['CLI-PRUEBA']);
  for (const cid of CLIENTES_OBJETIVO) {
    if (IDS_PRUEBA.has(cid)) continue;
    porCliente.set(cid, {
      cliente_id: cid,
      total_menciones: 0,
      dias_con_actividad: 0,
      total_alertas: 0,
      keywords_distintas: 0,
      promedio_score: 0,
      max_score: 0,
      estado: 'SIN_DATOS',
      dias: [],
    });
  }

  // Poblar desde el índice
  for (const dc of idx.values()) {
    const res = porCliente.get(dc.cliente_id);
    if (!res) continue;
    res.total_menciones += dc.menciones;
    res.dias_con_actividad++;
    res.total_alertas += dc.con_alerta;
    for (const kw of dc.keywords_distintas) {
      res.keywords_distintas++;
    }
    res.dias.push({ fecha: dc.fecha, menciones: dc.menciones, con_alerta: dc.con_alerta, keywords: dc.keywords_distintas.size });
  }

  // Fix: keywords_distintas debería ser únicas por cliente (no suma de días)
  // Recalcular desde idx
  const kwPorCliente = new Map<string, Set<string>>();
  const scoresPorCliente = new Map<string, number[]>();
  for (const dc of idx.values()) {
    if (!CLIENTES_OBJETIVO.has(dc.cliente_id)) continue;
    let kwSet = kwPorCliente.get(dc.cliente_id);
    if (!kwSet) { kwSet = new Set(); kwPorCliente.set(dc.cliente_id, kwSet); }
    for (const kw of dc.keywords_distintas) kwSet.add(kw);
    let scores = scoresPorCliente.get(dc.cliente_id);
    if (!scores) { scores = []; scoresPorCliente.set(dc.cliente_id, scores); }
    scores.push(...dc.scores);
  }

  for (const res of porCliente.values()) {
    res.keywords_distintas = kwPorCliente.get(res.cliente_id)?.size ?? 0;
    const scores = scoresPorCliente.get(res.cliente_id) ?? [];
    res.promedio_score = scores.length > 0 ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100 : 0;
    res.max_score = scores.length > 0 ? Math.max(...scores) : 0;
    res.dias.sort((a, b) => a.fecha.localeCompare(b.fecha));
    res.estado = estadoBacktest({
      clienteId: res.cliente_id,
      totalMenciones: res.total_menciones,
      diasConActividad: res.dias_con_actividad,
      windowDays: args.windowDays,
      isShadowOnly: SHADOW_ONLY_CLIENTES.has(res.cliente_id),
    });
  }

  // ── Reporte ──────────────────────────────────────────────────────────────
  logger.info(
    { window_days: args.windowDays, clientes_analizados: porCliente.size },
    '=== RESUMEN ROLLING BACKTEST ===',
  );

  const resultados: any[] = [];
  for (const res of porCliente.values()) {
    logger.info(
      {
        cliente_id: res.cliente_id,
        total_menciones: res.total_menciones,
        dias_con_actividad: res.dias_con_actividad,
        total_alertas: res.total_alertas,
        keywords_distintas: res.keywords_distintas,
        promedio_score: res.promedio_score,
        max_score: res.max_score,
        estado: res.estado,
        dias_detalle: res.dias.slice(-3),
      },
      '[backtest] cliente',
    );
    resultados.push({
      cliente_id: res.cliente_id,
      window_days: args.windowDays,
      total_menciones: res.total_menciones,
      dias_con_actividad: res.dias_con_actividad,
      total_alertas: res.total_alertas,
      keywords_distintas: res.keywords_distintas,
      promedio_score: res.promedio_score,
      max_score: res.max_score,
      estado: res.estado,
      dias: res.dias,
    });
  }

  if (args.json) {
    try { mkdirSync('data', { recursive: true }); } catch { /* ya existe */ }
    const out = { generado: new Date().toISOString(), window_days: args.windowDays, clientes: resultados };
    writeFileSync('data/rolling-readiness-backtest.json', JSON.stringify(out, null, 2), 'utf8');
    logger.info({ archivo: 'data/rolling-readiness-backtest.json' }, 'JSON escrito (no commitear data/).');
  }

  logger.info({ note: 'NADA ESCRITO en Supabase ni Sheets.' }, '=== FIN rolling backtest ===');
}

main().catch((e) => { console.error(e); process.exit(1); });
