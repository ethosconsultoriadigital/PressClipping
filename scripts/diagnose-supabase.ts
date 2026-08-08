/**
 * Diagnóstico SEGURO de Supabase — solo booleanos y códigos, nunca secretos.
 *
 * Responde tres preguntas en orden:
 *   1. ¿Están presentes las variables de entorno? (solo true/false, sin valores)
 *   2. ¿Responde PostgREST? (conexión básica)
 *   3. ¿Qué tablas se pueden leer? (probe `limit(0)` por tabla, sin traer filas)
 *
 * Distingue explícitamente entre:
 *   - `missing_table`            → falta la migración (problema de esquema)
 *   - `transient_schema_cache`   → PGRST002, la base está degradada/pausada
 *   - `TIMEOUT`                  → la consulta no respondió (red/PostgREST colgado)
 *
 * Nunca se queda colgado: cada consulta tiene un timeout duro de 10s que aborta
 * el fetch subyacente, y un watchdog global cierra el proceso si algo escapara a
 * ese control. Un diagnóstico que se cuelga es peor que uno que falla.
 *
 * NO imprime SUPABASE_URL, ni la service role key, ni datos de filas.
 * Read-only: no escribe nada.
 *
 * Uso:
 *   npm run diagnose:supabase
 */
import 'dotenv/config';
import { pathToFileURL } from 'node:url';
import { getSupabase } from '../src/supabase/client.js';
import {
  classifySupabaseError,
  describeSupabaseError,
  hintForSupabaseError,
  type SupabaseFailureKind,
} from '../src/supabase/errors.js';
import { logger } from '../src/utils/logger.js';

/** Timeout duro por consulta. Nunca esperamos más que esto por un solo check. */
export const TIMEOUT_POR_CHECK_MS = 10_000;

/** Tablas que los scripts de Mery/shadow necesitan leer. */
const TABLAS_PROBE = [
  'configuracion',
  'medios',
  'noticias',
  'menciones',
  'clientes',
  'keywords',
  'comparativo_pressclipping',
] as const;

/**
 * Presupuesto total como última red de seguridad: 10s por tabla + margen. Si el
 * proceso lo excede, algo ignoró su AbortSignal y salimos por la fuerza.
 */
const WATCHDOG_TOTAL_MS = TIMEOUT_POR_CHECK_MS * (TABLAS_PROBE.length + 1);

const RECOMENDACION_TIMEOUT = 'revisar red/Supabase/schema cache';

interface ProbeResultado {
  tabla: string;
  ok: boolean;
  /** `'timeout'` cuando la consulta no respondió dentro del presupuesto. */
  clasificacion: SupabaseFailureKind | 'timeout' | null;
  codigo: string | null;
  /** Mensaje del error de PostgREST (no contiene credenciales). */
  detalle: string | null;
  ms: number;
}

/** ¿La variable está definida y no vacía? Devuelve SOLO el booleano. */
function presente(nombre: string): boolean {
  return String(process.env[nombre] ?? '').trim().length > 0;
}

export type ResultadoConTimeout<T> =
  | { estado: 'ok'; valor: T; ms: number }
  | { estado: 'timeout'; ms: number };

/**
 * Ejecuta una operación con timeout duro. Le pasa un `AbortSignal` para que el
 * fetch subyacente se cancele de verdad (no basta con dejar de esperar la
 * promesa: sin abortar, el socket sigue abierto y el proceso no termina).
 *
 * Las excepciones NO se atrapan aquí: el llamador decide cómo clasificarlas.
 */
