/**
 * Auditor de fuentes de medios — homologación técnica controlada (endurecida).
 *
 * Para cada medio prueba (SIN crawl masivo) su fuente configurada de forma robusta
 * y, solo si no entrega, sus alternativas (RSS/sitemap) con early-exit, robots.txt
 * y la página base. Calcula un confidence_score y clasifica en estados estándar
 * (READY_KEEP_CURRENT, REPAIRABLE_*_HIGH_CONFIDENCE, REPAIRABLE_NEEDS_REVIEW, …).
 * Diseñado para NO romper fuentes buenas (caso Forbes) ni inflar cobertura.
 *
 * Uso:
 *   npm run audit-media-sources -- --only-active --output=console --dry-run
 *   npm run audit-media-sources -- --only-active --output=sheet
 *   npm run audit-media-sources -- --medio-ids=MED-0001 --update-db --output=sheet
 *
 * Flags: --limit=N --medio-ids=.. --only-active --only-errors --include-inactive
 *        --output=console|sheet|csv --update-db --dry-run
 *
 * NO hace crawl masivo. NO toca 01_Noticias_Raw, 05 ni 07. NO corre IA/XML/alertas.
 * --update-db solo repara estados REPAIRABLE_*_HIGH_CONFIDENCE con fuente validada.
 */
import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchText } from '../src/utils/http.js';
import { parseRssString } from '../src/parsers/rss.js';
import { parseSitemapString } from '../src/parsers/sitemap.js';
import { foldText } from '../src/matchers/text.js';
import { replaceOutputRows } from '../src/sheets/write.js';
import { OUTPUT_TABS } from '../src/sheets/client.js';
import { logger } from '../src/utils/logger.js';
import {
  clasificarFuenteMedio,
  esDominioAgregador,
  prioridadReparacion,
  urlsCandidatas,
  UMBRAL_INDICE_MASIVO,
  ESTADOS_REPARABLES_HIGH,
  type AuditVeredicto,
  type FuenteCandidata,
} from '../src/validation/mediaAudit.js';

interface AuditArgs {
  limit?: number;
  medioIds?: Set<string>;
  onlyActive: boolean;
  onlyErrors: boolean;
  includeInactive: boolean;
  output: 'console' | 'sheet' | 'csv';
  updateDb: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): AuditArgs {
  const out: AuditArgs = {
    onlyActive: false, onlyErrors: false, includeInactive: false,
    output: 'console', updateDb: false, dryRun: false,
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'limit': out.limit = Number(val) || undefined; break;
      case 'medio-ids': out.medioIds = new Set(val.split(',').map(s => s.trim()).filter(Boolean)); break;
      case 'only-active': out.onlyActive = true; break;
      case 'only-errors': out.onlyErrors = true; break;
      case 'include-inactive': out.includeInactive = true; break;
      case 'output': out.output = (val as AuditArgs['output']) || 'console'; break;
      case 'update-db': out.updateDb = true; break;
      case 'dry-run': out.dryRun = true; break;
    }
  }
  return out;
}

const fold = (s?: string | null): string => foldText(s ?? '').replace(/\s+/g, ' ').trim();

interface MedioFull {
  medio_id: string;
  nombre_medio: string;
  activo: boolean;
  url_base: string | null;
  metodo_extraccion: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  requiere_javascript: boolean;
  requiere_proxy: boolean;
  pais: string | null;
  prioridad: string | null;
  ultimo_estado: string | null;
  ultimo_error: string | null;
}

const PROBE_TIMEOUT = 8000;
const VENTANA_RECIENTE_DIAS = 30;
/** Recientes mínimas en un índice resuelto para no marcarlo "masivo problemático". */
const MIN_RECIENTES_INDICE = 3;

function hostDe(url: string | null | undefined): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

function dominioCoincide(fuenteUrl: string, base: string | null): boolean {
  const a = hostDe(fuenteUrl);
  const b = hostDe(base);
  if (!a || !b) return false;
  return a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
}

function contarRecientes(fechas: (string | null)[]): { recientes: number; disponibles: boolean } {
  const corte = Date.now() - VENTANA_RECIENTE_DIAS * 86400_000;
  let recientes = 0;
  let disponibles = false;
  for (const f of fechas) {
    if (!f) continue;
    const t = Date.parse(f);
    if (Number.isNaN(t)) continue;
    disponibles = true;
    if (t >= corte) recientes += 1;
  }
  return { recientes, disponibles };
}

