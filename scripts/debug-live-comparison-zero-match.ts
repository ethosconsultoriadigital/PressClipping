/**
 * DIAGNÓSTICO read-only del MATCH=0 en el comparativo Ethos vs PressClipping.
 *
 * Reproduce EXACTAMENTE la carga de `compare-mentions` (mismos filtros: ventana
 * `noticias.fecha_publicacion` con `!inner`, `estado_revision != descartada`,
 * `comparativo_pressclipping` por `fecha`) y responde por qué no hubo match:
 * ¿bug de normalización de URL / ventana / cliente / keyword / título, o brecha
 * real de cobertura?
 *
 * SOLO LECTURA: no escribe Sheets, no modifica Supabase, no importa XML, no
 * envía nada, no hace crawl.
 *
 * Uso:
 *   npm run debug-live-comparison-zero-match -- --run-id=RUN-2026-07-08T05-00-13-448Z
 *   npm run debug-live-comparison-zero-match -- --from=2026-07-05T23:00:12.585-06:00 --to=2026-07-07T23:00:12.585-06:00
 *   npm run debug-live-comparison-zero-match -- --from=2026-07-05 --to=2026-07-07 --json
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../src/utils/logger.js';
import { readOutputTabRows } from '../src/sheets/read.js';
import { SELECT_MENCION_EXPORT, mapMencionExport } from '../src/types/mencion.js';
import {
  normalizeUrl,
  normalizeTitulo,
  normalizeMedio,
  calcSimilarity,
  type MencionNorm,
} from '../src/comparators/mentionMatcher.js';
import { normalizarVentanaTimestamp, aFechaMx } from '../src/utils/dateWindow.js';

const TAB_07 = '07_Metricas_Live';

interface Args {
  runId?: string;
  from?: string;
  to?: string;
  cliente?: string;
  json: boolean;
  top: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { json: false, top: 50 };
  for (const a of argv) {
    if (a === '--json') { out.json = true; continue; }
    const m = a.match(/^--([\w-]+)=(.*)$/);
    if (!m) continue;
    switch (m[1]) {
      case 'run-id': out.runId = m[2]; break;
      case 'from': case 'fecha-desde': out.from = m[2]; break;
      case 'to': case 'fecha-hasta': out.to = m[2]; break;
      case 'cliente': out.cliente = m[2]; break;
      case 'top': out.top = Number(m[2]) || out.top; break;
    }
  }
  return out;
}

const txt = (v: unknown): string => String(v ?? '').trim();

/** Dominio canónico sin www (para nivel 5). */
function dominio(url?: string | null): string {
  const u = txt(url);
  if (!u) return '';
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

/** Resuelve la ventana desde --run-id (lee 07) o --from/--to. */
async function resolverVentana(args: Args): Promise<{ desde?: string; hasta?: string; origen: string }> {
  if (args.from || args.to) {
    return { desde: args.from, hasta: args.to, origen: 'from/to (args)' };
  }
  if (args.runId) {
    const filas = await readOutputTabRows(TAB_07);
    const fila = filas.find((r) => txt(r['run_id']) === args.runId);
    if (fila) {
      return {
        desde: txt(fila['fecha_desde']) || undefined,
        hasta: txt(fila['fecha_hasta']) || undefined,
        origen: `07_Metricas_Live[run_id=${args.runId}]`,
      };
    }
    logger.warn({ runId: args.runId }, 'run_id no encontrado en 07; usando ventana vacía (todo).');
  }
  return { origen: 'sin ventana (todo)' };
}

async function cargarEthos(sb: SupabaseClient, args: Args, desde?: string, hasta?: string): Promise<MencionNorm[]> {
  let query = sb.from('menciones').select(SELECT_MENCION_EXPORT).neq('estado_revision', 'descartada');
  const v = normalizarVentanaTimestamp({ desde, hasta });
  if (v.desde) query = query.gte('noticias.fecha_publicacion', v.desde);
  if (v.hasta) query = query.lte('noticias.fecha_publicacion', v.hasta);
  const { data, error } = await query;
  if (error) throw new Error(`Error al cargar menciones Ethos: ${error.message}`);
  let filas = (data ?? []).map(mapMencionExport);
  if (args.cliente) filas = filas.filter((f) => (f.cliente ?? '').toLowerCase().includes(args.cliente!.toLowerCase()));
  return filas.map((f) => ({
    fuente: 'Ethos' as const,
    fecha: f.fecha_publicacion?.substring(0, 10),
    cliente: f.cliente ?? undefined,
    keyword: f.keyword ?? undefined,
    medio: f.medio ?? undefined,
    titulo: f.titulo ?? undefined,
    url: f.url_original ?? undefined,
    url_norm: normalizeUrl(f.url_original),
    estado_revision: f.estado_revision ?? undefined,
  }));
}

async function cargarPC(sb: SupabaseClient, args: Args, desde?: string, hasta?: string): Promise<MencionNorm[]> {
  let query = sb.from('comparativo_pressclipping').select('*');
  if (args.cliente) query = query.ilike('cliente', `%${args.cliente}%`);
  if (desde) query = query.gte('fecha', aFechaMx(desde));
  if (hasta) query = query.lte('fecha', aFechaMx(hasta));
  const { data, error } = await query;
  if (error) throw new Error(`Error al cargar PressClipping: ${error.message}`);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    fuente: 'PressClipping' as const,
    fecha: (r['fecha'] as string | null) ?? undefined,
    cliente: (r['cliente'] as string | null) ?? undefined,
    cliente_id: (r['cliente_id'] as string | null) ?? undefined,
    grupo_tema: (r['grupo_tema'] as string | null) ?? undefined,
    keyword: (r['keyword'] as string | null) ?? undefined,
    medio: (r['medio'] as string | null) ?? undefined,
    titulo: (r['titulo'] as string | null) ?? undefined,
    url: (r['url'] as string | null) ?? undefined,
    url_norm: (r['url_norm'] as string | null) ?? normalizeUrl(r['url'] as string | null),
  }));
}

