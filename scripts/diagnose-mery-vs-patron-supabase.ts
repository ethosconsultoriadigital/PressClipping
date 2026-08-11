/**
 * Diagnóstico dirigido, read-only: Mery (CLI-MERY-TEST) vs Patrón (CLI-0002)
 * contra Supabase.
 *
 * Objetivo: explicar por qué `cargarMenciones` en
 * `scripts/mery-export-test-pressclipping.ts` falla de forma persistente con
 * PGRST002 (`transient_schema_cache`) en GitHub Actions, mientras
 * `scripts/run-patron-no-pc-production-capture.ts` (CLI-0002) sí corre
 * exitosamente en el mismo entorno.
 *
 * Hipótesis principal a confirmar (ver README de la entrega): el workflow
 * `mery-test-pressclipping.yml` NUNCA pasa `--max-rows`, así que
 * `cargarMenciones` usa el default `maxRows=500` y pide
 * `.limit(maxRows * 10)` = 5000 filas con un embed doble
 * (`noticias!inner(...medios(...))`) y varias columnas TEXT grandes
 * (texto_cuerpo_nota, texto_nota_limpia, texto_extraido). El pipeline de
 * Patrón, en cambio, siempre recibe `--max-rows=300` desde
 * `patron-no-pc-capture.yml` y pide `.limit(args.maxRows)` = 300 filas con un
 * embed equivalente pero SIN `!inner`. Ese diferencial (~16x en el límite)
 * es la sospecha principal de sobrecarga en Postgres que dispara PGRST002 en
 * la MISMA request de Mery.
 *
 * Este script NO confirma ni descarta por sí solo: mide tiempos y
 * clasificación de errores en queries mínimas y equivalentes para dar
 * evidencia objetiva. Con `--full-limit-test` reproduce además el límite
 * REAL de producción de Mery (5000) para una prueba directa — sigue siendo
 * solo lectura (SELECT), nunca escribe nada.
 *
 * Solo lecturas. No escribe nada. No imprime secretos.
 *
 * Uso:
 *   npm run diagnose:mery-vs-patron
 *   npm run diagnose:mery-vs-patron -- --full-limit-test
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import {
  retryPostgrest,
  classifySupabaseError,
  describeSupabaseError,
  hintForSupabaseError,
  type SupabaseFailureKind,
  type SupabaseErrorLike,
} from '../src/supabase/errors.js';
import { conTimeout } from './diagnose-supabase.js';
import { logger } from '../src/utils/logger.js';

const CLI_MERY = 'CLI-MERY-TEST';
const CLI_PATRON = 'CLI-0002';

/** Presupuesto por query: más generoso que un probe simple porque admite reintentos. */
export const QUERY_TIMEOUT_MS = 20_000;

/**
 * Reintentos acotados para el diagnóstico (vs. 4 en producción): suficiente
 * para ver si el error es transitorio sin alargar demasiado la corrida total
 * (hasta 8 queries en secuencia).
 */
export const DIAG_MAX_INTENTOS = 2;

const AHORA = Date.now();
const ISO_24H = new Date(AHORA - 24 * 60 * 60 * 1000).toISOString();

/** Select EXACTO de `cargarMenciones()` en mery-export-test-pressclipping.ts. */
const MERY_SELECT = `mencion_id, noticia_id, keyword_id, keyword, texto_match, sentimiento, tema,
   noticias!inner(titulo, url_original, resumen, fecha_publicacion,
                  texto_nota_limpia, texto_cuerpo_nota, texto_extraido,
                  medios(nombre_medio))`;

/** Select EXACTO usado por Patrón en export-operational-news-no-pc.ts (filtrado a CLI-0002). */
const PATRON_SELECT = `mencion_id, cliente_id, keyword_id, keyword, tema, sentimiento, requiere_alerta, estado_revision, created_at,
   noticias(noticia_id, medio_id, titulo, url_original, fecha_publicacion, texto_cuerpo_nota, texto_nota_limpia, texto_extraido, medios(nombre_medio))`;

export interface QueryPlanItem {
  nombre: string;
  tabla: string;
  filtro: string;
  orden: string;
  rango: string;
  joins: string;
  limite: number;
  run: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: SupabaseErrorLike | null }>;
}

