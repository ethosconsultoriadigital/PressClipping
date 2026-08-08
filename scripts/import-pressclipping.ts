/**
 * Importación de histórico PressClipping a la tabla comparativo_pressclipping.
 *
 * Soporta:
 *   --fuente=csv    Lee un archivo CSV local.
 *   --fuente=xml    Lee un archivo XML local (PressClipping nativo o RSS).
 *   --fuente=sheet  (pendiente — requiere tab/ID de Sheet adicional)
 *
 * Uso:
 *   npm run import-pressclipping -- --fuente=csv --archivo=<path> --dry-run
 *   npm run import-pressclipping -- --fuente=xml --archivo=<path> --dry-run
 *   npm run import-pressclipping -- --fuente=xml --archivo=<path> --cliente=CLI-0001
 *   npm run import-pressclipping -- --fuente=xml --archivo=<path> --fecha-desde=2026-01-01
 *
 * En --dry-run parsea, normaliza y muestra estadísticas sin escribir nada.
 * Siempre guarda raw_row (la fila original) para auditoría.
 *
 * NOTA: La tabla comparativo_pressclipping debe existir antes de ejecutar
 * sin --dry-run. Aplicar 0010_comparativo_pressclipping.sql en Supabase.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import crypto from 'node:crypto';
import 'dotenv/config';
import { XMLParser } from 'fast-xml-parser';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  normalizeUrl,
  type MencionNorm,
} from '../src/comparators/mentionMatcher.js';
import { logger } from '../src/utils/logger.js';
import {
  retryPostgrest,
  isMissingTableError,
  describeSupabaseError,
  hintForSupabaseError,
} from '../src/supabase/errors.js';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos y args
// ─────────────────────────────────────────────────────────────────────────────

type Fuente = 'csv' | 'sheet' | 'xml';

interface ImportArgs {
  fuente: Fuente;
  archivo?: string;
  url?: string;       // URL directa al feed XML (descarga en memoria)
  sheetTab?: string;
  cliente?: string;
  fechaDesde?: string;
  fechaHasta?: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): ImportArgs {
  const out: ImportArgs = { fuente: 'csv', dryRun: false };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'fuente':      out.fuente = val as Fuente; break;
      case 'archivo':     out.archivo = val; break;
      case 'url':         out.url = val; break;
      case 'sheet-tab':   out.sheetTab = val; break;
      case 'cliente':     out.cliente = val; break;
      case 'fecha-desde': out.fechaDesde = val; break;
      case 'fecha-hasta': out.fechaHasta = val; break;
      case 'dry-run':     out.dryRun = true; break;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapa de variantes de campo (CSV y XML)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Variantes de nombre de campo que PressClipping puede usar.
 * Se aplica tanto a cabeceras CSV como a tags/atributos XML.
 *
 * Campos XML nativos PressClipping confirmados (2026-06-25):
 *   <estanteria>  → cliente / grupo_tema  (p.ej. "Bebidas alcohólicas")
 *   <palabra>     → keyword               (p.ej. "Tequila")
 *   <fecha_publicacion> → fecha
 *   <titular>     → titulo
 *   <medio>       → medio
 *   <url>         → url (artículo original)
 *   <formato>     → tipo_nota
 *   <textolibre>  → cuerpo (guardado en raw_row)
 *   <idnoticia>   → ID único PressClipping (guardado en raw_row)
 *   <archivo>     → URL archivo PressClipping (guardado en raw_row)
 */
export const FIELD_VARIANTS: Record<string, string[]> = {
  fecha:      ['fecha', 'date', 'fecha_publicacion', 'pub_date', 'fecha_nota', 'published', 'pubdate', 'publicationdate', 'publication_date'],
  // estanteria = categoría/cliente en PressClipping nativo
  cliente:    ['cliente', 'client', 'cliente_nombre', 'customer', 'estanteria'],
  cliente_id: ['cliente_id', 'client_id'],
  // estanteria también actúa como grupo_tema
  grupo_tema: ['grupo', 'grupo_tema', 'group', 'tema', 'grupo_tematico', 'category', 'categoria', 'estanteria'],
  // palabra = keyword monitoreada en PressClipping nativo
  keyword:    ['keyword', 'palabra_clave', 'termino', 'busqueda', 'query', 'term', 'palabraclave', 'palabra'],
  medio:      ['medio', 'media', 'fuente', 'source', 'nombre_medio', 'publication', 'publisher', 'outlet'],
  // titular = titulo en PressClipping nativo
  titulo:     ['titulo', 'title', 'titular', 'headline', 'noticia'],
  url:        ['url', 'link', 'enlace', 'url_nota', 'permalink', 'href'],
  autor:      ['autor', 'author', 'periodista', 'byline', 'reporter'],
  seccion:    ['seccion', 'section', 'seccion_nota', 'categoria', 'rubrica'],
  // formato = tipo de contenido en PressClipping nativo (HTML, PDF, etc.)
  tipo_nota:  ['tipo', 'tipo_nota', 'tipo_contenido', 'content_type', 'type', 'format', 'formato'],
};