function conteoPor(rows: MencionNorm[], key: (r: MencionNorm) => string, top = 20): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const r of rows) { const k = key(r) || '(vacío)'; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
}

function fechasMinMax(rows: MencionNorm[]): { min: string; max: string } {
  const fechas = rows.map((r) => txt(r.fecha)).filter(Boolean).sort();
  return { min: fechas[0] ?? '', max: fechas[fechas.length - 1] ?? '' };
}

const VENTANA_DIAS = 3;
function difDias(a?: string, b?: string): number | undefined {
  const da = a ? new Date(a) : null; const db = b ? new Date(b) : null;
  if (!da || !db || isNaN(da.getTime()) || isNaN(db.getTime())) return undefined;
  return Math.round(Math.abs(da.getTime() - db.getTime()) / 86_400_000);
}

type TipoDiag =
  | 'URL_EXACTA' | 'URL_NORM' | 'TITULO_EN_VENTANA' | 'TITULO_FUERA_VENTANA' | 'DOMINIO_TITULO';

interface CandidatoDiag {
  pc_titulo: string; pc_url: string; pc_url_norm: string; pc_medio: string; pc_fecha: string;
  pc_cliente: string; pc_keyword: string;
  ethos_titulo: string; ethos_url: string; ethos_url_norm: string; ethos_medio: string; ethos_fecha: string;
  ethos_cliente: string; ethos_keyword: string;
  tipo_match_diagnostico: TipoDiag; score: number; diferencia_dias: number | undefined;
  razon_no_match_actual: string;
}