/** Construye el plan de queries de diagnóstico (a–g fijas, h opcional). */
export function buildQueryPlan(opts: { fullLimitTest: boolean }): QueryPlanItem[] {
  const plan: QueryPlanItem[] = [
    {
      nombre: 'a) clientes limit(0)',
      tabla: 'clientes', filtro: 'ninguno', orden: 'ninguno', rango: 'ninguno', joins: 'ninguno', limite: 0,
      run: (signal) => getSupabase().from('clientes').select('*').limit(0).abortSignal(signal),
    },
    {
      nombre: 'b) noticias limit(0)',
      tabla: 'noticias', filtro: 'ninguno', orden: 'ninguno', rango: 'ninguno', joins: 'ninguno', limite: 0,
      run: (signal) => getSupabase().from('noticias').select('*').limit(0).abortSignal(signal),
    },
    {
      nombre: 'c) menciones limit(0)',
      tabla: 'menciones', filtro: 'ninguno', orden: 'ninguno', rango: 'ninguno', joins: 'ninguno', limite: 0,
      run: (signal) => getSupabase().from('menciones').select('*').limit(0).abortSignal(signal),
    },
    {
      nombre: `d) menciones cliente_id=${CLI_MERY} limit(1)`,
      tabla: 'menciones', filtro: `cliente_id=${CLI_MERY}`, orden: 'ninguno', rango: 'ninguno', joins: 'ninguno', limite: 1,
      run: (signal) =>
        getSupabase()
          .from('menciones')
          .select('mencion_id, noticia_id, cliente_id, created_at')
          .eq('cliente_id', CLI_MERY)
          .limit(1)
          .abortSignal(signal),
    },
    {
      nombre: `e) menciones cliente_id=${CLI_PATRON} limit(1)`,
      tabla: 'menciones', filtro: `cliente_id=${CLI_PATRON}`, orden: 'ninguno', rango: 'ninguno', joins: 'ninguno', limite: 1,
      run: (signal) =>
        getSupabase()
          .from('menciones')
          .select('mencion_id, noticia_id, cliente_id, created_at')
          .eq('cliente_id', CLI_PATRON)
          .limit(1)
          .abortSignal(signal),
    },
    {
      nombre: 'f) query EXACTA cargarMenciones (Mery) — limit=20 (reducido de 5000)',
      tabla: 'menciones', filtro: `cliente_id=${CLI_MERY}`, orden: 'created_at desc',
      rango: `created_at >= ${ISO_24H}`,
      joins: 'noticias!inner(...medios(nombre_medio)) — INNER, embed doble',
      limite: 20,
      run: (signal) =>
        getSupabase()
          .from('menciones')
          .select(MERY_SELECT)
          .eq('cliente_id', CLI_MERY)
          .gte('created_at', ISO_24H)
          .order('created_at', { ascending: false })
          .limit(20)
          .abortSignal(signal),
    },
    {
      nombre: 'g) query EQUIVALENTE Patrón (export-operational-news-no-pc) — limit=20',
      tabla: 'menciones', filtro: `cliente_id=${CLI_PATRON}`, orden: 'created_at desc',
      rango: `created_at >= ${ISO_24H}`,
      joins: 'noticias(...medios(nombre_medio)) — LEFT (default), embed doble',
      limite: 20,
      run: (signal) =>
        getSupabase()
          .from('menciones')
          .select(PATRON_SELECT)
          .eq('cliente_id', CLI_PATRON)
          .gte('created_at', ISO_24H)
          .order('created_at', { ascending: false })
          .limit(20)
          .abortSignal(signal),
    },
  ];

  if (opts.fullLimitTest) {
    plan.push({
      nombre: 'h) [OPCIONAL] query Mery con LÍMITE REAL de producción (limit=5000) — prueba directa de la hipótesis de volumen',
      tabla: 'menciones', filtro: `cliente_id=${CLI_MERY}`, orden: 'created_at desc',
      rango: `created_at >= ${ISO_24H}`,
      joins: 'noticias!inner(...medios(nombre_medio)) — INNER, embed doble',
      limite: 5000,
      run: (signal) =>
        getSupabase()
          .from('menciones')
          .select(MERY_SELECT)
          .eq('cliente_id', CLI_MERY)
          .gte('created_at', ISO_24H)
          .order('created_at', { ascending: false })
          .limit(5000)
          .abortSignal(signal),
    });
  }

  return plan;
}

export interface QueryDiagResult {
  nombre: string;
  tabla: string;
  ok: boolean;
  clasificacion: SupabaseFailureKind | 'timeout' | 'OK';
  codigo: string | null;
  filas: number | null;
  ms: number;
  detalle: string | null;
}