// ─────────────────────────────────────────────────────────────────────────────
// CSV
// ─────────────────────────────────────────────────────────────────────────────

function detectarColumna(headers: string[], candidatos: string[]): string | undefined {
  const hNorm = headers.map(h => h.toLowerCase().trim());
  for (const c of candidatos) {
    const idx = hNorm.indexOf(c.toLowerCase());
    if (idx !== -1) return headers[idx];
  }
  return undefined;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuote = !inQuote;
    } else if (ch === ',' && !inQuote) {
      result.push(cur.trim()); cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

async function readCsv(filePath: string): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`Archivo no encontrado: ${abs}`);
  const rl = readline.createInterface({ input: fs.createReadStream(abs, 'utf8'), crlfDelay: Infinity });
  const lines: string[] = [];
  for await (const line of rl) lines.push(line);
  if (lines.length === 0) throw new Error('El archivo CSV está vacío.');
  const headers = parseCsvLine(lines[0]!);
  const rows = lines.slice(1)
    .filter(l => l.trim() !== '')
    .map(l => {
      const vals = parseCsvLine(l);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = vals[i] ?? ''; });
      return row;
    });
  return { headers, rows };
}

// ─────────────────────────────────────────────────────────────────────────────
// XML
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Candidatos de tag contenedor de items (raíz del arreglo de notas).
 * Se prueban en orden hasta encontrar un array no vacío.
 *
 * Estructura real PressClipping (confirmada 2026-06-25):
 *   <resumen fecha="..."> → <noticia>
 */
const ITEM_CONTAINER_TAGS = [
  // ── Formato nativo PressClipping (confirmado) ────────────────────────────
  ['resumen', 'noticia'],   // <resumen fecha="..."><noticia> — estructura real
  // ── Variantes PressClipping alternativas ─────────────────────────────────
  ['pressclipping', 'nota'],
  ['pressclipping', 'item'],
  ['pressclipping', 'mencion'],
  ['pressclipping', 'noticia'],
  // ── Genéricos ─────────────────────────────────────────────────────────────
  ['notas', 'nota'],
  ['menciones', 'mencion'],
  ['items', 'item'],
  ['noticias', 'noticia'],
  ['resultados', 'resultado'],
  ['resultados', 'item'],
  ['clipping', 'nota'],
  ['clipping', 'item'],
  ['reporte', 'nota'],
  ['reporte', 'item'],
  // ── RSS ───────────────────────────────────────────────────────────────────
  ['rss', 'channel', 'item'],
  ['feed', 'entry'],
  // ── Plano: el propio root es el arreglo ──────────────────────────────────
  ['nota'],
  ['item'],
  ['mencion'],
];

/**
 * Corrige mojibake: texto UTF-8 que fue leído como Latin-1 (Windows-1252).
 * Patrón típico del feed PressClipping: "México" aparece como "MÃ©xico".
 * bytes `C3 A9` (UTF-8 para é) → caracteres Latin-1 `Ã©` → se restaura é.
 */
function fixMojibake(s: string): string {
  try {
    const fixed = Buffer.from(s, 'latin1').toString('utf8');
    // Solo aplicar si el resultado no tiene caracteres de reemplazo (U+FFFD)
    return fixed.includes('\uFFFD') ? s : fixed;
  } catch {
    return s;
  }
}

