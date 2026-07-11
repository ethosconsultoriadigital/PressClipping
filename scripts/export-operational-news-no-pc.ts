/**
 * Exportador operativo STAGING (emergencia sin PressClipping) — Jumex + Patrón.
 *
 * Lee menciones/noticias de Supabase para los clientes indicados y las escribe
 * en la pestaña `11_Operacion_Sin_PressClipping` (append seguro, con dedupe y
 * readback). NO usa export-results, NO genera XML, NO clasifica con IA, NO
 * envía nada. Es puente hacia el reporte final (ver docs/PUENTE_REPORTES_JUMEX_PATRON.md).
 *
 * Dedupe: dedupe_key = cliente_id + url_norm + keyword_id. Nunca duplica ni
 * borra filas anteriores — solo agrega (append), igual que 10_Alertas_Sombra.
 *
 * Uso:
 *   npm run export-operational-news-no-pc -- --clients=CLI-0001,CLI-0002 --window-hours=24 --dry-run --max-rows=200
 *   npm run export-operational-news-no-pc -- --clients=CLI-0001,CLI-0002 --window-days=7 --output=sheet --max-rows=500
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import { ensureSheetTabAndHeaders, appendHistoryRows, type OutRow } from '../src/sheets/write.js';
import { getOutputTab } from '../src/sheets/client.js';
import { canonicalizeUrl } from '../src/normalizers/url.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

const TAB = '11_Operacion_Sin_PressClipping';
const HEADERS = [
  'fecha_export', 'run_id', 'cliente_id', 'cliente_nombre', 'estado_operativo',
  'medio', 'fecha_noticia', 'titulo', 'url', 'url_norm', 'keyword', 'grupo_tema',
  'sentimiento', 'valoracion', 'requiere_alerta', 'prioridad', 'texto_limpio_chars',
  'texto_limpio_ok', 'fuente', 'medio_id', 'dedupe_key', 'estado_export', 'notas',
];

interface Args {
  clients: string[];
  windowHours?: number;
  windowDays?: number;
  output: 'console' | 'sheet';
  dryRun: boolean;
  maxRows: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { clients: [], output: 'console', dryRun: false, maxRows: 500 };
  for (const arg of argv) {
    if (arg === '--dry-run') { out.dryRun = true; continue; }
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'clients') out.clients = val.split(',').map((s) => s.trim()).filter(Boolean);
    if (key === 'window-hours') out.windowHours = parseIntOrNull(val) ?? undefined;
    if (key === 'window-days') out.windowDays = parseIntOrNull(val) ?? undefined;
    if (key === 'output') out.output = (val as 'console' | 'sheet') || out.output;
    if (key === 'max-rows') out.maxRows = parseIntOrNull(val) ?? out.maxRows;
  }
  return out;
}

function windowMs(args: Args): number {
  if (args.windowHours != null) return args.windowHours * 60 * 60 * 1000;
  if (args.windowDays != null) return args.windowDays * 24 * 60 * 60 * 1000;
  return 7 * 24 * 60 * 60 * 1000; // default 7 días
}

/** dedupe_key estable: cliente_id + url_norm + keyword_id (nunca cambia entre corridas). */
export function dedupeKey(clienteId: string, urlNorm: string, keywordId: string): string {
  return `${clienteId}::${urlNorm}::${keywordId}`;
}