interface FetchResult { ok: boolean; status: number; body: string; timeout: boolean; blocked: boolean }

async function fetchCorto(url: string, robust = false): Promise<FetchResult> {
  try {
    const body = await fetchText(url, { timeoutMs: robust ? 12000 : PROBE_TIMEOUT, retries: robust ? 1 : 0 });
    return { ok: true, status: 200, body, timeout: false, blocked: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = Number(msg.match(/HTTP (\d+)/)?.[1] ?? 0);
    return { ok: false, status, body: '', timeout: /abort|timeout/i.test(msg), blocked: status === 401 || status === 403 };
  }
}

/** Evalúa una URL como fuente RSS o sitemap → FuenteCandidata o null. */
async function evaluarFuente(
  url: string, base: string | null, esConfigurada: boolean, robust: boolean,
): Promise<{ cand: FuenteCandidata | null; res: FetchResult }> {
  const res = await fetchCorto(url, robust);
  if (!res.ok) return { cand: null, res };

  // Detectar HTML disfrazado de XML.
  const head = res.body.slice(0, 400).toLowerCase();
  const pareceHtml = /<!doctype html|<html[\s>]/.test(head);

  // ¿RSS?
  if (!pareceHtml) {
    try {
      const items = await parseRssString(res.body);
      if (items.length > 0) {
        const { recientes, disponibles } = contarRecientes(items.map(i => i.fecha ?? null));
        return {
          cand: {
            url, tipo: 'rss', items: items.length, recientes, fechasDisponibles: disponibles,
            dominioOk: dominioCoincide(url, base), esIndiceMasivo: false, esConfigurada,
          }, res,
        };
      }
    } catch { /* no es RSS */ }
  }

  // ¿Sitemap?
  try {
    const parsed = parseSitemapString(res.body);
    let items = parsed.items;
    const esIndice = parsed.subSitemaps.length > 0;
    if (items.length === 0 && parsed.subSitemaps.length > 0) {
      // Resolver varios sub-sitemaps (presupuesto acotado) para estimar
      // volumen y frescura reales del índice, no solo el primero.
      const acumulado: typeof items = [];
      const seen = new Set<string>();
      for (const sub of parsed.subSitemaps.slice(0, 3)) {
        const r = await fetchCorto(sub, false);
        if (!r.ok) continue;
        try {
          for (const it of parseSitemapString(r.body).items) {
            if (it.url && seen.has(it.url)) continue;
            if (it.url) seen.add(it.url);
            acumulado.push(it);
          }
        } catch { /* sub roto: ignorar */ }
      }
      items = acumulado;
    }
    if (items.length > 0) {
      const { recientes, disponibles } = contarRecientes(items.map(i => i.fecha ?? null));
      // "Masivo" solo si es un índice gigante sin frescura útil; un índice de
      // noticias que resuelve a notas recientes NO es masivo problemático.
      const masivo = esIndice && parsed.subSitemaps.length >= 5 && recientes < MIN_RECIENTES_INDICE;
      return {
        cand: {
          url, tipo: 'sitemap', items: items.length, recientes, fechasDisponibles: disponibles,
          dominioOk: dominioCoincide(url, base), esIndiceMasivo: masivo, esConfigurada, esIndice,
        }, res,
      };
    }
  } catch { /* no es sitemap */ }

  return { cand: null, res };
}

interface ProbeAgregado {
  configurada: FuenteCandidata | null;
  candidatas: FuenteCandidata[];
  directOk: boolean;
  anyTimeout: boolean;
  anyBlocked: boolean;
  robotsSitemaps: string[];
}

function fuenteConfigurada(m: MedioFull): { url: string | null; tipo: 'rss' | 'sitemap' | null } {
  const metodo = (m.metodo_extraccion ?? '').toLowerCase();
  if (metodo === 'rss' && m.rss_url) return { url: m.rss_url, tipo: 'rss' };
  if (metodo === 'sitemap' && m.sitemap_url) return { url: m.sitemap_url, tipo: 'sitemap' };
  if (m.rss_url) return { url: m.rss_url, tipo: 'rss' };
  if (m.sitemap_url) return { url: m.sitemap_url, tipo: 'sitemap' };
  return { url: null, tipo: null };
}

/** Prueba las fuentes de un medio: configurada (robusta) y, si falla, alternativas. */
async function probarMedio(m: MedioFull): Promise<ProbeAgregado> {
  const agg: ProbeAgregado = {
    configurada: null, candidatas: [], directOk: false,
    anyTimeout: false, anyBlocked: false, robotsSitemaps: [],
  };
  const cand = urlsCandidatas(m);
  const cfg = fuenteConfigurada(m);

  // 1. Fuente configurada (robusta: más tolerante a timeouts transitorios).
  if (cfg.url) {
    const { cand: c, res } = await evaluarFuente(cfg.url, m.url_base, true, true);
    if (res.timeout) agg.anyTimeout = true;
    if (res.blocked) agg.anyBlocked = true;
    if (c) agg.configurada = c;
  }

  // Si la configurada entrega ≥10 items, no hace falta sondear más (rápido + anti-Forbes).
  const configuradaEntrega = !!agg.configurada && agg.configurada.items >= 10;

  if (!configuradaEntrega) {
    // robots.txt → sitemaps declarados.
    if (cand.robots) {
      const r = await fetchCorto(cand.robots);
      if (r.timeout) agg.anyTimeout = true;
      if (r.blocked) agg.anyBlocked = true;
      if (r.ok) {
        for (const line of r.body.split(/\r?\n/)) {
          const mm = line.match(/^\s*sitemap:\s*(\S+)/i);
          if (mm?.[1]) agg.robotsSitemaps.push(mm[1].trim());
        }
      }
    }

    // RSS alternativas (early-exit al primer estricto).
    for (const url of cand.rss) {
      if (agg.configurada && url === agg.configurada.url) continue;
      const { cand: c, res } = await evaluarFuente(url, m.url_base, url === cfg.url, false);
      if (res.timeout) agg.anyTimeout = true;
      if (res.blocked) agg.anyBlocked = true;
      if (c) { agg.candidatas.push(c); if (c.items >= 10 && c.dominioOk) break; }
    }

    // Sitemap alternativas (robots primero, news-sitemap antes que índice).
    for (const url of [...agg.robotsSitemaps, ...cand.sitemap]) {
      if (agg.configurada && url === agg.configurada.url) continue;
      const { cand: c, res } = await evaluarFuente(url, m.url_base, url === cfg.url, false);
      if (res.timeout) agg.anyTimeout = true;
      if (res.blocked) agg.anyBlocked = true;
      if (c) { agg.candidatas.push(c); if (c.items >= 10 && c.dominioOk && !c.esIndiceMasivo) break; }
    }

    // Página base (extracción directa plausible).
    if (cand.page && !agg.configurada && agg.candidatas.length === 0) {
      const r = await fetchCorto(cand.page);
      if (r.timeout) agg.anyTimeout = true;
      if (r.blocked) agg.anyBlocked = true;
      agg.directOk = r.ok && /<html|<!doctype/i.test(r.body);
    } else {
      agg.directOk = true;
    }
  } else {
    agg.directOk = true;
  }

  return agg;
}

interface AuditFila extends AuditVeredicto {
  medio_id: string;
  nombre_medio: string;
  activo: boolean;
  metodo_extraccion: string | null;
  fuente_actual: string | null;
  requiere_javascript: boolean;
  requiere_proxy: boolean;
  extraccion_directa_ok: boolean;
  pc_gap_count: number;
  alto_valor: boolean;
  prioridad_reparacion: number;
  fecha_auditoria: string;
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (it: T, i: number) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let idx = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      res[i] = await fn(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return res;
}

const HEADERS_08 = [
  'medio_id', 'nombre_medio', 'activo', 'metodo_extraccion', 'fuente_actual',
  'fuente_viable', 'tipo_fuente_viable', 'estado_fuente', 'confidence_score',
  'requiere_javascript', 'requiere_proxy', 'extraccion_directa_ok', 'discovery_ok',
  'noticias_recientes_estimadas', 'pc_gap_count', 'alto_valor',
  'prioridad_reparacion', 'accion_recomendada', 'fecha_auditoria',
];

function filaToRow(f: AuditFila): Record<string, string | number | boolean> {
  return {
    medio_id: f.medio_id,
    nombre_medio: f.nombre_medio,
    activo: f.activo,
    metodo_extraccion: f.metodo_extraccion ?? '',
    fuente_actual: f.fuente_actual ?? '',
    fuente_viable: f.fuente_viable ?? '',
    tipo_fuente_viable: f.tipo_fuente_viable ?? '',
    estado_fuente: f.estado_fuente,
    confidence_score: f.confidence_score,
    requiere_javascript: f.requiere_javascript,
    requiere_proxy: f.requiere_proxy,
    extraccion_directa_ok: f.extraccion_directa_ok,
    discovery_ok: f.discovery_ok,
    noticias_recientes_estimadas: f.noticias_recientes_estimadas,
    pc_gap_count: f.pc_gap_count,
    alto_valor: f.alto_valor,
    prioridad_reparacion: f.prioridad_reparacion,
    accion_recomendada: f.accion_recomendada,
    fecha_auditoria: f.fecha_auditoria,
  };
}

async function cargarMedios(sb: SupabaseClient, args: AuditArgs): Promise<MedioFull[]> {
  let q = sb.from('medios').select(
    'medio_id, nombre_medio, activo, url_base, metodo_extraccion, rss_url, sitemap_url, requiere_javascript, requiere_proxy, pais, prioridad, ultimo_estado, ultimo_error',
  );
  if (args.medioIds && args.medioIds.size > 0) q = q.in('medio_id', [...args.medioIds]);
  else if (!args.includeInactive) q = q.eq('activo', true);
  if (args.onlyErrors) q = q.eq('ultimo_estado', 'error');
  q = q.order('medio_id', { ascending: true });
  const { data, error } = await q;
  if (error) throw new Error(`No se pudieron leer medios: ${error.message}`);
  let medios = (data ?? []) as unknown as MedioFull[];
  if (args.limit) medios = medios.slice(0, args.limit);
  return medios;
}

async function cargarGapsPC(sb: SupabaseClient): Promise<Map<string, number>> {
  const { data } = await sb.from('comparativo_pressclipping').select('medio');
  const conteo = new Map<string, number>();
  for (const r of data ?? []) {
    const k = fold((r as any).medio);
    if (!k) continue;
    conteo.set(k, (conteo.get(k) ?? 0) + 1);
  }
  return conteo;
}

function gapCountDeMedio(nombre: string, pcConteo: Map<string, number>): number {
  const f = fold(nombre);
  let total = 0;
  for (const [k, n] of pcConteo) {
    if (k === f || k.includes(f) || f.includes(k)) total += n;
  }
  return total;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  logger.info({ ...args, medioIds: args.medioIds ? [...args.medioIds] : undefined }, 'Iniciando audit-media-sources (endurecido)');

  const sb = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_SERVICE_ROLE_KEY']!);
  const [medios, pcConteo] = await Promise.all([cargarMedios(sb, args), cargarGapsPC(sb)]);
  logger.info({ medios: medios.length, medios_en_pc: pcConteo.size }, 'Medios y gaps PC cargados');
  if (medios.length === 0) { logger.warn('Sin medios que auditar con los filtros dados.'); return; }

  const fechaAuditoria = new Date().toISOString();
  const filas = await mapPool(medios, 6, async (m): Promise<AuditFila> => {
    const agg = await probarMedio(m);
    const esAgregador = esDominioAgregador(m.url_base) || esDominioAgregador(m.nombre_medio);
    const ver = clasificarFuenteMedio({
      metodo_extraccion: m.metodo_extraccion,
      rss_url: m.rss_url,
      sitemap_url: m.sitemap_url,
      url_base: m.url_base,
      requiere_javascript: m.requiere_javascript,
      requiere_proxy: m.requiere_proxy,
      configurada: agg.configurada,
      candidatas: agg.candidatas,
      directOk: agg.directOk,
      anyTimeout: agg.anyTimeout,
      anyBlocked: agg.anyBlocked,
      esAgregador,
    });
    const gap = gapCountDeMedio(m.nombre_medio, pcConteo);
    const altoValor = fold(m.prioridad) === 'alta' || (m.pais === 'MX' && gap >= 2);
    const prioridad = prioridadReparacion(ver.estado_fuente, gap, altoValor);
    const cfg = fuenteConfigurada(m);
    logger.info({ medio_id: m.medio_id, estado: ver.estado_fuente, conf: ver.confidence_score, gap, prioridad },
      `Auditado: ${m.nombre_medio}`);
    return {
      ...ver,
      medio_id: m.medio_id,
      nombre_medio: m.nombre_medio,
      activo: m.activo,
      metodo_extraccion: m.metodo_extraccion,
      fuente_actual: cfg.url,
      requiere_javascript: m.requiere_javascript,
      requiere_proxy: m.requiere_proxy,
      extraccion_directa_ok: agg.directOk,
      pc_gap_count: gap,
      alto_valor: altoValor,
      prioridad_reparacion: prioridad,
      fecha_auditoria: fechaAuditoria,
    };
  });

  const porEstado: Record<string, number> = {};
  for (const f of filas) porEstado[f.estado_fuente] = (porEstado[f.estado_fuente] ?? 0) + 1;
  console.log('\n=== RESUMEN POR ESTADO DE FUENTE ===');
  for (const [e, n] of Object.entries(porEstado).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${e.padEnd(34)}: ${n}`);
  }

  const highConf = filas.filter(f => ESTADOS_REPARABLES_HIGH.has(f.estado_fuente))
    .sort((a, b) => a.prioridad_reparacion - b.prioridad_reparacion || b.confidence_score - a.confidence_score || b.pc_gap_count - a.pc_gap_count);
  console.log('\n=== CANDIDATOS HIGH-CONFIDENCE (reparables) ===');
  console.log('P | medio_id   | conf | gap | estado                              | medio → fuente');
  for (const f of highConf.slice(0, 30)) {
    console.log(`${f.prioridad_reparacion} | ${f.medio_id.padEnd(10)} | ${f.confidence_score.toFixed(2)} | ${String(f.pc_gap_count).padStart(3)} | ${f.estado_fuente.padEnd(34)} | ${f.nombre_medio} → ${f.fuente_viable ?? '-'}`);
  }

  const needsReview = filas.filter(f => f.estado_fuente === 'REPAIRABLE_NEEDS_REVIEW');
  console.log(`\nNEEDS_REVIEW: ${needsReview.length} | DO_NOT_TOUCH: ${filas.filter(f => f.estado_fuente === 'DO_NOT_TOUCH').length} | READY_KEEP_CURRENT: ${filas.filter(f => f.estado_fuente === 'READY_KEEP_CURRENT').length}`);

  if (args.output === 'csv') {
    console.log('\n=== CSV ===');
    console.log(HEADERS_08.join(','));
    for (const f of filas) {
      const row = filaToRow(f);
      console.log(HEADERS_08.map(h => JSON.stringify((row as any)[h] ?? '')).join(','));
    }
  }

  if (args.output === 'sheet') {
    if (args.dryRun) {
      logger.info({ filas: filas.length, tab: OUTPUT_TABS.COBERTURA_MEDIOS }, '[dry-run] No se escribió la Sheet.');
    } else {
      try {
        const escritas = await replaceOutputRows(OUTPUT_TABS.COBERTURA_MEDIOS, filas.map(filaToRow));
        logger.info({ escritas, tab: OUTPUT_TABS.COBERTURA_MEDIOS }, 'Auditoría exportada (replace) a 08_Cobertura_Medios');
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) },
          'No se pudo escribir 08_Cobertura_Medios (¿existe la pestaña?). No se escribió nada.');
        process.exitCode = 1;
      }
    }
  }

  // --update-db: SOLO REPAIRABLE_*_HIGH_CONFIDENCE con fuente validada.
  if (args.updateDb && !args.dryRun) {
    const reparables = filas.filter(f => ESTADOS_REPARABLES_HIGH.has(f.estado_fuente) && f.fuente_viable);
    let actualizados = 0;
    for (const f of reparables) {
      const update: Record<string, unknown> = {
        metodo_extraccion: f.tipo_fuente_viable === 'rss' ? 'RSS' : 'SITEMAP',
        activo: true,
        ultimo_estado: 'pendiente',
        ultimo_error: null,
        notas_tecnicas: `Homologación ${f.fecha_auditoria.substring(0, 10)}: ${f.estado_fuente} (confidence ${f.confidence_score.toFixed(2)}); fuente_viable=${f.fuente_viable}.`,
      };
      if (f.tipo_fuente_viable === 'rss') update['rss_url'] = f.fuente_viable;
      else update['sitemap_url'] = f.fuente_viable;
      const { error } = await sb.from('medios').update(update).eq('medio_id', f.medio_id);
      if (error) logger.warn({ medio_id: f.medio_id, err: error.message }, 'No se pudo actualizar medio');
      else { actualizados += 1; logger.info({ medio_id: f.medio_id, fuente: f.fuente_viable, conf: f.confidence_score }, `Medio reparado: ${f.nombre_medio}`); }
    }
    logger.info({ actualizados, candidatos: reparables.length }, 'Update DB completado (solo HIGH_CONFIDENCE con fuente validada)');
  }

  logger.info({ auditados: filas.length, high_confidence: highConf.length }, 'audit-media-sources completado.');
}

main().catch(err => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en audit-media-sources');
  process.exit(1);
});