/** Extrae valor de texto de un nodo que puede ser string, número u objeto. */
export function asText(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return undefined;
    return fixMojibake(trimmed);
  }
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  // CDATA o nodo con texto (fast-xml-parser devuelve { '#text': ... })
  if (typeof v === 'object') {
    const t = (v as Record<string, unknown>)['#text'];
    if (t !== undefined) return asText(t);
    // Nodo con un solo hijo de texto
    const keys = Object.keys(v as object);
    if (keys.length === 1) return asText((v as Record<string, unknown>)[keys[0]!]);
  }
  return undefined;
}

/**
 * Navega por un objeto JSON por una ruta de claves (case-insensitive).
 * Devuelve el valor o undefined si no existe.
 */
function getPath(obj: Record<string, unknown>, keys: string[]): unknown {
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur === null || typeof cur !== 'object') return undefined;
    const rec = cur as Record<string, unknown>;
    // Búsqueda case-insensitive
    const found = Object.keys(rec).find(rk => rk.toLowerCase() === k.toLowerCase());
    if (!found) return undefined;
    cur = rec[found];
  }
  return cur;
}

/**
 * Intenta detectar automáticamente el arreglo de items en el documento XML.
 * Prueba rutas conocidas y devuelve el primer array no vacío encontrado.
 */
export function detectXmlItems(doc: Record<string, unknown>): { items: Record<string, unknown>[]; ruta: string } {
  for (const ruta of ITEM_CONTAINER_TAGS) {
    const val = getPath(doc, ruta);
    if (Array.isArray(val) && val.length > 0) {
      return { items: val as Record<string, unknown>[], ruta: ruta.join(' > ') };
    }
    // Si hay un solo nodo (no array), envolverlo
    if (val !== null && val !== undefined && typeof val === 'object' && !Array.isArray(val)) {
      return { items: [val as Record<string, unknown>], ruta: ruta.join(' > ') + ' (único)' };
    }
  }
  // Fallback: intentar con el primer nivel del documento
  for (const [rootKey, rootVal] of Object.entries(doc)) {
    if (Array.isArray(rootVal) && rootVal.length > 0) {
      return { items: rootVal as Record<string, unknown>[], ruta: rootKey };
    }
  }
  return { items: [], ruta: '(no detectado)' };
}

/**
 * Busca el valor de un campo semántico en un item XML.
 * Prueba todas las variantes de nombre del campo.
 */
function getXmlField(item: Record<string, unknown>, campo: string): string | undefined {
  const candidatos = FIELD_VARIANTS[campo] ?? [];
  for (const c of candidatos) {
    // Búsqueda case-insensitive
    const key = Object.keys(item).find(k => k.toLowerCase() === c.toLowerCase());
    if (key) {
      const val = asText(item[key]);
      if (val) return val;
    }
  }
  return undefined;
}

/** Normaliza una fecha que puede venir en múltiples formatos. */
function normalizarFecha(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Si ya es YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.substring(0, 10);
  // Intenta parsear con Date
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
  } catch { /* ignorar */ }
  return raw;
}

/**
 * Genera hash SHA-256 canónico para deduplicación.
 * Campos: fuente + fecha + medio + titulo + url_norm + keyword.
 */
