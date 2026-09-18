/**
 * Invariante cron → catálogo: todo `medio_id` configurado en un cron sombra
 * DEBE existir como fila de la tabla `medios`.
 *
 * Motivación (incidente run 35370007814): `MED-0204` vivía en
 * `SHADOW_MEDIOS_DAILY_VALIDATED` pero nunca se insertó en `medios`. El tier
 * pedía 48 IDs, resolvía 47 y seguía adelante con un log informativo
 * ("encontrados 47 de 196"), así que la configuración huérfana era invisible.
 *
 * Dos reglas de diseño que este módulo respeta a propósito:
 *
 *   1. EXISTENCIA y ESTADO ACTIVO son chequeos SEPARADOS. Un medio con
 *      `activo=false` existe en catálogo: NO es huérfano. Por eso la búsqueda
 *      NO puede hacerse con `getMediosActivos()`.
 *   2. Un fallo de base NO es un catálogo vacío. Si la lectura falla el
 *      resultado es `INFRA_ERROR`, nunca "todos huérfanos".
 *
 * El núcleo (`evaluarIntegridadCronCatalogo`) es PURO: recibe la configuración
 * y un snapshot del catálogo. La variante async solo envuelve un loader
 * inyectado, de modo que el módulo se puede testear sin DB ni red.
 */
import {
  SHADOW_MEDIOS,
  SHADOW_MEDIOS_NACIONALES_B,
  SHADOW_MEDIOS_CRISIS,
  mediosDailyValidatedActivos,
} from './shadowMedia.js';

/** Tiers de cron sombra cubiertos por la invariante. */
export type CronTierId = 'base' | 'nacional_b' | 'crisis' | 'daily_validated';

export const CRON_TIERS: readonly CronTierId[] = [
  'base',
  'nacional_b',
  'crisis',
  'daily_validated',
] as const;

/** Entrada de configuración de cron (un medio en un tier). */
export interface CronConfiguredMedio {
  medio_id: string;
  tier: CronTierId;
  nombre: string | null;
}

/**
 * Fila mínima de catálogo necesaria para la invariante. `activo` se lee solo
 * para reportarlo por separado: NUNCA filtra la existencia.
 */
export interface CatalogMedioRef {
  medio_id: string;
  activo: boolean | null;
}

export type CronCatalogIntegrityStatus = 'OK' | 'ORPHANS_FOUND' | 'INFRA_ERROR';

export interface CronCatalogIntegrityReport {
  status: CronCatalogIntegrityStatus;
  /** IDs únicos configurados en los tiers evaluados. */
  configured_count: number;
  /** Entradas de configuración leídas (incluye duplicados entre tiers). */
  configured_entries: number;
  /** IDs configurados más de una vez (no es error: se deduplican). */
  duplicate_configured_ids: string[];
  /** IDs únicos presentes en el snapshot de catálogo. `null` si hubo INFRA_ERROR. */
  catalog_count: number | null;
  orphan_count: number;
  orphan_ids: string[];
  /** Huérfanos con el tier donde están configurados (para el mensaje de fallo). */
  orphans: CronConfiguredMedio[];
  /** Existen en catálogo pero con `activo=false`. Informativo, NO huérfanos. */
  inactive_ids: string[];
  error: string | null;
}

/** Snapshot del catálogo: éxito con filas, o fallo de infraestructura. */
export type CatalogSnapshot =
  | { ok: true; medios: readonly CatalogMedioRef[] }
  | { ok: false; error: string };

/**
 * IDs configurados en los tiers pedidos (por defecto, todos). Para el tier
 * daily-validated se usan solo los `activo_shadow`, que son los que el runner
 * realmente crawlea.
 */
export function cronConfiguredMedios(
  tiers: readonly CronTierId[] = CRON_TIERS,
): CronConfiguredMedio[] {
  const seleccion = new Set(tiers);
  const out: CronConfiguredMedio[] = [];
  if (seleccion.has('base')) {
    for (const id of SHADOW_MEDIOS) out.push({ medio_id: id, tier: 'base', nombre: null });
  }
  if (seleccion.has('nacional_b')) {
    for (const m of SHADOW_MEDIOS_NACIONALES_B) {
      if (m.activo_shadow) out.push({ medio_id: m.medio_id, tier: 'nacional_b', nombre: m.nombre });
    }
  }
  if (seleccion.has('crisis')) {
    for (const m of SHADOW_MEDIOS_CRISIS) {
      if (m.activo_shadow) out.push({ medio_id: m.medio_id, tier: 'crisis', nombre: m.nombre });
    }
  }
  if (seleccion.has('daily_validated')) {
    for (const m of mediosDailyValidatedActivos()) {
      out.push({ medio_id: m.medio_id, tier: 'daily_validated', nombre: m.nombre });
    }
  }
  return out;
}

