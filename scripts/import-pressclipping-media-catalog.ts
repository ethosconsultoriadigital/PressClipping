/**
 * Importador del catálogo de medios de PressClipping.
 *
 * Lee un export de PressClipping desde `data/` (CSV/TSV; .xlsx si hay soporte),
 * toma la Columna E (índice 4) como nombre del medio y la Columna I (índice 8)
 * como URL de nota, agrupa por medio, cruza contra la tabla `medios` de Ethos,
 * diagnostica fuentes viables de los faltantes (sin crawl masivo) y exporta el
 * cruce a la pestaña `09_Medios_PressClipping` (replace A2:AF).
 *
 * Uso:
 *   npm run import-pc-media-catalog -- --output=console --dry-run
 *   npm run import-pc-media-catalog -- --file=data/Pressclipping_medios.csv --output=sheet
 *   npm run import-pc-media-catalog -- --output=sheet --diagnose-limit=60
 *
 * NO inserta medios. NO hace crawl masivo. NO toca 01_Noticias_Raw, 05, 07 ni 08.
 * NO corre IA/XML/alertas.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchText } from '../src/utils/http.js';
import { parseRssString } from '../src/parsers/rss.js';
import { parseSitemapString } from '../src/parsers/sitemap.js';
import { replaceOutputRows } from '../src/sheets/write.js';
import { OUTPUT_TABS } from '../src/sheets/client.js';
import { logger } from '../src/utils/logger.js';
import {
  clasificarFuenteMedio, esDominioAgregador, urlsCandidatas, UMBRAL_INDICE_MASIVO,
  type FuenteCandidata,
} from '../src/validation/mediaAudit.js';
import {
  calcularPrioridad, extraerDominioDesdeUrl, mejorMatch, normalizarNombreMedio,
  pareceUrl, repararMojibake,
  type MedioEthosLite, type TipoMatch,
} from '../src/validation/pcMediaCatalog.js';

const COL_MEDIO = 4; // Columna E
const COL_URL = 8;   // Columna I

interface Args {
  file?: string;
  output: 'console' | 'sheet' | 'csv';
  dryRun: boolean;
  diagnoseLimit: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { output: 'console', dryRun: false, diagnoseLimit: 60 };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'file': out.file = val || undefined; break;
      case 'output': out.output = (val as Args['output']) || 'console'; break;
      case 'dry-run': out.dryRun = true; break;
      case 'diagnose-limit': out.diagnoseLimit = Number(val) || out.diagnoseLimit; break;
    }
  }
  return out;
}

// ── Detección de archivo ────────────────────────────────────────────────────

function detectarArchivo(explicito?: string): string {
  if (explicito) {
    const abs = path.resolve(explicito);
    if (!fs.existsSync(abs)) throw new Error(`Archivo no encontrado: ${abs}`);
    return abs;
  }
  const dir = path.resolve('data');
  if (!fs.existsSync(dir)) throw new Error('No existe la carpeta data/.');
  const candidatos = fs.readdirSync(dir)
    .filter((f) => /\.(csv|tsv|xlsx)$/i.test(f))
    .filter((f) => /medio|pressclipping/i.test(f) && !/hoy/i.test(f))
    .map((f) => ({ f, full: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (candidatos.length === 0) {
    throw new Error('No se encontró un archivo de catálogo en data/ (csv/tsv/xlsx con "medios" en el nombre).');
  }
  if (candidatos.length > 1) {
    logger.warn({ candidatos: candidatos.map((c) => c.f) }, 'Varios candidatos; se usa el más reciente.');
  }
  return candidatos[0]!.full;
}

// ── Parser CSV/TSV robusto (campos entrecomillados con saltos de línea) ──────

function parseDelimited(content: string, delim: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQ = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]!;
    if (inQ) {
      if (ch === '"') {
        if (content[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += ch;
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === delim) {
      record.push(field); field = '';
    } else if (ch === '\n') {
      record.push(field); records.push(record); record = []; field = '';
    } else if (ch === '\r') {
      // ignorar
    } else field += ch;
  }
  if (field !== '' || record.length > 0) { record.push(field); records.push(record); }
  return records;
}

async function leerArchivo(file: string): Promise<string[][]> {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.xlsx') {
    try {
      const xlsx = await import('xlsx' as string);
      const wb = xlsx.readFile(file);
      const nombre = wb.SheetNames[0];
      if (!nombre) throw new Error('El .xlsx no tiene hojas.');
      const sheet = wb.Sheets[nombre];
      return xlsx.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][];
    } catch {
      throw new Error('Archivo .xlsx pero la dependencia "xlsx" no está disponible. Convierta a CSV o instale xlsx.');
    }
  }
  const content = fs.readFileSync(file, 'utf8');
  const delim = ext === '.tsv' ? '\t' : ',';
  return parseDelimited(content, delim);
}

// ── Agrupación por medio ─────────────────────────────────────────────────────

interface MedioPC {
  nombre: string;            // representativo (más frecuente, con mojibake reparado)
  normalizado: string;
  frecuencia: number;
  urlEjemplo: string;
  urlsEjemplo: string[];
  dominio: string | null;
  dominios: Set<string>;
  sinUrl: boolean;
}

function agruparMedios(records: string[][]): { medios: MedioPC[]; filasLeidas: number; conUrl: number } {
  const grupos = new Map<string, {
    nombres: Map<string, number>; urls: string[]; dominios: Map<string, number>; frecuencia: number; sinUrl: number;
  }>();
  let filasLeidas = 0;
  let conUrl = 0;

  // Detectar y saltar cabecera si la primera fila no trae URL en col I.
  const start = records.length > 0 && !pareceUrl(records[0]?.[COL_URL]) && /url|medio/i.test((records[0]?.join(' ') ?? '')) ? 1 : 0;

  for (let r = start; r < records.length; r++) {
    const row = records[r]!;
    const nombreRaw = (row[COL_MEDIO] ?? '').trim();
    const urlRaw = (row[COL_URL] ?? '').trim();
    if (!nombreRaw) continue; // Columna E vacía → ignorar
    filasLeidas += 1;

    const nombre = repararMojibake(nombreRaw);
    const norm = normalizarNombreMedio(nombre);
    if (!norm) continue;
    const tieneUrl = pareceUrl(urlRaw);
    if (tieneUrl) conUrl += 1;
    const dominio = tieneUrl ? extraerDominioDesdeUrl(urlRaw) : null;

    const key = norm;
    let g = grupos.get(key);
    if (!g) { g = { nombres: new Map(), urls: [], dominios: new Map(), frecuencia: 0, sinUrl: 0 }; grupos.set(key, g); }
    g.frecuencia += 1;
    g.nombres.set(nombre, (g.nombres.get(nombre) ?? 0) + 1);
    if (tieneUrl) {
      if (g.urls.length < 3) g.urls.push(urlRaw);
      if (dominio) g.dominios.set(dominio, (g.dominios.get(dominio) ?? 0) + 1);
    } else {
      g.sinUrl += 1;
    }
  }

  const medios: MedioPC[] = [];
  for (const [norm, g] of grupos) {
    const nombre = [...g.nombres.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    const dominioTop = [...g.dominios.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    medios.push({
      nombre,
      normalizado: norm,
      frecuencia: g.frecuencia,
      urlEjemplo: g.urls[0] ?? '',
      urlsEjemplo: g.urls,
      dominio: dominioTop,
      dominios: new Set(g.dominios.keys()),
      sinUrl: g.urls.length === 0,
    });
  }
  medios.sort((a, b) => b.frecuencia - a.frecuencia);
  return { medios, filasLeidas, conUrl };
}

// ── Diagnóstico de fuentes (sin crawl masivo) ───────────────────────────────

const PROBE_TIMEOUT = 8000;
const VENTANA_DIAS = 30;

function dominioDe(url: string): string { return extraerDominioDesdeUrl(url) ?? ''; }

async function fetchCorto(url: string): Promise<{ ok: boolean; status: number; body: string; timeout: boolean; blocked: boolean }> {
  try {
    const body = await fetchText(url, { timeoutMs: PROBE_TIMEOUT, retries: 0 });
    return { ok: true, status: 200, body, timeout: false, blocked: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = Number(msg.match(/HTTP (\d+)/)?.[1] ?? 0);
    return { ok: false, status, body: '', timeout: /abort|timeout/i.test(msg), blocked: status === 401 || status === 403 };
  }
}

function contarRecientes(fechas: (string | null)[]): { recientes: number; disponibles: boolean } {
  const corte = Date.now() - VENTANA_DIAS * 86400_000;
  let recientes = 0; let disponibles = false;
  for (const f of fechas) {
    if (!f) continue;
    const t = Date.parse(f);
    if (Number.isNaN(t)) continue;
    disponibles = true;
    if (t >= corte) recientes += 1;
  }
  return { recientes, disponibles };
}

async function evaluarFuente(url: string, base: string): Promise<FuenteCandidata | null> {
  const res = await fetchCorto(url);
  if (!res.ok) return null;
  const head = res.body.slice(0, 400).toLowerCase();
  if (!/<!doctype html|<html[\s>]/.test(head)) {
    try {
      const items = await parseRssString(res.body);
      if (items.length > 0) {
        const { recientes, disponibles } = contarRecientes(items.map((i) => i.fecha ?? null));
        return { url, tipo: 'rss', items: items.length, recientes, fechasDisponibles: disponibles, dominioOk: true, esIndiceMasivo: false, esConfigurada: false };
      }
    } catch { /* */ }
  }
  try {
    const parsed = parseSitemapString(res.body);
    let items = parsed.items;
    const esIndice = parsed.subSitemaps.length > 0;
    if (items.length === 0 && parsed.subSitemaps.length > 0) {
      const sub = await fetchCorto(parsed.subSitemaps[0]!);
      if (sub.ok) { try { items = parseSitemapString(sub.body).items; } catch { /* */ } }
    }
    if (items.length > 0) {
      const { recientes, disponibles } = contarRecientes(items.map((i) => i.fecha ?? null));
      const masivo = esIndice && (parsed.subSitemaps.length >= 5 || items.length >= UMBRAL_INDICE_MASIVO);
      return { url, tipo: 'sitemap', items: items.length, recientes, fechasDisponibles: disponibles, dominioOk: true, esIndiceMasivo: masivo, esConfigurada: false };
    }
  } catch { /* */ }
  return null;
}