export async function conTimeout<T>(
  paso: string,
  ejecutar: (signal: AbortSignal) => PromiseLike<T>,
  ms: number = TIMEOUT_POR_CHECK_MS,
): Promise<ResultadoConTimeout<T>> {
  const controller = new AbortController();
  const inicio = Date.now();
  let temporizador: NodeJS.Timeout | undefined;

  const expira = new Promise<'timeout'>((resolve) => {
    temporizador = setTimeout(() => resolve('timeout'), ms);
  });

  try {
    const operacion = Promise.resolve(ejecutar(controller.signal));
    const ganador = await Promise.race([operacion, expira]);

    if (ganador === 'timeout') {
      controller.abort();
      // Tras abortar, la operación rechaza con AbortError. Sin este catch sería
      // un unhandled rejection que puede tumbar el proceso con otro código.
      void operacion.catch(() => undefined);
      logger.error(
        { status: 'TIMEOUT', paso, timeout_ms: ms, recomendacion: RECOMENDACION_TIMEOUT },
        `TIMEOUT en "${paso}" tras ${ms} ms — ${RECOMENDACION_TIMEOUT}`,
      );
      return { estado: 'timeout', ms: Date.now() - inicio };
    }

    return { estado: 'ok', valor: ganador as T, ms: Date.now() - inicio };
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Probe de una tabla: valida acceso SIN traer filas y sin contar.
 *
 * `limit(0)` en lugar del `count: 'exact'` anterior por dos razones:
 *   - un count exacto obliga a Postgres a escanear la tabla completa, lo que en
 *     `noticias`/`menciones` puede tardar minutos y parecer un cuelgue;
 *   - `head: true` emitiría un HEAD, cuya respuesta no trae cuerpo, así que
 *     perderíamos el código del error (`PGRST002`) que necesitamos clasificar.
 *
 * Sin reintentos: aquí queremos ver el estado REAL del momento.
 */
export async function probeTabla(tabla: string): Promise<ProbeResultado> {
  const paso = `probe tabla ${tabla}`;
  try {
    const resultado = await conTimeout(paso, (signal) =>
      getSupabase().from(tabla).select('*').limit(0).abortSignal(signal),
    );

    if (resultado.estado === 'timeout') {
      return {
        tabla,
        ok: false,
        clasificacion: 'timeout',
        codigo: null,
        detalle: `Sin respuesta en ${TIMEOUT_POR_CHECK_MS} ms`,
        ms: resultado.ms,
      };
    }

    const { error } = resultado.valor;
    if (!error) {
      return { tabla, ok: true, clasificacion: null, codigo: null, detalle: null, ms: resultado.ms };
    }
    return {
      tabla,
      ok: false,
      clasificacion: classifySupabaseError(error),
      codigo: typeof error.code === 'string' ? error.code : null,
      detalle: describeSupabaseError(error),
      ms: resultado.ms,
    };
  } catch (err) {
    return {
      tabla,
      ok: false,
      clasificacion: classifySupabaseError(err),
      codigo: null,
      detalle: describeSupabaseError(err),
      ms: 0,
    };
  }
}

/** Reporta un timeout en el formato pedido y corta el diagnóstico. */
function abortarPorTimeout(paso: string): never {
  logger.error(
    {
      status: 'TIMEOUT',
      paso,
      recomendacion: RECOMENDACION_TIMEOUT,
      timeout_ms: TIMEOUT_POR_CHECK_MS,
    },
    '=== Diagnóstico abortado por TIMEOUT ===',
  );
  process.exit(1);
}

async function main(): Promise<void> {
  // Watchdog: si algo ignora su AbortSignal, salimos igual. Se limpia al final.
  const watchdog = setTimeout(() => {
    logger.error(
      {
        status: 'TIMEOUT',
        paso: 'diagnostico completo',
        recomendacion: RECOMENDACION_TIMEOUT,
        presupuesto_ms: WATCHDOG_TOTAL_MS,
      },
      '=== Watchdog global: el diagnóstico excedió su presupuesto total ===',
    );
    process.exit(1);
  }, WATCHDOG_TOTAL_MS);

  try {
    logger.info(
      { timeout_por_check_ms: TIMEOUT_POR_CHECK_MS, presupuesto_total_ms: WATCHDOG_TOTAL_MS },
      '=== Diagnóstico Supabase (read-only, sin secretos) ===',
    );

    // ── 1. Variables de entorno (solo presencia) ─────────────────────────────
    const urlPresente = presente('SUPABASE_URL');
    const serviceRolePresente = presente('SUPABASE_SERVICE_ROLE_KEY');

    logger.info(
      {
        'SUPABASE_URL presente': urlPresente,
        'SERVICE_ROLE presente': serviceRolePresente,
      },
      '[1] Variables de entorno',
    );

    if (!urlPresente || !serviceRolePresente) {
      logger.error(
        {},
        'Faltan variables de Supabase en el entorno. Define SUPABASE_URL y ' +
          'SUPABASE_SERVICE_ROLE_KEY en .env (usa .env.example como guía). ' +
          'No se puede continuar el diagnóstico.',
      );
      process.exit(1);
    }

    // ── 2. Conexión básica ───────────────────────────────────────────────────
    logger.info({ timeout_ms: TIMEOUT_POR_CHECK_MS }, '[2] Probando conexión (tabla configuracion)…');
    const base = await probeTabla('configuracion');
    if (base.clasificacion === 'timeout') abortarPorTimeout('conexion basica (tabla configuracion)');

    const conexionOk = base.ok || base.clasificacion === 'missing_table';
    logger.info(
      {
        'conexion basica OK': conexionOk,
        'tabla/config query OK': base.ok,
        clasificacion: base.clasificacion ?? 'ok',
        codigo_postgrest: base.codigo ?? null,
        ms: base.ms,
      },
      '[2] Conexión y lectura de configuracion',
    );

    // ── 3. Probe por tabla ───────────────────────────────────────────────────
    const resultados: ProbeResultado[] = [base];
    for (const tabla of TABLAS_PROBE) {
      if (tabla === 'configuracion') continue;
      const r = await probeTabla(tabla);
      if (r.clasificacion === 'timeout') abortarPorTimeout(`probe tabla ${tabla}`);
      resultados.push(r);
    }

    logger.info({}, '[3] Probe por tabla (limit=0: sin traer filas ni contar)');
    for (const r of resultados) {
      const linea = {
        tabla: r.tabla,
        ok: r.ok,
        clasificacion: r.clasificacion ?? 'ok',
        codigo: r.codigo,
        ms: r.ms,
        detalle: r.detalle,
      };
      if (r.ok) logger.info(linea, `  OK   ${r.tabla}`);
      else logger.error(linea, `  FAIL ${r.tabla}`);
    }

    // ── Veredicto ────────────────────────────────────────────────────────────
    const fallos = resultados.filter((r) => !r.ok);
    const transitorios = fallos.filter(
      (r) => r.clasificacion === 'transient_schema_cache' || r.clasificacion === 'transient_connection',
    );
    const tablasFaltantes = fallos.filter((r) => r.clasificacion === 'missing_table');
    const permisos = fallos.filter((r) => r.clasificacion === 'permission');

    let veredicto: string;
    if (fallos.length === 0) {
      veredicto = 'SUPABASE_OK — todas las tablas responden.';
    } else if (transitorios.length > 0) {
      // Si TODAS las tablas fallan como transitorio, es la base, no el esquema.
      veredicto =
        transitorios.length === resultados.length
          ? 'SUPABASE_DEGRADADO_GENERAL — PostgREST no puede consultar el esquema en NINGUNA tabla. ' +
            'No es una migración faltante: el proyecto está pausado/reiniciando o sin conexiones libres. ' +
            'Reintenta en unos minutos.'
          : 'SUPABASE_DEGRADADO_PARCIAL — hay fallos transitorios intermitentes. Reintenta.';
    } else if (permisos.length > 0) {
      veredicto = 'SUPABASE_PERMISOS — revisa la service role key y las políticas.';
    } else if (tablasFaltantes.length > 0) {
      veredicto = `SUPABASE_ESQUEMA — faltan tablas: ${tablasFaltantes.map((t) => t.tabla).join(', ')}. Aplica migraciones.`;
    } else {
      veredicto = 'SUPABASE_ERROR_OTRO — revisa el detalle de los probes.';
    }

    logger.info(
      {
        tablas_probadas: resultados.length,
        ok: resultados.length - fallos.length,
        fallos: fallos.length,
        transitorios: transitorios.length,
        tablas_faltantes: tablasFaltantes.length,
        veredicto,
      },
      '=== Veredicto ===',
    );

    if (fallos.length > 0) {
      const primero = fallos[0]!;
      logger.warn(
        { tabla: primero.tabla, clasificacion: primero.clasificacion, codigo: primero.codigo },
        hintForSupabaseError({ code: primero.codigo, message: primero.detalle }),
      );
      process.exit(1);
    }
    logger.info({}, 'Supabase operativo. Puedes correr los comandos de captura.');
  } finally {
    clearTimeout(watchdog);
  }
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
      'Error inesperado en diagnose-supabase',
    );
    process.exit(1);
  });
}

export { main, TABLAS_PROBE };