type EstadoExport = 'EXPORTADO' | 'DUPLICADO_OMITIDO' | 'SIN_TEXTO_LIMPIO' | 'REVISAR';

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.clients.length === 0) {
    console.error('Falta --clients=CLI-0001,CLI-0002. Abortando (nada leído/escrito).');
    process.exit(1);
  }

  const runId = `EXP-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const fechaExport = new Date().toISOString();
  const sb = getSupabase();

  logger.info(
    { clients: args.clients, windowHours: args.windowHours ?? null, windowDays: args.windowDays ?? null, output: args.output, dryRun: args.dryRun, maxRows: args.maxRows, runId },
    '=== Exportador operativo staging (sin PressClipping) ===',
  );

  const isoDesde = new Date(Date.now() - windowMs(args)).toISOString();

  const { data: clientesRaw, error: errCli } = await sb
    .from('clientes')
    .select('cliente_id, nombre_cliente')
    .in('cliente_id', args.clients);
  if (errCli) { logger.error({ error: errCli.message }, 'Error leyendo clientes'); process.exit(1); }
  const clientesMap = new Map((clientesRaw ?? []).map((c: any) => [c.cliente_id, c.nombre_cliente]));

  const { data: keywordsRaw, error: errKw } = await sb
    .from('keywords')
    .select('keyword_id, cliente_id, prioridad');
  if (errKw) { logger.error({ error: errKw.message }, 'Error leyendo keywords'); process.exit(1); }
  const prioridadPorKeyword = new Map((keywordsRaw ?? []).map((k: any) => [k.keyword_id, k.prioridad ?? null]));

  const { data: mencionesRaw, error: errMen } = await sb
    .from('menciones')
    .select(
      'mencion_id, cliente_id, keyword_id, keyword, tema, sentimiento, requiere_alerta, estado_revision, created_at,' +
      ' noticias(noticia_id, medio_id, titulo, url_original, fecha_publicacion, texto_cuerpo_nota, texto_nota_limpia, texto_extraido, medios(nombre_medio))',
    )
    .in('cliente_id', args.clients)
    .gte('created_at', isoDesde)
    .order('created_at', { ascending: false })
    .limit(args.maxRows);
  if (errMen) { logger.error({ error: errMen.message }, 'Error leyendo menciones'); process.exit(1); }
  const menciones = (mencionesRaw ?? []) as any[];

  logger.info({ total_menciones: menciones.length, desde: isoDesde, clientes: args.clients }, 'Menciones cargadas');

  // Filas existentes en la tab (para dedupe) — solo si vamos a escribir de verdad.
  const dedupeExistentes = new Set<string>();
  if (!args.dryRun && args.output === 'sheet') {
    try {
      const tab = await getOutputTab(TAB);
      await tab.loadHeaderRow().catch(() => undefined);
      if (tab.headerValues && tab.headerValues.length > 0) {
        const rows = await tab.getRows();
        for (const r of rows) {
          const k = String(r.get('dedupe_key') ?? '').trim();
          if (k) dedupeExistentes.add(k);
        }
      }
    } catch { /* la tab aún no existe: no hay dedupe previo */ }
  }

  const filas: OutRow[] = [];
  const resumenPorCliente: Record<string, number> = {};
  const resumenPorMedio: Record<string, number> = {};
  const resumenPorKeyword: Record<string, number> = {};
  let duplicados = 0;
  let sinTextoLimpio = 0;
  let revisar = 0;

  for (const m of menciones) {
    const n = m.noticias;
    if (!n) continue;
    const clienteNombre = clientesMap.get(m.cliente_id) ?? m.cliente_id;
    const urlOriginal = n.url_original ?? '';
    const urlNorm = urlOriginal ? canonicalizeUrl(urlOriginal) : '';
    const dedupe = dedupeKey(m.cliente_id, urlNorm, m.keyword_id);

    const tieneTextoLimpio = Boolean(n.texto_cuerpo_nota || n.texto_nota_limpia);
    const textoEfectivo = n.texto_cuerpo_nota ?? n.texto_nota_limpia ?? n.texto_extraido ?? '';
    const esFalsoPositivo = /falso/i.test(String(m.estado_revision ?? ''));

    let estado: EstadoExport;
    if (dedupeExistentes.has(dedupe)) { estado = 'DUPLICADO_OMITIDO'; duplicados++; }
    else if (esFalsoPositivo) { estado = 'REVISAR'; revisar++; }
    else if (!tieneTextoLimpio) { estado = 'SIN_TEXTO_LIMPIO'; sinTextoLimpio++; }
    else estado = 'EXPORTADO';

    resumenPorCliente[m.cliente_id] = (resumenPorCliente[m.cliente_id] ?? 0) + 1;
    const medioNombre = n.medios?.nombre_medio ?? '(desconocido)';
    resumenPorMedio[medioNombre] = (resumenPorMedio[medioNombre] ?? 0) + 1;
    resumenPorKeyword[m.keyword] = (resumenPorKeyword[m.keyword] ?? 0) + 1;

    if (estado === 'DUPLICADO_OMITIDO') continue; // nunca se escribe de nuevo

    dedupeExistentes.add(dedupe); // evita duplicar dentro del mismo run

    filas.push({
      fecha_export: fechaExport,
      run_id: runId,
      cliente_id: m.cliente_id,
      cliente_nombre: clienteNombre,
      estado_operativo: 'OPERATIVO_INTERNO',
      medio: medioNombre,
      fecha_noticia: n.fecha_publicacion ?? '',
      titulo: n.titulo ?? '',
      url: urlOriginal,
      url_norm: urlNorm,
      keyword: m.keyword,
      grupo_tema: m.tema ?? '',
      sentimiento: m.sentimiento ?? '',
      valoracion: '', // requiere classify-ia (prohibido en esta fase)
      requiere_alerta: m.requiere_alerta === true,
      prioridad: prioridadPorKeyword.get(m.keyword_id) ?? '',
      texto_limpio_chars: textoEfectivo.length,
      texto_limpio_ok: tieneTextoLimpio,
      fuente: 'ethos',
      medio_id: n.medio_id ?? '',
      dedupe_key: dedupe,
      estado_export: estado,
      notas: esFalsoPositivo ? 'estado_revision indica falso positivo — revisar antes de reportar' : '',
    });
  }

  logger.info(
    {
      candidatas: menciones.length,
      a_exportar: filas.length,
      duplicados_omitidos: duplicados,
      sin_texto_limpio: sinTextoLimpio,
      revisar: revisar,
      por_cliente: resumenPorCliente,
      por_medio: resumenPorMedio,
      por_keyword: resumenPorKeyword,
    },
    args.dryRun ? '[dry-run] Resumen — no se escribió nada' : 'Resumen de export',
  );

  if (args.dryRun || args.output === 'console') {
    logger.info({ filas_preview: filas.slice(0, 10) }, 'Preview (máx 10 filas)');
    logger.info({ listo_para_exportar: filas.length > 0 && duplicados < menciones.length }, '=== FIN — NADA ESCRITO EN SHEETS ===');
    return;
  }

  // ── Escritura real: asegurar tab + headers, luego append (nunca reemplaza) ──
  const ensure = await ensureSheetTabAndHeaders(TAB, HEADERS);
  logger.info(ensure, 'ensureSheetTabAndHeaders completado');
  if (ensure.mismatch) {
    logger.error({}, 'MISMATCH en headers tras ensureSheetTabAndHeaders. Abortando antes de escribir filas.');
    process.exit(1);
  }

  const escritas = await appendHistoryRows(TAB, HEADERS, filas);

  // Readback obligatorio: contar filas totales tras el append.
  const tab = await getOutputTab(TAB);
  const rowsDespues = await tab.getRows();
  logger.info(
    {
      filas_escritas: escritas,
      filas_totales_tab: rowsDespues.length,
      duplicados_omitidos: duplicados,
      run_id: runId,
    },
    '=== Export completado — 11_Operacion_Sin_PressClipping (append, sin envíos) ===',
  );
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