/** Busca el mejor candidato Ethos para un PC, con 5 niveles de tolerancia. */
function mejorCandidato(pc: MencionNorm, ethos: MencionNorm[]): CandidatoDiag | undefined {
  const pcUrlExact = txt(pc.url);
  const pcUrlNorm = normalizeUrl(pc.url_norm ?? pc.url);
  const pcTit = normalizeTitulo(pc.titulo);
  const pcDom = dominio(pc.url);
  let best: CandidatoDiag | undefined;

  const registrar = (e: MencionNorm, tipo: TipoDiag, score: number): CandidatoDiag => ({
    pc_titulo: txt(pc.titulo), pc_url: txt(pc.url), pc_url_norm: pcUrlNorm, pc_medio: txt(pc.medio), pc_fecha: txt(pc.fecha),
    pc_cliente: txt(pc.cliente), pc_keyword: txt(pc.keyword),
    ethos_titulo: txt(e.titulo), ethos_url: txt(e.url), ethos_url_norm: normalizeUrl(e.url_norm ?? e.url),
    ethos_medio: txt(e.medio), ethos_fecha: txt(e.fecha), ethos_cliente: txt(e.cliente), ethos_keyword: txt(e.keyword),
    tipo_match_diagnostico: tipo, score: Math.round(score * 100) / 100, diferencia_dias: difDias(pc.fecha, e.fecha),
    razon_no_match_actual: '',
  });

  const rank: Record<TipoDiag, number> = {
    URL_EXACTA: 5, URL_NORM: 4, TITULO_EN_VENTANA: 3, TITULO_FUERA_VENTANA: 2, DOMINIO_TITULO: 1,
  };
  const consider = (c: CandidatoDiag) => {
    if (!best || rank[c.tipo_match_diagnostico] > rank[best.tipo_match_diagnostico] ||
        (rank[c.tipo_match_diagnostico] === rank[best.tipo_match_diagnostico] && c.score > best.score)) {
      best = c;
    }
  };

  for (const e of ethos) {
    const eUrlExact = txt(e.url);
    const eUrlNorm = normalizeUrl(e.url_norm ?? e.url);
    const eTit = normalizeTitulo(e.titulo);
    const eDom = dominio(e.url);
    const d = difDias(pc.fecha, e.fecha);
    const enVentana = d !== undefined && d <= VENTANA_DIAS;
    const scoreTit = pcTit && eTit ? calcSimilarity(pcTit, eTit) : 0;

    if (pcUrlExact && eUrlExact && pcUrlExact === eUrlExact) { consider(registrar(e, 'URL_EXACTA', 1)); continue; }
    if (pcUrlNorm && eUrlNorm && pcUrlNorm === eUrlNorm) { consider(registrar(e, 'URL_NORM', 1)); continue; }
    if (scoreTit >= 0.75 && enVentana) { consider(registrar(e, 'TITULO_EN_VENTANA', scoreTit)); continue; }
    if (scoreTit >= 0.75 && !enVentana) { consider(registrar(e, 'TITULO_FUERA_VENTANA', scoreTit)); continue; }
    if (pcDom && eDom && pcDom === eDom && scoreTit >= 0.65) { consider(registrar(e, 'DOMINIO_TITULO', scoreTit)); }
  }

  if (best) best.razon_no_match_actual = razonNoMatch(best);
  return best;
}

/** Por qué el comparador ACTUAL no lo tomó como MATCH (aunque el diagnóstico sí). */
function razonNoMatch(c: CandidatoDiag): string {
  switch (c.tipo_match_diagnostico) {
    case 'URL_EXACTA':
      return 'URL exacta igual pero url_norm difiere → NORMALIZE_URL_BUG (posible www/params/url_norm almacenado)';
    case 'URL_NORM':
      return 'url_norm igual → el comparador debería matchear; revisar url_norm almacenado de PC vs recomputado';
    case 'TITULO_EN_VENTANA':
      return c.score < 0.85
        ? `título ${(c.score * 100).toFixed(0)}% < 85% (umbral PROBABLE) → TITLE_SIMILARITY_TOO_STRICT o medio distinto`
        : (normalizeMedio(c.pc_medio) !== normalizeMedio(c.ethos_medio)
            ? 'título alto pero medio normalizado distinto → MEDIO_MAPPING'
            : 'debería matchear; revisar');
    case 'TITULO_FUERA_VENTANA':
      return `título ${(c.score * 100).toFixed(0)}% pero |Δdías|=${c.diferencia_dias} > 3 → WINDOW_MISMATCH / TIMEZONE`;
    case 'DOMINIO_TITULO':
      return `mismo dominio, título ${(c.score * 100).toFixed(0)}% (60-75%) → coincidencia débil, revisar humano`;
  }
}

