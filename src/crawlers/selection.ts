/**
 * Selección segura de medios para la ingesta (crawl).
 *
 * Lógica PURA y testeable (sin red ni DB): a partir del catálogo de medios y,
 * opcionalmente, del diagnóstico de `08_Validacion_Medios`, decide qué medios
 * procesar y por qué. La política por defecto es conservadora: excluye medios
 * riesgosos (JS/proxy/duplicados) y, si hay diagnóstico, los marcados como
 * `error`, `sin_fuente` o `especial`.
 *
 * Los estados de diagnóstico siguen el modelo de src/validation/diagnostics.ts:
 *   ok | parcial | sin_fuente | error   (+ es_especial: boolean)
 * Se aceptan sinónimos de entrada en los flags (p.ej. "partial" → "parcial").
 */
import { foldText } from '../matchers/text.js';

/** Diagnóstico de un medio leído de 08_Validacion_Medios. */
export interface DiagnosticoMedio {
  estado_diagnostico: string; // ok | parcial | sin_fuente | error
  es_especial: boolean;
}

/** Subconjunto de campos del medio necesarios para decidir la inclusión. */
export interface MedioSeleccionable {
  medio_id: string;
  nombre_medio: string;
  url_base: string | null;
  metodo_extraccion: string | null;
  rss_url: string | null;
  sitemap_url: string | null;
  secciones_urls: string | null;
  requiere_javascript: boolean;
  requiere_proxy: boolean;
  prioridad: string | null;
  estado: string | null; // estado geográfico (p.ej. Jalisco)
  region: string | null;
  ultimo_estado: string | null;
  activo: boolean;
}

export interface CrawlFiltros {
  priority?: string;
  estado?: string;
  onlyStatus?: string[];
  excludeStatus?: string[];
  soloValidados?: boolean;
}

export interface Decision {
  medio: MedioSeleccionable;
  incluir: boolean;
  motivo: string;
  diagnostico: DiagnosticoMedio | null;
}

/** Estados que, por defecto, se consideran NO utilizables. */
export const DEFAULT_EXCLUDE_STATUS = ['error', 'sin_fuente', 'especial'] as const;

/** Estados considerados utilizables para `--solo-validados`. */
export const VALIDADOS_STATUS = ['ok', 'parcial'] as const;

/** Normaliza un estado de diagnóstico o token de flag a la forma canónica. */
export function normalizarEstado(s: string): string {
  const v = foldText(s).trim();
  if (v === 'partial') return 'parcial';
  if (v === 'sin fuente' || v === 'sin-fuente') return 'sin_fuente';
  return v.replace(/\s+/g, '_');
}

function norm(s: string | null | undefined): string {
  return foldText(s ?? '').trim();
}

/** ¿El medio pertenece al estado/region buscado? (comparación tolerante). */
function coincideEstado(medio: MedioSeleccionable, buscado: string): boolean {
  const b = norm(buscado);
  return norm(medio.estado) === b || norm(medio.region) === b;
}

/**
 * Evalúa un medio contra los filtros y su diagnóstico. Devuelve la decisión
 * con el motivo (legible) de inclusión o exclusión.
 */
export function evaluarMedio(
  medio: MedioSeleccionable,
  diagnostico: DiagnosticoMedio | null,
  filtros: CrawlFiltros,
): Decision {
  const decide = (incluir: boolean, motivo: string): Decision => ({
    medio,
    incluir,
    motivo,
    diagnostico,
  });

  // --- Filtros duros de seguridad (siempre aplican) ----------------------
  if (!medio.activo) return decide(false, 'inactivo');
  if (medio.requiere_javascript) return decide(false, 'requiere_javascript');
  if (medio.requiere_proxy) return decide(false, 'requiere_proxy');
  if (norm(medio.ultimo_estado) === 'duplicado') {
    return decide(false, 'ultimo_estado=Duplicado');
  }

  // --- Filtros explícitos por atributo -----------------------------------
  if (filtros.priority && norm(medio.prioridad) !== norm(filtros.priority)) {
    return decide(false, `prioridad!=${filtros.priority}`);
  }
  if (filtros.estado && !coincideEstado(medio, filtros.estado)) {
    return decide(false, `estado!=${filtros.estado}`);
  }

  const estado = diagnostico ? normalizarEstado(diagnostico.estado_diagnostico) : null;
  const especial = diagnostico?.es_especial ?? false;

  // --- Solo medios validados (ok/parcial, no especiales) -----------------
  if (filtros.soloValidados) {
    if (!diagnostico) return decide(false, 'sin diagnóstico en 08_Validacion_Medios');
    if (especial) return decide(false, 'especial');
    if (!(VALIDADOS_STATUS as readonly string[]).includes(estado ?? '')) {
      return decide(false, `estado_diagnostico=${estado}`);
    }
    return decide(true, `validado (${estado})`);
  }

  // --- Selección explícita por estado ------------------------------------
  if (filtros.onlyStatus && filtros.onlyStatus.length > 0) {
    if (!diagnostico) return decide(false, 'sin diagnóstico en 08_Validacion_Medios');
    const wanted = filtros.onlyStatus.map(normalizarEstado);
    const matchEstado = estado !== null && wanted.includes(estado);
    const matchEspecial = especial && wanted.includes('especial');
    if (matchEstado || matchEspecial) {
      return decide(true, `only-status (${matchEspecial ? 'especial' : estado})`);
    }
    return decide(false, `estado_diagnostico=${especial ? 'especial' : estado}`);
  }

  // --- Política por defecto (o exclusión explícita) ----------------------
  const excl = (
    filtros.excludeStatus && filtros.excludeStatus.length > 0
      ? filtros.excludeStatus
      : [...DEFAULT_EXCLUDE_STATUS]
  ).map(normalizarEstado);

  if (diagnostico) {
    if (especial && excl.includes('especial')) return decide(false, 'especial');
    if (estado !== null && excl.includes(estado)) {
      return decide(false, `estado_diagnostico=${estado}`);
    }
    return decide(true, `diagnóstico ${estado}${especial ? ' (especial)' : ''}`);
  }

  return decide(true, 'sin diagnóstico (incluido por default)');
}

/** Aplica `evaluarMedio` a la lista completa, separando incluidos de excluidos. */
export function seleccionarMedios(
  medios: MedioSeleccionable[],
  diagnosticos: Map<string, DiagnosticoMedio>,
  filtros: CrawlFiltros,
): { incluidos: Decision[]; excluidos: Decision[] } {
  const incluidos: Decision[] = [];
  const excluidos: Decision[] = [];
  for (const m of medios) {
    const d = evaluarMedio(m, diagnosticos.get(m.medio_id) ?? null, filtros);
    (d.incluir ? incluidos : excluidos).push(d);
  }
  return { incluidos, excluidos };
}
