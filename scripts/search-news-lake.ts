/**
 * News Lake — buscador ad-hoc de solo lectura.
 *
 * Busca sobre CUALQUIER noticia capturada (no solo las que ya tienen mención
 * de algún cliente) dentro de una ventana móvil de N días. Pensado para
 * responder preguntas puntuales tipo "¿salió algo de X persona/empresa/marca
 * en los últimos 30 días?" sin tener que dar de alta un cliente/keyword.
 *
 * NUNCA escribe nada: no inserta menciones, no marca noticias como
 * procesadas, no toca Sheets ni alertas.
 *
 * Estrategias de búsqueda:
 *   --query="texto libre"   → intenta full-text de Postgres (`fts`, español);
 *                             si falla (columna/índice no disponible, error
 *                             de sintaxis, etc.) hace fallback automático a
 *                             ILIKE sobre título/resumen/texto_*.
 *   --exact="frase exacta"  → matchKeyword con tipo frase_exacta (límite de
 *                             palabra), evaluado en memoria sobre la ventana.
 *   --contains="término"    → matchKeyword con tipo contiene (substring),
 *                             evaluado en memoria sobre la ventana.
 * Si se combina más de una, se usa una sola con precedencia
 * query > exact > contains (se avisa cuál se ignoró).
 * Sin ninguna: modo "browse", devuelve lo más reciente de la ventana.
 *
 * Uso:
 *   npm run news-lake:search -- --query="Mery Pozos"
 *   npm run news-lake:search -- --contains="Jumex"
 *   npm run news-lake:search -- --exact="Bacardí México"
 *   npm run news-lake:search -- --query="SIAPA plomo mercurio" --window-days=30 --limit=20
 *   npm run news-lake:search -- --contains="Jumex" --format=json
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import {
  getNoticiasEnVentana,
  type NoticiaLakeRow,
} from '../src/supabase/repositories.js';
import { matchKeyword, type KeywordRule, type CampoBuscable } from '../src/matchers/keyword.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull, parseBool } from '../src/utils/parse.js';

// ─────────────────────────────────────────────────────────────────────────────
// Args
// ─────────────────────────────────────────────────────────────────────────────

export type FormatoSalida = 'table' | 'json';

export interface SearchNewsLakeArgs {
  query?: string;
  exact?: string;
  contains?: string;
  windowDays: number;
  medioIds?: string[];
  limit: number;
  format: FormatoSalida;
  fullText: boolean;
}

function splitList(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Extrae `--flag="valor con espacios"` o `--flag=valor` de la línea de comandos ya tokenizada por el shell. */
function parseFlagValue(raw: string): string {
  let v = raw;
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
  return v;
}