function clasificarCausa(cands: CandidatoDiag[], totalSoloPc: number): Array<{ causa: string; evidencia: string; cantidad: number; severidad: string; fix: string }> {
  const by = (t: TipoDiag) => cands.filter((c) => c.tipo_match_diagnostico === t).length;
  const urlExacta = by('URL_EXACTA');
  const urlNorm = by('URL_NORM');
  const titVent = by('TITULO_EN_VENTANA');
  const titFuera = by('TITULO_FUERA_VENTANA');
  const dom = by('DOMINIO_TITULO');
  const sinCand = totalSoloPc - cands.length;

  const out: Array<{ causa: string; evidencia: string; cantidad: number; severidad: string; fix: string }> = [];
  if (urlExacta > 0) out.push({ causa: 'NORMALIZE_URL_BUG', evidencia: 'PC y Ethos con URL exacta igual pero no matchearon', cantidad: urlExacta, severidad: 'ALTA', fix: 'alinear url_norm almacenado de PC con normalizeUrl actual; strip www' });
  if (urlNorm > 0) out.push({ causa: 'NORMALIZE_URL_BUG', evidencia: 'url_norm coincide pero comparador no matcheó (url_norm PC almacenado difiere)', cantidad: urlNorm, severidad: 'ALTA', fix: 'recomputar url_norm PC en el cruce en vez de confiar en el almacenado' });
  if (titFuera > 0) out.push({ causa: 'WINDOW_MISMATCH', evidencia: 'título ≥75% pero fuera de ±3 días', cantidad: titFuera, severidad: 'MEDIA', fix: 'revisar ventana/timezone y fecha_publicacion vs fecha PC' });
  if (titVent > 0) out.push({ causa: 'TITLE_SIMILARITY_TOO_STRICT', evidencia: 'título 75-85% en ventana, no llega a umbral PROBABLE (85%) o medio distinto', cantidad: titVent, severidad: 'MEDIA', fix: 'evaluar bajar umbral o comparar por tokens/URL en vez de medio exacto' });
  if (dom > 0) out.push({ causa: 'MIXED', evidencia: 'mismo dominio, título 60-75%', cantidad: dom, severidad: 'BAJA', fix: 'revisión humana' });
  if (sinCand > 0) out.push({ causa: 'REAL_COVERAGE_GAP', evidencia: 'PC sin ningún candidato Ethos ni por URL ni por título/dominio', cantidad: sinCand, severidad: 'ALTA', fix: 'reparar cobertura/extracción de fuentes; Ethos no capturó el artículo' });
  return out.sort((a, b) => b.cantidad - a.cantidad);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) { logger.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
  const sb = createClient(url, key);

  const ventana = await resolverVentana(args);
  logger.info({ ...ventana }, '=== Debug MATCH=0 (SOLO LECTURA) — ventana resuelta ===');

  const [ethos, pc] = await Promise.all([
    cargarEthos(sb, args, ventana.desde, ventana.hasta),
    cargarPC(sb, args, ventana.desde, ventana.hasta),
  ]);

  // URL sets de Ethos para conteos de posibles matches.
  const ethosUrlExact = new Set(ethos.map((e) => txt(e.url)).filter(Boolean));
  const ethosUrlNorm = new Set(ethos.map((e) => normalizeUrl(e.url_norm ?? e.url)).filter(Boolean));

  const posiblesUrlExacta = pc.filter((p) => txt(p.url) && ethosUrlExact.has(txt(p.url))).length;
  const posiblesUrlNorm = pc.filter((p) => { const n = normalizeUrl(p.url_norm ?? p.url); return n && ethosUrlNorm.has(n); }).length;

  // Candidatos diagnósticos por nivel para cada PC (solo los que Ethos NO cubre por url_norm exacto).
  const candidatos: CandidatoDiag[] = [];
  for (const p of pc) {
    const c = mejorCandidato(p, ethos);
    if (c) candidatos.push(c);
  }
  const porTitulo = candidatos.filter((c) => c.tipo_match_diagnostico === 'TITULO_EN_VENTANA').length;
  const fueraVentana = candidatos.filter((c) => c.tipo_match_diagnostico === 'TITULO_FUERA_VENTANA').length;
  const clienteDistinto = candidatos.filter((c) => c.pc_cliente && c.ethos_cliente && c.pc_cliente.toLowerCase() !== c.ethos_cliente.toLowerCase()).length;
  const keywordDistinta = candidatos.filter((c) => c.pc_keyword && c.ethos_keyword && normalizeTitulo(c.pc_keyword) !== normalizeTitulo(c.ethos_keyword)).length;

  const resumen = {
    ventana,
    total_pc: pc.length,
    total_ethos: ethos.length,
    pc_sin_url: pc.filter((p) => !txt(p.url)).length,
    pc_url_norm_vacia: pc.filter((p) => !normalizeUrl(p.url_norm ?? p.url)).length,
    ethos_sin_url: ethos.filter((e) => !txt(e.url)).length,
    ethos_url_norm_vacia: ethos.filter((e) => !normalizeUrl(e.url_norm ?? e.url)).length,
    fechas_pc: fechasMinMax(pc),
    fechas_ethos: fechasMinMax(ethos),
    posibles_matches_por_url_exacta: posiblesUrlExacta,
    posibles_matches_por_url_norm: posiblesUrlNorm,
    posibles_matches_por_titulo: porTitulo,
    posibles_matches_fuera_de_ventana: fueraVentana,
    posibles_matches_cliente_distinto: clienteDistinto,
    posibles_matches_keyword_distinta: keywordDistinta,
    pc_con_algun_candidato: candidatos.length,
    pc_sin_ningun_candidato: pc.length - candidatos.length,
  };

  logger.info(resumen, 'Resumen diagnóstico MATCH=0.');
  logger.info({ pc_por_cliente: conteoPor(pc, (r) => txt(r.cliente)) }, 'PC por cliente.');
  logger.info({ ethos_por_cliente: conteoPor(ethos, (r) => txt(r.cliente)) }, 'Ethos por cliente.');
  logger.info({ pc_por_medio: conteoPor(pc, (r) => txt(r.medio)) }, 'PC por medio.');
  logger.info({ ethos_por_medio: conteoPor(ethos, (r) => txt(r.medio)) }, 'Ethos por medio.');
  logger.info({ pc_por_keyword: conteoPor(pc, (r) => txt(r.keyword)) }, 'PC por keyword.');
  logger.info({ ethos_por_keyword: conteoPor(ethos, (r) => txt(r.keyword)) }, 'Ethos por keyword.');

  const causas = clasificarCausa(candidatos, pc.length);
  logger.info({ causas }, 'Causas del MATCH=0 (causa | evidencia | cantidad | severidad | fix).');

  const top = candidatos
    .sort((a, b) => {
      const rank: Record<TipoDiag, number> = { URL_EXACTA: 5, URL_NORM: 4, TITULO_EN_VENTANA: 3, TITULO_FUERA_VENTANA: 2, DOMINIO_TITULO: 1 };
      return (rank[b.tipo_match_diagnostico] - rank[a.tipo_match_diagnostico]) || (b.score - a.score);
    })
    .slice(0, args.top);
  logger.info({ candidatos_top: top.length }, `Top ${args.top} candidatos de match perdidos (ver JSON con --json).`);
  for (const c of top.slice(0, 15)) {
    logger.info(
      { tipo: c.tipo_match_diagnostico, score: c.score, dias: c.diferencia_dias,
        pc: `${c.pc_medio} :: ${c.pc_titulo.slice(0, 60)}`, ethos: `${c.ethos_medio} :: ${c.ethos_titulo.slice(0, 60)}`,
        razon: c.razon_no_match_actual },
      '[candidato]',
    );
  }

  if (args.json) {
    try {
      mkdirSync('data', { recursive: true });
      writeFileSync('data/debug-live-comparison-zero-match.json', JSON.stringify({ resumen, causas, candidatos: top }, null, 2), 'utf8');
      logger.info({ archivo: 'data/debug-live-comparison-zero-match.json' }, 'JSON escrito (no commitear data/).');
    } catch (e) {
      logger.warn({ error: e instanceof Error ? e.message : String(e) }, 'No se pudo escribir JSON local.');
    }
  }

  logger.info('=== Debug MATCH=0 completado (sin escrituras, sin envíos) ===');
}

main().catch((err) => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en debug-live-comparison-zero-match');
  process.exit(1);
});
