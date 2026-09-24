/**
 * Ventana editorial opt-in del export LIVE.
 *
 * effective_publication_time =
 *   fecha_publicacion si existe
 *   else fecha_captura
 *
 * Una nota vieja capturada hoy queda fuera cuando fecha_publicacion existe.
 * PostgREST no ofrece un COALESCE fiable entre las dos columnas, así que el
 * repositorio parte la lectura en dos consultas mutuamente excluyentes.
 */

export type ClausulaEditorial =
  | { columna: 'noticias.fecha_publicacion'; op: 'gte'; valor: string }
  | { columna: 'noticias.fecha_publicacion'; op: 'is'; valor: null }
  | { columna: 'noticias.fecha_captura'; op: 'gte'; valor: string };

/** Dos consultas: publicación válida en ventana, o publicación NULL y captura en ventana. */
export function consultasVentanaEditorial(cutoffIso: string): ClausulaEditorial[][] {
  return [
    [{ columna: 'noticias.fecha_publicacion', op: 'gte', valor: cutoffIso }],
    [
      { columna: 'noticias.fecha_publicacion', op: 'is', valor: null },
      { columna: 'noticias.fecha_captura', op: 'gte', valor: cutoffIso },
    ],
  ];
}

function textoFecha(valor: string | null | undefined): string | null {
  if (typeof valor !== 'string') return null;
  const limpio = valor.trim();
  return limpio.length > 0 ? limpio : null;
}

/**
 * Instante editorial. Si hay fecha_publicacion, no se sustituye por fecha_captura.
 */
export function instanteEfectivoPublicacion(
  fechaPublicacion: string | null | undefined,
  fechaCaptura: string | null | undefined,
): string | null {
  return textoFecha(fechaPublicacion) ?? textoFecha(fechaCaptura);
}

/** Inclusivo en el corte. Fecha inválida o ausente queda fuera. */
export function noticiaEnVentanaEditorial(
  fechaPublicacion: string | null | undefined,
  fechaCaptura: string | null | undefined,
  cutoffIso: string,
): boolean {
  const efectivo = instanteEfectivoPublicacion(fechaPublicacion, fechaCaptura);
  if (!efectivo) return false;
  const instante = Date.parse(efectivo);
  const corte = Date.parse(cutoffIso);
  if (Number.isNaN(instante) || Number.isNaN(corte)) return false;
  return instante >= corte;
}

export function fusionarMencionesExport<T extends { mencion_id: string; created_at?: string | null }>(
  partes: T[][],
  opts: { limit: number; recentFirst: boolean },
): T[] {
  const vistas = new Set<string>();
  const todas: T[] = [];
  for (const parte of partes) {
    for (const fila of parte) {
      if (!fila.mencion_id || vistas.has(fila.mencion_id)) continue;
      vistas.add(fila.mencion_id);
      todas.push(fila);
    }
  }
  todas.sort((a, b) => {
    const izq = a.created_at ?? '';
    const der = b.created_at ?? '';
    const cmp = izq < der ? -1 : izq > der ? 1 : 0;
    return opts.recentFirst ? -cmp : cmp;
  });
  return todas.slice(0, opts.limit);
}