/**
 * Evalúa la invariante. PURO: sin DB, sin red, sin reloj.
 *
 * `configured` puede traer el mismo `medio_id` en varios tiers: se deduplica
 * para contar y para decidir huérfanos, y los repetidos se reportan aparte.
 */
export function evaluarIntegridadCronCatalogo(
  configured: readonly CronConfiguredMedio[],
  snapshot: CatalogSnapshot,
): CronCatalogIntegrityReport {
  const vistos = new Set<string>();
  const duplicados = new Set<string>();
  const primeraAparicion: CronConfiguredMedio[] = [];
  for (const entry of configured) {
    if (vistos.has(entry.medio_id)) {
      duplicados.add(entry.medio_id);
      continue;
    }
    vistos.add(entry.medio_id);
    primeraAparicion.push(entry);
  }

  const base = {
    configured_count: vistos.size,
    configured_entries: configured.length,
    duplicate_configured_ids: [...duplicados].sort(),
  };

  if (!snapshot.ok) {
    // Fallo de lectura: NO se puede afirmar nada sobre huérfanos.
    return {
      ...base,
      status: 'INFRA_ERROR',
      catalog_count: null,
      orphan_count: 0,
      orphan_ids: [],
      orphans: [],
      inactive_ids: [],
      error: snapshot.error,
    };
  }

  const catalogo = new Map<string, CatalogMedioRef>();
  for (const fila of snapshot.medios) catalogo.set(fila.medio_id, fila);

  const orphans = primeraAparicion.filter((e) => !catalogo.has(e.medio_id));
  const inactive = primeraAparicion
    .filter((e) => catalogo.get(e.medio_id)?.activo === false)
    .map((e) => e.medio_id)
    .sort();

  return {
    ...base,
    status: orphans.length > 0 ? 'ORPHANS_FOUND' : 'OK',
    catalog_count: catalogo.size,
    orphan_count: orphans.length,
    orphan_ids: orphans.map((e) => e.medio_id).sort(),
    orphans,
    inactive_ids: inactive,
    error: null,
  };
}

/** Loader de catálogo inyectable: devuelve filas o LANZA ante fallo de DB. */
export type CatalogLoader = (
  medioIds: readonly string[],
) => Promise<readonly CatalogMedioRef[]>;

export interface VerificarIntegridadOpts {
  cargarCatalogo: CatalogLoader;
  /** Por defecto, todos los tiers de cron. */
  tiers?: readonly CronTierId[];
  /** Permite inyectar la configuración (tests, auditorías puntuales). */
  configured?: readonly CronConfiguredMedio[];
}

/**
 * Variante async: resuelve el snapshot con el loader inyectado y evalúa. Un
 * throw del loader se traduce a `INFRA_ERROR` (nunca a catálogo vacío).
 */
export async function verificarIntegridadCronCatalogo(
  opts: VerificarIntegridadOpts,
): Promise<CronCatalogIntegrityReport> {
  const configured = opts.configured ?? cronConfiguredMedios(opts.tiers);
  const ids = [...new Set(configured.map((c) => c.medio_id))];
  let snapshot: CatalogSnapshot;
  try {
    const medios = await opts.cargarCatalogo(ids);
    snapshot = { ok: true, medios };
  } catch (err) {
    snapshot = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return evaluarIntegridadCronCatalogo(configured, snapshot);
}

/** Mensaje de una línea, apto para log estructurado o error de preflight. */
export function describirIntegridadCronCatalogo(report: CronCatalogIntegrityReport): string {
  if (report.status === 'INFRA_ERROR') {
    return `Integridad cron→catálogo NO verificable (INFRA_ERROR): ${report.error ?? 'error desconocido'}`;
  }
  if (report.status === 'ORPHANS_FOUND') {
    const detalle = report.orphans.map((o) => `${o.medio_id}[${o.tier}]`).join(', ');
    return (
      `Integridad cron→catálogo FALLA: ${report.orphan_count} medio(s) configurados sin fila en ` +
      `\`medios\` (${detalle}). Configurados=${report.configured_count}, catálogo=${report.catalog_count}.`
    );
  }
  return (
    `Integridad cron→catálogo OK: ${report.configured_count} configurados, ` +
    `${report.catalog_count} en catálogo, 0 huérfanos.`
  );
}
