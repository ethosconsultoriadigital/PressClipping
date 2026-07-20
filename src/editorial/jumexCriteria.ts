/**
 * Criterio editorial de staging para Jumex (CLI-0001) — lote NATIONAL MEDIA
 * COVERAGE RAMP (2026-07-20).
 *
 * Clasifica cada mención ya detectada (por keyword_id/keyword real, ya
 * gateada por contexto en `keywords`) en una de 4 categorías, para decidir
 * qué puede eventualmente ir a producción y qué debe quedarse en observación.
 * Módulo PURO: no toca Supabase ni Sheets, no escribe nada.
 *
 * Regla de producto (propuesta, no auto-aplicada a ninguna hoja):
 *   MARCA_DIRECTA          → candidata a producción Jumex.
 *   SECTOR_REGULATORIO_ALTO → revisión humana / sección sectorial, NUNCA mezclada como marca.
 *   SECTOR_GENERAL         → solo observación/staging.
 *   EXCLUIR                → nunca sale de staging.
 */

export type CategoriaJumex =
  | 'MARCA_DIRECTA'
  | 'SECTOR_REGULATORIO_ALTO'
  | 'SECTOR_GENERAL'
  | 'EXCLUIR';

/**
 * Mapa por keyword_id: cada keyword de CLI-0001 ya está gateada por su propio
 * contexto en la tabla `keywords` (ver docs/JUMEX_STAGING_READINESS.md §1) —
 * este mapeo solo decide en qué categoría cae el resultado YA gateado, no
 * vuelve a evaluar el texto.
 */
const CATEGORIA_POR_KEYWORD_ID: Record<string, CategoriaJumex> = {
  'KEY-0001': 'MARCA_DIRECTA', // Jumex / Grupo Jumex / Jugos Jumex
  'KEY-0002': 'EXCLUIR', // Museo Jumex / Fundación Jumex
  'KEY-0009': 'SECTOR_GENERAL', // bebidas azucaradas (genérico, sin marca)
  'KEY-0065': 'SECTOR_REGULATORIO_ALTO', // IEPS bebidas azucaradas
  'KEY-0066': 'SECTOR_REGULATORIO_ALTO', // etiquetado frontal
  'KEY-0067': 'SECTOR_REGULATORIO_ALTO', // retiro de producto
  'KEY-0068': 'SECTOR_REGULATORIO_ALTO', // Profeco (ya excluye gasolina en su contexto_excluir)
};

/** Clasifica por keyword_id (fuente de verdad — evita reinterpretar texto libre). */
export function clasificarCategoriaJumexPorId(keywordId: string): CategoriaJumex {
  return CATEGORIA_POR_KEYWORD_ID[keywordId] ?? 'SECTOR_GENERAL';
}

/**
 * Fallback por nombre de keyword cuando no se tiene el keyword_id a mano
 * (p.ej. reportes que solo traen el texto del keyword). Replica el mismo
 * mapeo por nombre exacto conocido.
 */
const CATEGORIA_POR_NOMBRE: { nombre: string; categoria: CategoriaJumex }[] = [
  { nombre: 'museo jumex', categoria: 'EXCLUIR' },
  { nombre: 'fundacion jumex', categoria: 'EXCLUIR' },
  { nombre: 'fundación jumex', categoria: 'EXCLUIR' },
  { nombre: 'jumex', categoria: 'MARCA_DIRECTA' },
  { nombre: 'grupo jumex', categoria: 'MARCA_DIRECTA' },
  { nombre: 'jugos jumex', categoria: 'MARCA_DIRECTA' },
  { nombre: 'ieps bebidas azucaradas', categoria: 'SECTOR_REGULATORIO_ALTO' },
  { nombre: 'etiquetado frontal', categoria: 'SECTOR_REGULATORIO_ALTO' },
  { nombre: 'retiro de producto', categoria: 'SECTOR_REGULATORIO_ALTO' },
  { nombre: 'profeco', categoria: 'SECTOR_REGULATORIO_ALTO' },
  { nombre: 'bebidas azucaradas', categoria: 'SECTOR_GENERAL' },
];

export function clasificarCategoriaJumexPorNombre(keywordNombre: string): CategoriaJumex {
  const f = keywordNombre.trim().toLowerCase();
  const hit = CATEGORIA_POR_NOMBRE.find((c) => f === c.nombre || f.includes(c.nombre));
  return hit?.categoria ?? 'SECTOR_GENERAL';
}

export interface ResumenCategoriasJumex {
  total: number;
  marca_directa: number;
  sector_regulatorio_alto: number;
  sector_general: number;
  excluir: number;
}

export function resumirCategoriasJumex(categorias: CategoriaJumex[]): ResumenCategoriasJumex {
  const r: ResumenCategoriasJumex = { total: categorias.length, marca_directa: 0, sector_regulatorio_alto: 0, sector_general: 0, excluir: 0 };
  for (const c of categorias) {
    if (c === 'MARCA_DIRECTA') r.marca_directa += 1;
    else if (c === 'SECTOR_REGULATORIO_ALTO') r.sector_regulatorio_alto += 1;
    else if (c === 'SECTOR_GENERAL') r.sector_general += 1;
    else r.excluir += 1;
  }
  return r;
}

/**
 * Regla de producto: NO avanzar a hoja final si MARCA_DIRECTA sigue en 0 (o
 * casi 0) salvo autorización editorial expresa. Devuelve el veredicto puro;
 * no bloquea nada por sí mismo (ningún script escribe hoja final Jumex hoy).
 */
export function evaluarGoNoGoJumex(resumen: ResumenCategoriasJumex): { go: boolean; motivo: string } {
  if (resumen.marca_directa === 0) {
    return { go: false, motivo: 'NO-GO: 0 menciones MARCA_DIRECTA — sin cobertura de marca real' };
  }
  if (resumen.marca_directa < 3) {
    return { go: false, motivo: `NO-GO: solo ${resumen.marca_directa} mención(es) MARCA_DIRECTA — insuficiente para producción estable, requiere autorización editorial expresa` };
  }
  return { go: true, motivo: `GO condicionado: ${resumen.marca_directa} menciones MARCA_DIRECTA reales` };
}