/** Ejecuta una query del plan con timeout duro + retryPostgrest, sin ocultar la clasificación real. */
export async function runQueryDiag(item: QueryPlanItem): Promise<QueryDiagResult> {
  const inicio = Date.now();
  try {
    const resultado = await conTimeout(
      item.nombre,
      (signal) => retryPostgrest(item.nombre, () => item.run(signal), DIAG_MAX_INTENTOS),
      QUERY_TIMEOUT_MS,
    );

    if (resultado.estado === 'timeout') {
      return {
        nombre: item.nombre, tabla: item.tabla, ok: false, clasificacion: 'timeout',
        codigo: null, filas: null, ms: resultado.ms,
        detalle: `Sin respuesta en ${QUERY_TIMEOUT_MS} ms (incluye reintentos)`,
      };
    }

    const { data, error } = resultado.valor;
    if (!error) {
      const filas = Array.isArray(data) ? data.length : null;
      return {
        nombre: item.nombre, tabla: item.tabla, ok: true, clasificacion: 'OK',
        codigo: null, filas, ms: resultado.ms, detalle: null,
      };
    }
    return {
      nombre: item.nombre, tabla: item.tabla, ok: false,
      clasificacion: classifySupabaseError(error),
      codigo: typeof error.code === 'string' ? error.code : null,
      filas: null, ms: resultado.ms, detalle: describeSupabaseError(error),
    };
  } catch (err) {
    return {
      nombre: item.nombre, tabla: item.tabla, ok: false,
      clasificacion: classifySupabaseError(err), codigo: null, filas: null,
      ms: Date.now() - inicio, detalle: describeSupabaseError(err),
    };
  }
}

async function main(): Promise<void> {
  const fullLimitTest = process.argv.includes('--full-limit-test');
  logger.info(
    { fullLimitTest, timeout_por_query_ms: QUERY_TIMEOUT_MS, intentos_por_query: DIAG_MAX_INTENTOS },
    '=== Diagnóstico dirigido: Mery (CLI-MERY-TEST) vs Patrón (CLI-0002) — read-only ===',
  );

  const plan = buildQueryPlan({ fullLimitTest });
  const resultados: QueryDiagResult[] = [];

  for (const item of plan) {
    logger.info(
      { tabla: item.tabla, filtro: item.filtro, orden: item.orden, rango: item.rango, joins: item.joins, limite: item.limite },
      `→ ${item.nombre}`,
    );
    const r = await runQueryDiag(item);
    resultados.push(r);
    if (r.ok) {
      logger.info(r, `  OK   ${r.nombre} (${r.ms} ms, filas=${r.filas})`);
    } else {
      logger.error(r, `  FAIL ${r.nombre} (${r.ms} ms) — ${r.clasificacion}`);
    }
  }

  logger.info({}, '=== Resumen comparativo ===');
  for (const r of resultados) {
    logger.info(
      { nombre: r.nombre, ok: r.ok, clasificacion: r.clasificacion, codigo: r.codigo, ms: r.ms, filas: r.filas },
      `  ${r.ok ? 'OK  ' : 'FAIL'} ${r.nombre}`,
    );
  }

  const mery = resultados.find((r) => r.nombre.startsWith('f)'));
  const patron = resultados.find((r) => r.nombre.startsWith('g)'));
  if (mery && patron) {
    logger.info(
      {
        mery_ms: mery.ms, mery_ok: mery.ok, mery_clasificacion: mery.clasificacion,
        patron_ms: patron.ms, patron_ok: patron.ok, patron_clasificacion: patron.clasificacion,
        diferencia_ms: mery.ms - patron.ms,
      },
      '=== Comparativa directa (mismo limit=20, mismo rango 24h) Mery vs Patrón ===',
    );
  }

  const completo = resultados.find((r) => r.nombre.startsWith('h)'));
  if (completo) {
    logger.info(
      { ms: completo.ms, ok: completo.ok, clasificacion: completo.clasificacion, filas: completo.filas },
      '=== Prueba directa: query Mery con límite real de producción (5000) ===',
    );
  }

  const fallos = resultados.filter((r) => !r.ok);
  if (fallos.length > 0) {
    const primero = fallos[0]!;
    logger.warn(
      { fallos: fallos.map((f) => f.nombre), primer_fallo: primero.nombre, clasificacion: primero.clasificacion },
      hintForSupabaseError({ code: primero.codigo, message: primero.detalle }),
    );
    process.exit(1);
  }

  logger.info({}, 'Todas las queries de diagnóstico respondieron OK.');
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((err) => {
    logger.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Error inesperado en diagnose-mery-vs-patron-supabase',
    );
    process.exit(1);
  });
}

export { main };
