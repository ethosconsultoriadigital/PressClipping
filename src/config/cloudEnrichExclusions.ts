/**
 * Medios cuyo ARTICLE ENRICH está bloqueado cuando el pipeline corre en la
 * nube (GitHub Actions). La CAPTURA sigue activa: se siguen descubriendo sus
 * notas por RSS/sitemap, solo no se intenta descargar el artículo desde un
 * entorno que el origen rechaza.
 *
 * Esto NO es un bypass anti-bot: no hay proxy, ni rotación de red, ni
 * user-agent falso, ni texto inventado. Es dejar de gastar intentos (y de
 * ensuciar el diagnóstico) en una combinación medio+entorno que ya está
 * probada como bloqueada.
 *
 * Criterio para entrar a esta lista: hay que DEMOSTRAR la diferencia
 * local/cloud. No basta con ver 403 en Actions.
 */
export interface CloudEnrichExclusion {
  medio_id: string;
  nombre: string;
  /** Estado aprobado del medio. */
  estado: 'C_CAPTURE_ONLY_CLOUD_ENRICH_BLOCKED';
  evidencia: string;
}

export const CLOUD_ENRICH_BLOCKED: readonly CloudEnrichExclusion[] = [
  {
    medio_id: 'MED-0029',
    nombre: 'La Jornada',
    estado: 'C_CAPTURE_ONLY_CLOUD_ENRICH_BLOCKED',
    evidencia:
      'Run 35370007814 (GitHub Actions): captura RSS sana (30 notas nuevas) y ' +
      '30/30 article enrich con HTTP 403. Las MISMAS URLs, con el mismo ' +
      'user-agent, responden 200 y extraen texto desde local/BVR. La ' +
      'diferencia es el entorno de red, no la fuente ni el extractor.',
  },
] as const;

// MED-0196 NO entra aquí: también dio 30 HTTP 403 en Actions, pero todavía no
// se reprodujo la misma URL desde local, así que no está demostrado que sea un
// bloqueo de entorno. Deuda abierta: MED0196_RCA_REQUIRED. Cuando el drain V1
// esté activo, su metadata persistente ya evita que vuelva a gastar intentos
// dentro del mismo run.

export type EnvMap = Record<string, string | undefined>;

/**
 * ¿Estamos en el entorno cloud? `GITHUB_ACTIONS` lo pone Actions; el override
 * explícito permite forzarlo en un canary o probarlo sin simular Actions.
 */
export function esEntornoCloud(env: EnvMap = process.env): boolean {
  if (env['GITHUB_ACTIONS'] === 'true') return true;
  const override = env['ENRICH_CLOUD_TIER'];
  return override != null && ['1', 'true', 'yes', 'on'].includes(override.trim().toLowerCase());
}

/** IDs con article enrich bloqueado en ESTE entorno. Vacío fuera de cloud. */
export function mediosConEnrichBloqueado(env: EnvMap = process.env): string[] {
  return esEntornoCloud(env) ? CLOUD_ENRICH_BLOCKED.map((m) => m.medio_id) : [];
}

/** ¿Este medio tiene el article enrich bloqueado en ESTE entorno? */
export function articleEnrichBloqueado(
  medioId: string | null | undefined,
  env: EnvMap = process.env,
): boolean {
  if (!medioId) return false;
  return mediosConEnrichBloqueado(env).includes(medioId);
}

export interface ParticionEnrich {
  /** Medios a los que SÍ se les intenta article enrich. */
  permitidos: string[];
  /** Medios excluidos del enrich en este entorno (su captura sigue activa). */
  excluidos: string[];
}

/**
 * Parte la lista de medios del tier en permitidos/excluidos PARA ENRICH. La
 * lista de captura no se toca: el llamador sigue usando la original.
 */
export function particionarMediosParaEnrich(
  medioIds: readonly string[],
  env: EnvMap = process.env,
): ParticionEnrich {
  const bloqueados = new Set(mediosConEnrichBloqueado(env));
  const permitidos: string[] = [];
  const excluidos: string[] = [];
  for (const id of medioIds) (bloqueados.has(id) ? excluidos : permitidos).push(id);
  return { permitidos, excluidos };
}
