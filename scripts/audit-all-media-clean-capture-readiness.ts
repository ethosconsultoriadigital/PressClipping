/**
 * Auditoría READ-ONLY de readiness de captura limpia — TODOS los medios del
 * catálogo (no solo los curados para Patrón). Fase "ETHOS NEWS LAKE — ALL
 * MEDIA CLEAN CAPTURE FOUNDATION" (2026-07-17).
 *
 * Objetivo: dar una foto tipo PressClipping de TODO el catálogo (~171 medios):
 * qué tan bien se está capturando/enriqueciendo cada uno, independientemente
 * de si algún cliente lo menciona o no (captura general, no por keyword).
 *
 * Lección aplicada (bug encontrado y corregido en
 * audit-patron-important-media-readiness.ts, commit 4c79068): PostgREST trunca
 * silenciosamente cualquier .limit(N) por encima de ~1000 filas/página. Este
 * script pagina con .range() en bloques globales (no por medio, para evitar
 * cientos de round-trips) hasta agotar cada ventana, así el conteo por medio
 * siempre es completo.
 *
 * NO escribe en Supabase ni Sheets. NO hace crawl. Opcional --json vuelca a
 * data/ (no commitear).
 *
 * Uso:
 *   npm run audit-all-media-clean-capture-readiness
 *   npm run audit-all-media-clean-capture-readiness -- --json
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';
import {
  SHADOW_MEDIOS, SHADOW_MEDIOS_NACIONALES_B, SHADOW_MEDIOS_CRISIS, SHADOW_MEDIOS_DAILY_VALIDATED,
} from '../src/config/shadowMedia.js';

const PAGINA = 1000;

/** Grupos editoriales con paywall duro conocido — no bypass, solo señal informativa. */
const GRUPOS_PAYWALL = ['grupo reforma', 'el norte', 'mural', 'reforma'];

interface MedioRow {
  medio_id: string; nombre_medio: string; url_base: string | null; grupo_medio: string | null;
  pais: string | null; estado: string | null; region: string | null; categoria: string | null;
  prioridad: string | null; activo: boolean; metodo_extraccion: string | null;
  requiere_javascript: boolean; requiere_proxy: boolean;
  ultimo_estado: string | null; ultimo_scrapeo: string | null; notas_tecnicas: string | null;
}

interface NoticiaLite {
  medio_id: string; fecha_publicacion: string | null;
  texto_cuerpo_nota: string | null; texto_nota_limpia: string | null; texto_limpio_chars: number | null;
}

function cronInfo(): Map<string, string> {
  const m = new Map<string, string>();
  for (const id of SHADOW_MEDIOS) m.set(id, 'base');
  for (const x of SHADOW_MEDIOS_NACIONALES_B) m.set(x.medio_id, 'nacional_b');
  for (const x of SHADOW_MEDIOS_CRISIS) m.set(x.medio_id, 'crisis');
  for (const x of SHADOW_MEDIOS_DAILY_VALIDATED) m.set(x.medio_id, 'daily_validated');
  return m;
}

/** Trae TODAS las filas de `noticias` con fecha_publicacion >= desde, paginando (sin truncar). */
async function fetchNoticiasCompletas(desde: string): Promise<NoticiaLite[]> {
  const sb = getSupabase();
  const out: NoticiaLite[] = [];
  let offset = 0;
  for (;;) {
    const { data, count } = await sb
      .from('noticias')
      .select('medio_id, fecha_publicacion, texto_cuerpo_nota, texto_nota_limpia, texto_limpio_chars', { count: 'exact' })
      .gte('fecha_publicacion', desde)
      .range(offset, offset + PAGINA - 1);
    if (data) out.push(...(data as unknown as NoticiaLite[]));
    offset += PAGINA;
    if (!data || data.length < PAGINA || offset >= (count ?? 0)) break;
  }
  return out;
}

async function fetchMencionesCompletas(desde: string): Promise<{ medio_id: string; cliente_id: string }[]> {
  const sb = getSupabase();
  const out: { medio_id: string; cliente_id: string }[] = [];
  let offset = 0;
  for (;;) {
    const { data, count } = await sb
      .from('menciones')
      .select('cliente_id, noticias!inner(medio_id)', { count: 'exact' })
      .gte('created_at', desde)
      .range(offset, offset + PAGINA - 1);
    if (data) {
      for (const m of data as any[]) {
        const medioId = m.noticias?.medio_id;
        if (medioId) out.push({ medio_id: medioId, cliente_id: m.cliente_id });
      }
    }
    offset += PAGINA;
    if (!data || data.length < PAGINA || offset >= (count ?? 0)) break;
  }
  return out;
}

