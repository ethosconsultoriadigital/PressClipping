/**
 * Promoción de notas diagnósticas a cobertura orgánica.
 *
 * Una nota guardada con `origen_cobertura = pressclipping_diagnostico` (traída
 * desde una URL del PressClipping solo para diagnóstico) ocupa el `hash_url` de
 * esa URL. Cuando el crawler ORGÁNICO del medio vuelve a descubrir esa misma URL
 * por RSS/SITEMAP/SECCION/BUSCADOR, eso constituye descubrimiento orgánico
 * comprobado: la nota deja de ser "solo diagnóstico" y se promueve a
 * `ethos_organico`, quedando lista para detección de menciones.
 *
 * Lógica PURA y testeable (sin red ni DB): a partir de los items entrantes del
 * crawler y de las filas ya existentes, decide qué insertar, qué promover y qué
 * tratar como duplicado normal.
 *
 * Reglas (ver brief):
 *  - Solo se promueve si el estado existente es EXACTAMENTE
 *    `pressclipping_diagnostico`. Cualquier otro origen (`ethos_organico`,
 *    `manual`, etc.) se trata como duplicado normal y NO se toca.
 *  - Solo se promueve si la fuente del item entrante es ORGÁNICA
 *    (rss | sitemap | seccion | buscador). `import-pressclipping` y
 *    `diagnose-url` no pasan por aquí (hacen su propio insert), por lo que su
 *    re-descubrimiento queda excluido por construcción.
 */
import type { NoticiaInsert } from '../normalizers/noticia.js';

/** Estado de cobertura que sí puede promoverse. */
export const ORIGEN_PROMOVIBLE = 'pressclipping_diagnostico';

/** Fuentes que cuentan como descubrimiento orgánico del crawler. */
export const FUENTES_ORGANICAS = new Set(['rss', 'sitemap', 'seccion', 'buscador']);

/** ¿La fuente de extracción es un descubrimiento orgánico del crawler? */
export function esFuenteOrganica(fuente: string | null | undefined): boolean {
  if (!fuente) return false;
  return FUENTES_ORGANICAS.has(fuente.trim().toLowerCase());
}

/** Subconjunto de una fila `noticias` ya existente, necesario para decidir. */
export interface ExistenteNoticia {
  hash_url: string;
  origen_cobertura: string | null;
  medio_id: string | null;
  /** Para rellenar metadata faltante de la nota diagnóstica al promover. */
  fecha_publicacion?: string | null;
  titulo?: string | null;
}

/** Campos a rellenar SOLO si estaban vacíos en la nota diagnóstica. */
export interface PromocionBackfill {
  fecha_publicacion?: string | null;
  titulo?: string | null;
}

/** Instrucción de actualización para promover una nota diagnóstica. */
export interface PromocionUpdate {
  hash_url: string;
  /** Medio orgánico actual (el del crawler que la redescubrió). */
  medio_id: string;
  /** Fuente orgánica que la redescubrió. */
  fuente_extraccion: string;
  /** Metadata orgánica para rellenar lo que la nota diagnóstica no tenía. */
  backfill: PromocionBackfill;
}

/** Payload de columnas a actualizar al promover (sin updated_at/notas). */
export interface PromocionPayload {
  origen_cobertura: 'ethos_organico';
  medio_id: string;
  fuente_extraccion: string;
  /** Se reactiva la detección de menciones sobre la nota promovida. */
  menciones_procesado: false;
  fecha_publicacion?: string | null;
  titulo?: string | null;
}

/**
 * Calcula qué metadata rellenar al promover: solo campos vacíos en la nota
 * diagnóstica que el item orgánico sí trae. Nunca pisa datos ya presentes.
 */
function calcularBackfill(item: NoticiaInsert, ex: ExistenteNoticia): PromocionBackfill {
  const b: PromocionBackfill = {};
  if (!ex.fecha_publicacion && item.fecha_publicacion) b.fecha_publicacion = item.fecha_publicacion;
  if (!ex.titulo && item.titulo) b.titulo = item.titulo;
  return b;
}

/** Construye el payload de actualización para una promoción (lógica pura). */
export function construirUpdatePromocion(p: PromocionUpdate): PromocionPayload {
  return {
    origen_cobertura: 'ethos_organico',
    medio_id: p.medio_id,
    fuente_extraccion: p.fuente_extraccion,
    menciones_procesado: false,
    ...p.backfill,
  };
}

export interface ClasificacionIngesta {
  /** Items que no existían: se insertan. */
  nuevas: NoticiaInsert[];
  /** Notas diagnósticas redescubiertas orgánicamente: se promueven. */
  promociones: PromocionUpdate[];
  /** Items que ya existían y no son promovibles: se omiten. */
  duplicados: number;
}

/**
 * Clasifica los items únicos del lote contra las filas existentes en DB.
 *
 * @param unicos items ya deduplicados dentro del lote (por hash_url).
 * @param existentes mapa hash_url -> fila existente (solo las que ya están en DB).
 */
export function clasificarIngesta(
  unicos: NoticiaInsert[],
  existentes: ReadonlyMap<string, ExistenteNoticia>,
): ClasificacionIngesta {
  const nuevas: NoticiaInsert[] = [];
  const promociones: PromocionUpdate[] = [];
  let duplicados = 0;

  for (const it of unicos) {
    const ex = existentes.get(it.hash_url);
    if (!ex) {
      nuevas.push(it);
      continue;
    }
    if (
      ex.origen_cobertura === ORIGEN_PROMOVIBLE &&
      esFuenteOrganica(it.fuente_extraccion)
    ) {
      promociones.push({
        hash_url: it.hash_url,
        medio_id: it.medio_id,
        fuente_extraccion: it.fuente_extraccion,
        backfill: calcularBackfill(it, ex),
      });
    } else {
      duplicados += 1;
    }
  }

  return { nuevas, promociones, duplicados };
}