interface Diagnostico {
  estado_fuente: string;
  fuente_viable: string | null;
  tipo_fuente_viable: string | null;
  confidence: number;
}

async function diagnosticarMedio(dominio: string): Promise<Diagnostico> {
  const base = `https://${dominio}`;
  const cand = urlsCandidatas({ url_base: base, rss_url: null, sitemap_url: null });
  const candidatas: FuenteCandidata[] = [];
  let anyTimeout = false; let anyBlocked = false;

  if (cand.robots) {
    const r = await fetchCorto(cand.robots);
    if (r.timeout) anyTimeout = true;
    if (r.blocked) anyBlocked = true;
    if (r.ok) {
      for (const line of r.body.split(/\r?\n/)) {
        const mm = line.match(/^\s*sitemap:\s*(\S+)/i);
        if (mm?.[1]) cand.sitemap.unshift(mm[1].trim());
      }
    }
  }
  for (const url of cand.rss) {
    if (dominioDe(url) !== dominio && !url.includes(dominio)) continue;
    const c = await evaluarFuente(url, base);
    if (c) { candidatas.push(c); if (c.items >= 10) break; }
  }
  for (const url of cand.sitemap) {
    const c = await evaluarFuente(url, base);
    if (c) { candidatas.push(c); if (c.items >= 10 && !c.esIndiceMasivo) break; }
  }
  let directOk = false;
  if (candidatas.length === 0 && cand.page) {
    const r = await fetchCorto(cand.page);
    if (r.timeout) anyTimeout = true;
    if (r.blocked) anyBlocked = true;
    directOk = r.ok && /<html|<!doctype/i.test(r.body);
  }

  const ver = clasificarFuenteMedio({
    metodo_extraccion: null, rss_url: null, sitemap_url: null, url_base: base,
    requiere_javascript: false, requiere_proxy: false,
    configurada: null, candidatas, directOk, anyTimeout, anyBlocked,
    esAgregador: esDominioAgregador(base),
  });
  return {
    estado_fuente: ver.estado_fuente,
    fuente_viable: ver.fuente_viable,
    tipo_fuente_viable: ver.tipo_fuente_viable,
    confidence: ver.confidence_score,
  };
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (it: T, i: number) => Promise<R>): Promise<R[]> {
  const res: R[] = new Array(items.length);
  let idx = 0;
  async function worker(): Promise<void> {
    for (;;) { const i = idx++; if (i >= items.length) return; res[i] = await fn(items[i]!, i); }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return res;
}

// ── Carga de medios Ethos ────────────────────────────────────────────────────

async function cargarEthos(sb: SupabaseClient): Promise<MedioEthosLite[]> {
  const { data, error } = await sb.from('medios')
    .select('medio_id, nombre_medio, url_base, rss_url, sitemap_url, metodo_extraccion, ultimo_estado');
  if (error) throw new Error(`No se pudieron leer medios Ethos: ${error.message}`);
  return (data ?? []) as unknown as MedioEthosLite[];
}

// ── Fila de salida (09_Medios_PressClipping) ────────────────────────────────

const HEADERS_09 = [
  'pc_medio_original', 'pc_medio_normalizado', 'pc_url', 'pc_estado', 'pc_categoria',
  'pc_tipo_medio', 'pc_cobertura', 'pc_pais', 'pc_estado_mx', 'pc_municipio',
  'pc_fuente_archivo', 'pc_frecuencia_detectada', 'existe_en_ethos', 'medio_id_ethos',
  'nombre_medio_ethos', 'similitud_nombre', 'url_match', 'estado_ethos',
  'metodo_extraccion_ethos', 'fuente_actual_ethos', 'estado_fuente_ethos',
  'fuente_viable_detectada', 'tipo_fuente_viable', 'prioridad_alta', 'prioridad_reparacion',
  'accion_recomendada', 'razon_prioridad', 'riesgo', 'decision', 'fecha_diagnostico',
  'responsable', 'notas_tecnicas',
];

interface FilaPC extends Record<string, string | number | boolean> {}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const file = detectarArchivo(args.file);
  const fuenteArchivo = path.basename(file);
  logger.info({ file: fuenteArchivo, ...args }, 'Iniciando import-pressclipping-media-catalog');

  const records = await leerArchivo(file);
  const { medios, filasLeidas, conUrl } = agruparMedios(records);
  logger.info({ filas_crudas: records.length, filas_leidas: filasLeidas, medios_unicos: medios.length, con_url: conUrl }, 'Catálogo agrupado');

  const sb = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_SERVICE_ROLE_KEY']!);
  const ethos = await cargarEthos(sb);
  logger.info({ medios_ethos: ethos.length }, 'Medios Ethos cargados');

  // 1. Matching.
  const matches = medios.map((m) => ({ m, match: mejorMatch(m.nombre, m.dominio, ethos) }));

  // 2. Diagnóstico de FALTANTES con URL (acotado por frecuencia).
  const faltantesConUrl = matches
    .filter((x) => x.match.tipo === 'SIN_MATCH' && x.m.dominio && !esDominioAgregador(x.m.dominio))
    .sort((a, b) => b.m.frecuencia - a.m.frecuencia)
    .slice(0, args.diagnoseLimit);
  logger.info({ a_diagnosticar: faltantesConUrl.length, diagnose_limit: args.diagnoseLimit }, 'Diagnóstico de faltantes');

  const diagPorNorm = new Map<string, Diagnostico>();
  await mapPool(faltantesConUrl, 6, async (x) => {
    const d = await diagnosticarMedio(x.m.dominio!);
    diagPorNorm.set(x.m.normalizado, d);
    logger.info({ medio: x.m.nombre, estado: d.estado_fuente, conf: d.confidence }, `Diagnosticado faltante`);
  });

  const fecha = new Date().toISOString().substring(0, 10);
  const conteoMatch: Record<TipoMatch, number> = {
    MATCH_URL: 0, MATCH_EXACTO_NOMBRE: 0, MATCH_FUZZY_ALTO: 0, MATCH_FUZZY_MEDIO: 0, SIN_MATCH: 0,
  };
  const conteoPrioridad: Record<string, number> = { ALTA: 0, MEDIA: 0, BAJA: 0, NO_AGREGAR: 0, REVISAR: 0 };

  const filas: FilaPC[] = matches.map(({ m, match }) => {
    conteoMatch[match.tipo] += 1;
    const existe = match.tipo !== 'SIN_MATCH';
    const diag = diagPorNorm.get(m.normalizado);
    const esMexico = (m.dominio ?? '').endsWith('.mx') || /mexico/.test(m.normalizado);
    const agregador = esDominioAgregador(m.dominio) || esDominioAgregador(m.nombre);

    const fuenteViable = !!diag?.fuente_viable ||
      (existe && ['READY_RSS', 'READY_SITEMAP'].includes(match.medio?.ultimo_estado ?? ''));
    const prio = calcularPrioridad({
      existeEnEthos: existe, frecuencia: m.frecuencia, esAgregador: agregador,
      tieneFuenteViable: fuenteViable, esMexico, sinUrl: m.sinUrl,
    });
    const clavePrio = existe ? 'NO_AGREGAR' : prio.prioridad_reparacion;
    conteoPrioridad[clavePrio] = (conteoPrioridad[clavePrio] ?? 0) + 1;

    const estadoFuente = existe ? 'EN_ETHOS'
      : m.sinUrl ? 'SIN_URL_REQUIERE_BUSQUEDA'
      : diag?.estado_fuente ?? 'NO_DIAGNOSTICADO';

    const notas: string[] = [];
    if (m.dominios.size > 1) notas.push(`MULTIPLES_DOMINIOS: ${[...m.dominios].slice(0, 4).join(', ')}`);
    if (m.urlsEjemplo.length > 0) notas.push(`ejemplos: ${m.urlsEjemplo.join(' | ')}`);
    if (match.medio && match.tipo.startsWith('MATCH_FUZZY')) notas.push(`match fuzzy con ${match.medio.nombre_medio} (sim ${match.similitud})`);
    if (diag) notas.push(`diagnóstico confidence ${diag.confidence}`);

    const riesgo = match.tipo === 'MATCH_FUZZY_MEDIO' ? 'Match fuzzy medio: verificar antes de actuar.'
      : agregador ? 'Agregador: no agregar como medio individual.'
      : prio.prioridad_reparacion === 'REVISAR' ? 'Requiere revisión humana.'
      : 'Bajo.';

    return {
      pc_medio_original: m.nombre,
      pc_medio_normalizado: m.normalizado,
      pc_url: m.urlEjemplo,
      pc_estado: '',
      pc_categoria: '',
      pc_tipo_medio: '',
      pc_cobertura: '',
      pc_pais: esMexico ? 'MX' : '',
      pc_estado_mx: '',
      pc_municipio: '',
      pc_fuente_archivo: fuenteArchivo,
      pc_frecuencia_detectada: m.frecuencia,
      existe_en_ethos: existe,
      medio_id_ethos: match.medio?.medio_id ?? '',
      nombre_medio_ethos: match.medio?.nombre_medio ?? '',
      similitud_nombre: match.similitud,
      url_match: match.tipo === 'MATCH_URL',
      estado_ethos: match.medio?.ultimo_estado ?? '',
      metodo_extraccion_ethos: match.medio?.metodo_extraccion ?? '',
      fuente_actual_ethos: match.medio?.rss_url ?? match.medio?.sitemap_url ?? match.medio?.url_base ?? '',
      estado_fuente_ethos: estadoFuente,
      fuente_viable_detectada: diag?.fuente_viable ?? '',
      tipo_fuente_viable: diag?.tipo_fuente_viable ?? '',
      prioridad_alta: prio.prioridad_alta,
      prioridad_reparacion: existe ? 'NO_AGREGAR' : prio.prioridad_reparacion,
      accion_recomendada: existe ? 'Ya existe en Ethos; revisar fuente con audit-media-sources si falla.'
        : prio.prioridad_reparacion === 'ALTA' || prio.prioridad_reparacion === 'MEDIA'
          ? `Evaluar alta con fuente ${diag?.tipo_fuente_viable ?? 'por validar'}: ${diag?.fuente_viable ?? 's/d'}.`
          : 'No agregar / revisar manualmente.',
      razon_prioridad: prio.razon,
      riesgo,
      decision: '',
      fecha_diagnostico: fecha,
      responsable: '',
      notas_tecnicas: notas.join(' || '),
    };
  });

  // ── Resúmenes ──────────────────────────────────────────────────────────────
  console.log('\n=== CONTEO DE MATCH ===');
  for (const [k, n] of Object.entries(conteoMatch)) console.log(`  ${k.padEnd(22)}: ${n}`);
  console.log('\n=== CONTEO DE PRIORIDAD (faltantes) ===');
  for (const [k, n] of Object.entries(conteoPrioridad)) console.log(`  ${k.padEnd(12)}: ${n}`);

  const topCandidatos = filas
    .filter((f) => f.prioridad_reparacion === 'ALTA' || f.prioridad_reparacion === 'MEDIA')
    .sort((a, b) => Number(b.pc_frecuencia_detectada) - Number(a.pc_frecuencia_detectada))
    .slice(0, 15);
  console.log('\n=== TOP 15 CANDIDATOS (alta/media) ===');
  console.log('prio   | frec | fuente_viable                                   | medio');
  for (const f of topCandidatos) {
    console.log(`${String(f.prioridad_reparacion).padEnd(6)} | ${String(f.pc_frecuencia_detectada).padStart(4)} | ${String(f.fuente_viable_detectada || '-').padEnd(47).slice(0, 47)} | ${f.pc_medio_original}`);
  }

  if (args.output === 'csv') {
    console.log('\n=== CSV ===');
    console.log(HEADERS_09.join(','));
    for (const f of filas) console.log(HEADERS_09.map((h) => JSON.stringify((f as any)[h] ?? '')).join(','));
  }

  if (args.output === 'sheet') {
    if (args.dryRun) {
      logger.info({ filas: filas.length, tab: OUTPUT_TABS.MEDIOS_PRESSCLIPPING }, '[dry-run] No se escribió la Sheet.');
    } else {
      try {
        const escritas = await replaceOutputRows(OUTPUT_TABS.MEDIOS_PRESSCLIPPING, filas);
        logger.info({ escritas, tab: OUTPUT_TABS.MEDIOS_PRESSCLIPPING }, 'Catálogo exportado (replace) a 09_Medios_PressClipping');
      } catch (err) {
        logger.error({ error: err instanceof Error ? err.message : String(err) },
          'No se pudo escribir 09_Medios_PressClipping (¿existe la pestaña?). No se escribió nada.');
        process.exitCode = 1;
      }
    }
  }

  logger.info({
    archivo: fuenteArchivo, filas_leidas: filasLeidas, medios_unicos: medios.length, con_url: conUrl,
    existentes: filas.filter((f) => f.existe_en_ethos).length, faltantes: filas.filter((f) => !f.existe_en_ethos).length,
    ...conteoMatch,
  }, 'import-pressclipping-media-catalog completado.');
}

main().catch((err) => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en import-pressclipping-media-catalog');
  process.exit(1);
});