function mediana(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 0) {
    const a = s[mid - 1] ?? 0;
    const b = s[mid] ?? 0;
    return Math.round((a + b) / 2);
  }
  return s[mid] ?? 0;
}

function esPaywallProbable(m: MedioRow): boolean {
  const grupo = (m.grupo_medio ?? '').toLowerCase();
  const notas = (m.notas_tecnicas ?? '').toLowerCase();
  return GRUPOS_PAYWALL.some((g) => grupo.includes(g)) || notas.includes('paywall');
}

async function main() {
  const args = process.argv.slice(2);
  const wantJson = args.includes('--json');
  const sb = getSupabase();
  logger.info({}, '=== Auditoría de readiness de captura limpia — TODOS los medios (SOLO LECTURA) ===');

  const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const hace7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const hace30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: catalogoRaw } = await sb
    .from('medios')
    .select('medio_id, nombre_medio, url_base, grupo_medio, pais, estado, region, categoria, prioridad, activo, metodo_extraccion, requiere_javascript, requiere_proxy, ultimo_estado, ultimo_scrapeo, notas_tecnicas');
  const catalogo = (catalogoRaw ?? []) as unknown as MedioRow[];
  logger.info({ total_catalogo: catalogo.length }, 'Catálogo cargado');

  const cron = cronInfo();
  const noticias30d = await fetchNoticiasCompletas(hace30d);
  const menciones30d = await fetchMencionesCompletas(hace30d);
  logger.info({ noticias_30d_totales: noticias30d.length, menciones_30d_totales: menciones30d.length }, 'Ventanas cargadas (paginado completo, sin truncar)');

  const noticiasPorMedio = new Map<string, NoticiaLite[]>();
  for (const n of noticias30d) {
    const arr = noticiasPorMedio.get(n.medio_id) ?? []; arr.push(n); noticiasPorMedio.set(n.medio_id, arr);
  }
  const mencionesPorMedio = new Map<string, { total: number; porCliente: Record<string, number> }>();
  for (const m of menciones30d) {
    const cur = mencionesPorMedio.get(m.medio_id) ?? { total: 0, porCliente: {} };
    cur.total += 1; cur.porCliente[m.cliente_id] = (cur.porCliente[m.cliente_id] ?? 0) + 1;
    mencionesPorMedio.set(m.medio_id, cur);
  }

  const filas: any[] = [];
  for (const m of catalogo) {
    const enCron = cron.has(m.medio_id);
    const tierCron = cron.get(m.medio_id) ?? null;
    const todas = noticiasPorMedio.get(m.medio_id) ?? [];
    const n24h = todas.filter((n) => (n.fecha_publicacion ?? '') >= hace24h);
    const n7d = todas.filter((n) => (n.fecha_publicacion ?? '') >= hace7d);
    const n30d = todas;
    const conTexto7d = n7d.filter((n) => n.texto_cuerpo_nota || n.texto_nota_limpia);
    const conTexto30d = n30d.filter((n) => n.texto_cuerpo_nota || n.texto_nota_limpia);
    const textoOk7d = n7d.length > 0 ? Math.round((conTexto7d.length / n7d.length) * 1000) / 10 : 0;
    const textoOk30d = n30d.length > 0 ? Math.round((conTexto30d.length / n30d.length) * 1000) / 10 : 0;
    const cuerpoVacio7d = n7d.length > 0 ? Math.round(((n7d.length - conTexto7d.length) / n7d.length) * 1000) / 10 : 0;
    const chars = n7d.map((n) => n.texto_limpio_chars ?? 0).filter((c) => c > 0);
    const men = mencionesPorMedio.get(m.medio_id) ?? { total: 0, porCliente: {} };
    const bloqueado = /error|blocked|403|404/i.test(m.ultimo_estado ?? '');
    const paywallProbable = esPaywallProbable(m);

    let estado: string;
    if (bloqueado) estado = 'BLOQUEADO';
    else if (paywallProbable && !enCron) estado = 'PAYWALL_NO_VIABLE';
    else if (!enCron) estado = 'CATALOGO_NO_CRON';
    else if (n7d.length === 0) estado = 'EN_CRON_SIN_NOTICIAS';
    else if (textoOk7d < 30 && textoOk30d >= 50) estado = 'NECESITA_REENRICH_RECIENTE';
    else if (textoOk7d < 30) estado = 'NECESITA_REPARAR_FUENTE';
    else if (textoOk7d < 70) estado = 'EN_CRON_TEXTO_MALO';
    else if (n7d.length < 3) estado = 'BAJO_VALOR';
    else estado = 'LISTO_LEYENDO';

    let accion: string;
    switch (estado) {
      case 'BLOQUEADO': accion = 'reparar fuente / revisar bloqueo'; break;
      case 'PAYWALL_NO_VIABLE': accion = 'no viable sin bypass (política: no tocar)'; break;
      case 'CATALOGO_NO_CRON': accion = 'evaluar alta a cron'; break;
      case 'EN_CRON_SIN_NOTICIAS': accion = 'revisar fuente (en cron pero sin noticias 7d)'; break;
      case 'NECESITA_REENRICH_RECIENTE': accion = 're-enrich reciente (--recent-first)'; break;
      case 'NECESITA_REPARAR_FUENTE': accion = 're-enrich no alcanza — revisar extractor'; break;
      case 'EN_CRON_TEXTO_MALO': accion = 're-enrich parcial'; break;
      case 'BAJO_VALOR': accion = 'mantener, bajo volumen'; break;
      default: accion = 'mantener';
    }

    filas.push({
      medio_id: m.medio_id, medio: m.nombre_medio, dominio: m.url_base,
      region: m.region ?? m.estado, pais: m.pais, categoria_medio: m.categoria,
      importancia_general: m.prioridad ?? 'Media',
      en_catalogo: true, en_cron: enCron, tier_cron: tierCron,
      fuente_tipo: m.metodo_extraccion,
      noticias_24h: n24h.length, noticias_7d: n7d.length, noticias_30d: n30d.length,
      texto_ok_pct_7d: textoOk7d, texto_ok_pct_30d: textoOk30d,
      mediana_chars: mediana(chars), cuerpo_vacio_pct_7d: cuerpoVacio7d,
      ultimo_crawl: m.ultimo_scrapeo, ultimo_error: /error|blocked|403|404/i.test(m.ultimo_estado ?? '') ? m.ultimo_estado : null,
      bloqueado, paywall_probable: paywallProbable,
      menciones_30d_total: men.total, menciones_30d_por_cliente: men.porCliente,
      requiere_javascript: m.requiere_javascript, requiere_proxy: m.requiere_proxy,
      estado_operativo: estado, accion_recomendada: accion,
    });
  }

  const porEstado: Record<string, number> = {};
  for (const f of filas) porEstado[f.estado_operativo] = (porEstado[f.estado_operativo] ?? 0) + 1;

  const resumen = {
    total_catalogo: filas.length,
    total_en_cron: filas.filter((f) => f.en_cron).length,
    total_catalogo_no_cron: filas.filter((f) => !f.en_cron && !f.bloqueado && !f.paywall_probable).length,
    total_bloqueados: filas.filter((f) => f.bloqueado).length,
    total_paywall: filas.filter((f) => f.paywall_probable).length,
    por_estado: porEstado,
  };
  logger.info(resumen, '=== RESUMEN readiness captura limpia (TODOS los medios) ===');

  const topGaps = filas
    .filter((f) => f.en_cron && f.estado_operativo !== 'LISTO_LEYENDO' && f.estado_operativo !== 'BAJO_VALOR')
    .sort((a, b) => b.noticias_7d - a.noticias_7d)
    .slice(0, 15)
    .map((f) => `${f.medio} [${f.estado_operativo}] noticias_7d=${f.noticias_7d} texto_ok=${f.texto_ok_pct_7d}% → ${f.accion_recomendada}`);
  logger.info({ top_gaps_por_volumen: topGaps }, 'Top gaps con mayor volumen (mejor ROI de re-enrich)');

  if (wantJson) {
    mkdirSync('data', { recursive: true });
    const archivo = 'data/all-media-clean-capture-readiness.json';
    writeFileSync(archivo, JSON.stringify({ generado: new Date().toISOString(), resumen, filas }, null, 2));
    logger.info({ archivo }, 'JSON escrito (no commitear data/).');
  }

  logger.info({}, '=== Fin auditoría — SOLO LECTURA, nada modificado ===');
}

main().catch((e) => { logger.error(e, 'Error fatal en audit-all-media-clean-capture-readiness'); process.exit(1); });