export function parseArgs(argv: string[]): SearchNewsLakeArgs {
  const out: SearchNewsLakeArgs = {
    windowDays: 30,
    limit: 20,
    format: 'table',
    fullText: true,
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : parseFlagValue(body.slice(eq + 1));
    switch (key) {
      case 'query':
        out.query = val;
        break;
      case 'exact':
        out.exact = val;
        break;
      case 'contains':
        out.contains = val;
        break;
      case 'window-days':
        out.windowDays = parseIntOrNull(val) ?? out.windowDays;
        break;
      case 'medio-ids':
        out.medioIds = splitList(val);
        break;
      case 'limit':
        out.limit = parseIntOrNull(val) ?? out.limit;
        break;
      case 'format':
        out.format = val === 'json' ? 'json' : 'table';
        break;
      case 'full-text':
        out.fullText = val === '' ? true : parseBool(val, true);
        break;
      default:
        logger.warn({ flag: arg }, 'Flag desconocido ignorado');
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Búsqueda
// ─────────────────────────────────────────────────────────────────────────────

/** Tope de filas a escanear en memoria para --exact/--contains (independiente de --limit final). */
const SCAN_LIMIT_MAX = 2000;
const SCAN_LIMIT_MIN = 200;

export interface ResultadoBusqueda {
  rows: NoticiaLakeRow[];
  /** Cómo se resolvió la búsqueda: útil para diagnóstico y para los tests. */
  estrategia: 'fts' | 'ilike' | 'exact' | 'contains' | 'browse';
  /** Si se intentó fts y falló, cayendo a ilike. */
  ftsFallback: boolean;
  totalEscaneadas: number;
}

function textoEfectivo(row: NoticiaLakeRow): string {
  return row.texto_cuerpo_nota ?? row.texto_nota_limpia ?? row.texto_extraido ?? row.resumen ?? '';
}

function camposDeLake(row: NoticiaLakeRow): CampoBuscable[] {
  return [
    { nombre: 'titulo', texto: row.titulo ?? '', peso: 1.0 },
    { nombre: 'resumen', texto: row.resumen ?? '', peso: 0.6 },
    { nombre: 'texto_extraido', texto: textoEfectivo(row), peso: 0.4 },
    { nombre: 'medio', texto: row.medio_nombre ?? '', peso: 0.3 },
  ];
}

function reglaAdHoc(termino: string, tipo: 'exacta' | 'frase_exacta' | 'contiene'): KeywordRule {
  return {
    keyword_id: 'AD-HOC',
    cliente_id: null,
    keyword: termino,
    terminos: [termino],
    tipo,
    regla: null,
    contextoIncluir: [],
    contextoExcluir: [],
  };
}

/** Ejecuta la búsqueda ad-hoc según los args. Solo lectura; no escribe nada. */
export async function buscarNewsLake(args: SearchNewsLakeArgs): Promise<ResultadoBusqueda> {
  if (args.query && args.exact) {
    logger.warn({}, 'Nota: --exact ignorado (precedencia query > exact > contains)');
  }
  if (args.query && args.contains) {
    logger.warn({}, 'Nota: --contains ignorado (precedencia query > exact > contains)');
  }
  if (!args.query && args.exact && args.contains) {
    logger.warn({}, 'Nota: --contains ignorado (precedencia exact > contains)');
  }

  if (args.query) {
    if (args.fullText) {
      try {
        const rows = await getNoticiasEnVentana({
          windowDays: args.windowDays,
          medioIds: args.medioIds,
          limit: args.limit,
          textFilter: { modo: 'fts', query: args.query },
        });
        return { rows, estrategia: 'fts', ftsFallback: false, totalEscaneadas: rows.length };
      } catch (err) {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          'Full-text search (fts) falló; usando fallback ILIKE',
        );
      }
    }
    const rows = await getNoticiasEnVentana({
      windowDays: args.windowDays,
      medioIds: args.medioIds,
      limit: args.limit,
      textFilter: { modo: 'ilike', term: args.query },
    });
    return { rows, estrategia: 'ilike', ftsFallback: args.fullText, totalEscaneadas: rows.length };
  }

  const terminoMemoria = args.exact ?? args.contains;
  if (terminoMemoria) {
    const tipo: 'frase_exacta' | 'contiene' = args.exact ? 'frase_exacta' : 'contiene';
    const scanLimit = Math.min(SCAN_LIMIT_MAX, Math.max(SCAN_LIMIT_MIN, args.limit * 10));
    const candidatas = await getNoticiasEnVentana({
      windowDays: args.windowDays,
      medioIds: args.medioIds,
      limit: scanLimit,
    });
    const regla = reglaAdHoc(terminoMemoria, tipo);
    const matches = candidatas.filter((row) => matchKeyword(regla, camposDeLake(row)) !== null);
    return {
      rows: matches.slice(0, args.limit),
      estrategia: args.exact ? 'exact' : 'contains',
      ftsFallback: false,
      totalEscaneadas: candidatas.length,
    };
  }

  const rows = await getNoticiasEnVentana({
    windowDays: args.windowDays,
    medioIds: args.medioIds,
    limit: args.limit,
  });
  return { rows, estrategia: 'browse', ftsFallback: false, totalEscaneadas: rows.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Salida
// ─────────────────────────────────────────────────────────────────────────────

interface FilaSalida {
  noticia_id: string;
  medio_id: string | null;
  medio_nombre: string | null;
  titulo: string | null;
  resumen: string | null;
  url_original: string | null;
  fecha_publicacion: string | null;
  texto: string;
}

export function proyectarSalida(row: NoticiaLakeRow): FilaSalida {
  return {
    noticia_id: row.noticia_id,
    medio_id: row.medio_id,
    medio_nombre: row.medio_nombre,
    titulo: row.titulo,
    resumen: row.resumen,
    url_original: row.url_original,
    fecha_publicacion: row.fecha_publicacion,
    texto: textoEfectivo(row),
  };
}

function truncar(s: string | null | undefined, max: number): string {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

function imprimirTabla(filas: FilaSalida[]): void {
  if (filas.length === 0) {
    console.log('(sin resultados)');
    return;
  }
  for (const f of filas) {
    console.log('─'.repeat(100));
    console.log(`[${f.fecha_publicacion ?? 's/fecha'}] ${f.medio_nombre ?? f.medio_id ?? 's/medio'} (${f.medio_id ?? '-'})`);
    console.log(`  Título:  ${truncar(f.titulo, 140)}`);
    console.log(`  URL:     ${truncar(f.url_original, 140)}`);
    console.log(`  Resumen: ${truncar(f.resumen, 200)}`);
    console.log(`  Texto:   ${truncar(f.texto, 220)}`);
  }
  console.log('─'.repeat(100));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  logger.info(
    {
      query: args.query ?? null,
      exact: args.exact ?? null,
      contains: args.contains ?? null,
      window_days: args.windowDays,
      medio_ids: args.medioIds ?? null,
      limit: args.limit,
      format: args.format,
      full_text: args.fullText,
    },
    '=== News Lake Search (solo lectura) ===',
  );

  const resultado = await buscarNewsLake(args);
  const filas = resultado.rows.map(proyectarSalida);

  logger.info(
    {
      estrategia: resultado.estrategia,
      fts_fallback: resultado.ftsFallback,
      total_escaneadas: resultado.totalEscaneadas,
      total_resultados: filas.length,
    },
    'Búsqueda completada',
  );

  if (args.format === 'json') {
    console.log(JSON.stringify(filas, null, 2));
  } else {
    imprimirTabla(filas);
  }
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((err) => {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en search-news-lake');
    process.exit(1);
  });
}

export { main };