export function calcHashRegistro(
  fuente: string,
  fecha: string | undefined,
  medio: string | undefined,
  titulo: string | undefined,
  url_norm: string | undefined,
  keyword: string | undefined,
): string {
  const input = [
    fuente,
    (fecha ?? '').trim(),
    (medio ?? '').toLowerCase().trim(),
    (titulo ?? '').toLowerCase().trim(),
    (url_norm ?? '').trim(),
    (keyword ?? '').toLowerCase().trim(),
  ].join('|');
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Mapea un item XML crudo a MencionNorm. */
export function mapXmlItem(item: Record<string, unknown>): MencionNorm {
  const url = getXmlField(item, 'url');
  const fechaRaw = getXmlField(item, 'fecha');

  // Extraer id_externo del campo nativo PressClipping (idnoticia, id_noticia, id, guid)
  const id_externo =
    asText(item['idnoticia']) ??
    asText(item['id_noticia']) ??
    asText(item['id']) ??
    asText(item['guid']) ??
    undefined;

  return {
    fuente: 'PressClipping',
    fecha:     normalizarFecha(fechaRaw),
    cliente:   getXmlField(item, 'cliente'),
    cliente_id: getXmlField(item, 'cliente_id'),
    grupo_tema: getXmlField(item, 'grupo_tema'),
    keyword:   getXmlField(item, 'keyword'),
    medio:     getXmlField(item, 'medio'),
    titulo:    getXmlField(item, 'titulo'),
    url,
    url_norm:  normalizeUrl(url),
    autor:     getXmlField(item, 'autor'),
    seccion:   getXmlField(item, 'seccion'),
    tipo_nota: getXmlField(item, 'tipo_nota'),
    id_externo,
    raw:       item,
  };
}

/** Descarga el contenido de una URL y lo devuelve como string UTF-8. */
async function fetchXmlUrl(xmlUrl: string): Promise<string> {
  const res = await fetch(xmlUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} al descargar ${xmlUrl}`);
  return res.text();
}

/**
 * Lee y parsea un archivo XML desde ruta local.
 * Devuelve los items detectados y la ruta donde se encontraron.
 */
export function parseXmlFile(filePath: string): {
  items: Record<string, unknown>[];
  ruta: string;
  camposDetectados: string[];
} {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`Archivo no encontrado: ${abs}`);

  const contenido = fs.readFileSync(abs, 'utf8');
  if (!contenido.trim()) throw new Error('El archivo XML está vacío.');

  return parseXmlString(contenido);
}

/**
 * Parsea un string XML ya cargado (desde URL o archivo).
 * Devuelve los items detectados y la ruta donde se encontraron.
 */
export function parseXmlString(contenido: string): {
  items: Record<string, unknown>[];
  ruta: string;
  camposDetectados: string[];
} {
  if (!contenido.trim()) throw new Error('El contenido XML está vacío.');

  const xmlParser = new XMLParser({
    ignoreAttributes: false,       // preservar atributos por si los usan
    attributeNamePrefix: '@_',
    removeNSPrefix: true,          // quita namespaces: pc:nota → nota
    isArray: (name) => {
      // Tags que siempre son arrays (listas de items)
      return ['nota', 'item', 'mencion', 'noticia', 'entry', 'resultado'].includes(name.toLowerCase());
    },
    trimValues: true,
    parseTagValue: true,           // convierte números y booleanos
    cdataPropName: '#text',
  });

  const doc = xmlParser.parse(contenido) as Record<string, unknown>;
  const { items, ruta } = detectXmlItems(doc);

  // Detectar campos presentes en los primeros 5 items
  const camposDetectados = new Set<string>();
  for (const item of items.slice(0, 5)) {
    for (const campo of Object.keys(FIELD_VARIANTS)) {
      if (getXmlField(item as Record<string, unknown>, campo)) {
        camposDetectados.add(campo);
      }
    }
  }

  return { items, ruta, camposDetectados: Array.from(camposDetectados) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalización de fila CSV
// ─────────────────────────────────────────────────────────────────────────────

function mapearFilaCsv(
  row: Record<string, string>,
  colMap: Record<string, string | undefined>,
): MencionNorm {
  const get = (campo: string): string | undefined => {
    const col = colMap[campo];
    return col ? (row[col] || undefined) : undefined;
  };
  const url = get('url');
  return {
    fuente: 'PressClipping',
    fecha:     get('fecha'),
    cliente:   get('cliente'),
    cliente_id: get('cliente_id'),
    grupo_tema: get('grupo_tema'),
    keyword:   get('keyword'),
    medio:     get('medio'),
    titulo:    get('titulo'),
    url,
    url_norm:  normalizeUrl(url),
    autor:     get('autor'),
    seccion:   get('seccion'),
    tipo_nota: get('tipo_nota'),
    raw:       row,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Filtros y validaciones comunes
// ─────────────────────────────────────────────────────────────────────────────

function aplicarFiltros(menciones: MencionNorm[], args: ImportArgs): MencionNorm[] {
  let result = menciones;
  if (args.cliente) {
    const clienteNorm = args.cliente.toLowerCase();
    result = result.filter(m =>
      (m.cliente ?? '').toLowerCase().includes(clienteNorm) ||
      (m.cliente_id ?? '').toLowerCase() === clienteNorm,
    );
  }
  if (args.fechaDesde) result = result.filter(m => !m.fecha || m.fecha >= args.fechaDesde!);
  if (args.fechaHasta) result = result.filter(m => !m.fecha || m.fecha <= args.fechaHasta!);
  return result;
}

/** Reporta warnings de campos críticos faltantes y estadísticas. */
function reportarCalidad(filtradas: MencionNorm[]): void {
  const campos = ['fecha', 'medio', 'titulo', 'url', 'cliente', 'keyword'] as const;
  for (const campo of campos) {
    const faltantes = filtradas.filter(m => !m[campo]).length;
    if (faltantes === 0) continue;
    const critico = ['fecha', 'medio', 'titulo', 'url'].includes(campo);
    if (critico) {
      logger.warn({ campo, registros_sin_campo: faltantes, total: filtradas.length },
        `[calidad] Campo crítico faltante: ${campo}`);
    } else {
      logger.info({ campo, registros_sin_campo: faltantes, total: filtradas.length },
        `[calidad] Campo opcional faltante: ${campo}`);
    }
  }
}

/** Muestra de los primeros N registros normalizados. */
function mostrarMuestra(filtradas: MencionNorm[], n = 10): void {
  for (const m of filtradas.slice(0, n)) {
    logger.info({
      fecha:    m.fecha,
      medio:    m.medio,
      cliente:  m.cliente,
      keyword:  m.keyword,
      titulo:   String(m.titulo ?? '').substring(0, 80),
      url_norm: m.url_norm,
    }, '[muestra]');
  }
}

/** Resumen de diversidad: fechas, medios, clientes, keywords. */
function reportarDiversidad(filtradas: MencionNorm[]): void {
  const medios   = new Set(filtradas.map(m => m.medio).filter(Boolean));
  const clientes = new Set(filtradas.map(m => m.cliente).filter(Boolean));
  const keywords = new Set(filtradas.map(m => m.keyword).filter(Boolean));
  const fechas   = filtradas.map(m => m.fecha).filter(Boolean).sort();
  logger.info({
    medios_distintos:   medios.size,
    clientes_distintos: clientes.size,
    keywords_distintas: keywords.size,
    fecha_min: fechas[0] ?? 'N/A',
    fecha_max: fechas[fechas.length - 1] ?? 'N/A',
    muestra_medios:   Array.from(medios).slice(0, 10),
    muestra_clientes: Array.from(clientes).slice(0, 5),
    muestra_keywords: Array.from(keywords).slice(0, 10),
  }, 'Diversidad del corpus');
}

// ─────────────────────────────────────────────────────────────────────────────
// Inserción en Supabase
// ─────────────────────────────────────────────────────────────────────────────

async function insertarEnSupabase(
  sb: SupabaseClient,
  filtradas: MencionNorm[],
  fuente: Fuente,
): Promise<void> {
  // Verificar que la tabla existe (con reintentos ante base degradada).
  const { error: probeErr } = await retryPostgrest('probe comparativo_pressclipping', () =>
    sb.from('comparativo_pressclipping').select('id').limit(1),
  );

  if (probeErr) {
    // OJO: no basta con buscar "schema cache" en el mensaje. PGRST002
    // ("Could not query the database for the schema cache") es un fallo
    // TRANSITORIO de la base y también contiene esa frase; reportarlo como
    // migración faltante manda al diagnóstico equivocado.
    if (isMissingTableError(probeErr)) {
      logger.error({ error: describeSupabaseError(probeErr) },
        'La tabla comparativo_pressclipping no existe en Supabase. ' +
        'Aplica la migración 0010_comparativo_pressclipping.sql primero.');
      process.exit(1);
    }
    throw new Error(
      `Error al verificar tabla: ${describeSupabaseError(probeErr)}. ${hintForSupabaseError(probeErr)}`,
    );
  }

  // ── Calcular hashes para cada registro ───────────────────────────────────
  const conHash = filtradas.map(m => {
    const hash = calcHashRegistro(
      m.fuente, m.fecha, m.medio, m.titulo, m.url_norm, m.keyword,
    );
    return { m, id_externo: m.id_externo ?? null, hash_registro: hash };
  });

  // ── Cargar existentes para dedup ──────────────────────────────────────────
  // Intenta con columnas de migración 0011; si no existen, usa url_norm/fecha/medio/keyword
  const { data: existentes, error: extErr } = await sb
    .from('comparativo_pressclipping')
    .select('id_externo, hash_registro')
    .eq('fuente', 'PressClipping');

  let nuevos: typeof conHash;

  if (!extErr) {
    // Migración 0011 aplicada — dedup por id_externo y hash
    const extIdSet = new Set((existentes ?? []).map(r => r.id_externo).filter(Boolean) as string[]);
    const hashSet  = new Set((existentes ?? []).map(r => r.hash_registro).filter(Boolean) as string[]);
    nuevos = conHash.filter(r => {
      if (r.id_externo && extIdSet.has(r.id_externo)) return false;
      if (hashSet.has(r.hash_registro)) return false;
      return true;
    });
  } else {
    // Migración 0011 pendiente — dedup por url_norm + fecha + medio + keyword
    logger.warn(
      {},
      'Migración 0011 no aplicada. Usando dedup por url_norm+fecha+medio+keyword como fallback.',
    );
    const { data: existentesBasic } = await sb
      .from('comparativo_pressclipping')
      .select('url_norm, fecha, medio, keyword')
      .eq('fuente', 'PressClipping');
    const urlKeySet = new Set(
      (existentesBasic ?? []).map(r =>
        [r.url_norm ?? '', r.fecha ?? '', r.medio ?? '', r.keyword ?? ''].join('||'),
      ),
    );
    nuevos = conHash.filter(r => {
      const key = [
        r.m.url_norm ?? '', r.m.fecha ?? '', r.m.medio ?? '', r.m.keyword ?? '',
      ].join('||');
      return !urlKeySet.has(key);
    });
  }

  const omitidas = conHash.length - nuevos.length;

  logger.info({
    total: conHash.length,
    nuevas: nuevos.length,
    omitidas_duplicadas: omitidas,
  }, 'Deduplicación completada');

  if (nuevos.length === 0) {
    logger.info({}, 'Importación completada — todos los registros ya existían.');
    return;
  }

  // ── Insertar solo registros nuevos ────────────────────────────────────────
  const filas = nuevos.map(({ m, id_externo, hash_registro }) => ({
    fuente:        m.fuente,
    fecha:         m.fecha ?? null,
    cliente:       m.cliente ?? null,
    grupo_tema:    m.grupo_tema ?? null,
    keyword:       m.keyword ?? null,
    medio:         m.medio ?? null,
    titulo:        m.titulo ?? null,
    url:           m.url ?? null,
    url_norm:      m.url_norm ?? null,
    autor:         m.autor ?? null,
    seccion:       m.seccion ?? null,
    tipo_nota:     m.tipo_nota ?? null,
    id_externo,
    hash_registro,
    importado_de:  fuente,
    raw_row:       m.raw,
  }));

  const BATCH = 200;
  let insertadas = 0;
  let usandoFallback = false;

  for (let i = 0; i < filas.length; i += BATCH) {
    const lote = filas.slice(i, i + BATCH);
    const { error } = await sb.from('comparativo_pressclipping').insert(lote);

    if (error) {
      // Fallback: si las columnas nuevas (migración 0011) aún no existen, reintentar sin ellas
      if (!usandoFallback && (
        error.message.includes('hash_registro') || error.message.includes('id_externo')
      )) {
        logger.warn(
          {},
          'Columnas hash_registro/id_externo no existen aún (migración 0011 pendiente). ' +
          'Insertando sin campos de dedup estructural. Aplica 0011 en Supabase SQL Editor.',
        );
        usandoFallback = true;
        const loteSinHash = lote.map(({ hash_registro: _h, id_externo: _e, ...rest }) => rest);
        const { error: err2 } = await sb.from('comparativo_pressclipping').insert(loteSinHash);
        if (err2) {
          logger.error({ lote_inicio: i, error: err2.message }, 'Error al insertar lote (fallback)');
        } else {
          insertadas += loteSinHash.length;
        }
      } else if (usandoFallback) {
        const loteSinHash = lote.map(({ hash_registro: _h, id_externo: _e, ...rest }) => rest);
        const { error: err2 } = await sb.from('comparativo_pressclipping').insert(loteSinHash);
        if (err2) {
          logger.error({ lote_inicio: i, error: err2.message }, 'Error al insertar lote (fallback)');
        } else {
          insertadas += loteSinHash.length;
        }
      } else {
        logger.error({ lote_inicio: i, error: error.message }, 'Error al insertar lote');
      }
    } else {
      insertadas += lote.length;
    }
  }
  logger.info({ insertadas, omitidas }, 'Importación completada.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  logger.info({
    fuente: args.fuente,
    archivo: args.archivo,
    cliente: args.cliente,
    fechaDesde: args.fechaDesde,
    fechaHasta: args.fechaHasta,
    dryRun: args.dryRun,
  }, 'Iniciando import-pressclipping');

  if (args.fuente === 'sheet') {
    logger.warn({ fuente: args.fuente },
      'Fuente "sheet" aún no implementada. Solo --fuente=csv y --fuente=xml están disponibles.');
    process.exit(0);
  }

  // Para XML: acepta --url o --archivo; para CSV solo --archivo
  if (args.fuente === 'xml' && !args.archivo && !args.url) {
    logger.error({}, 'Para XML debes especificar --archivo=<path> o --url=<url>.');
    process.exit(1);
  }
  if (args.fuente === 'csv' && !args.archivo) {
    logger.error({}, 'Debes especificar --archivo=<path>.');
    process.exit(1);
  }

  let menciones: MencionNorm[];

  // ── Flujo CSV ─────────────────────────────────────────────────────────────
  if (args.fuente === 'csv') {
    let headers: string[];
    let rawRows: Record<string, string>[];
    try {
      ({ headers, rows: rawRows } = await readCsv(args.archivo!));
    } catch (err: unknown) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error al leer el CSV');
      process.exit(1);
    }

    logger.info({ archivo: args.archivo, columnas: headers.length, filas: rawRows.length }, 'CSV leído');

    const colMap: Record<string, string | undefined> = {};
    for (const [campo, candidatos] of Object.entries(FIELD_VARIANTS)) {
      colMap[campo] = detectarColumna(headers, candidatos);
    }
    logger.info(
      Object.fromEntries(Object.entries(colMap).map(([k, v]) => [k, v ?? '(no detectado)'])),
      'Mapeo de columnas CSV',
    );

    menciones = rawRows.map(row => mapearFilaCsv(row, colMap));
  }

  // ── Flujo XML ─────────────────────────────────────────────────────────────
  else {
    let items: Record<string, unknown>[];
    let ruta: string;
    let camposDetectados: string[];
    const origen = args.url ?? args.archivo!;
    try {
      if (args.url) {
        logger.info({ url: args.url }, 'Descargando XML desde URL');
        const contenido = await fetchXmlUrl(args.url);
        ({ items, ruta, camposDetectados } = parseXmlString(contenido));
      } else {
        ({ items, ruta, camposDetectados } = parseXmlFile(args.archivo!));
      }
    } catch (err: unknown) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error al leer el XML');
      process.exit(1);
    }

    logger.info({
      origen,
      nodos_detectados: items.length,
      ruta_detectada:   ruta,
      campos_mapeados:  camposDetectados,
    }, 'XML leído');

    if (items.length === 0) {
      logger.warn({},
        'No se encontraron items en el XML. ' +
        'Verifica la estructura del archivo o reporta el formato al equipo técnico.');
      process.exit(0);
    }

    menciones = items.map(item => mapXmlItem(item));
  }

  // ── Filtros y calidad ─────────────────────────────────────────────────────
  const filtradas = aplicarFiltros(menciones, args);

  logger.info({
    total_bruto:  menciones.length,
    tras_filtros: filtradas.length,
  }, 'Resumen tras filtros');

  reportarCalidad(filtradas);
  reportarDiversidad(filtradas);
  mostrarMuestra(filtradas, 10);

  // ── Dry-run ───────────────────────────────────────────────────────────────
  if (args.dryRun) {
    logger.info(
      { listas_para_insertar: filtradas.length },
      '[dry-run] Parseo y normalización completados — no se escribió nada.',
    );
    return;
  }

  // ── Insertar ──────────────────────────────────────────────────────────────
  const sb = createClient(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );
  await insertarEnSupabase(sb, filtradas, args.fuente);
}

// Ejecutar solo cuando el script es el punto de entrada, no cuando se importa en tests
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch(err => {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Error fatal en import-pressclipping',
    );
    process.exit(1);
  });
}
