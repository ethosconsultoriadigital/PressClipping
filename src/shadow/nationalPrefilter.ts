/**
 * Prefiltro determinístico de título/sección para el TIER NACIONAL sombra.
 *
 * Objetivo: en medios generalistas de alto volumen (p. ej. Publimetro, ~46%
 * deportes/espectáculos), saltar notas claramente irrelevantes para PR ANTES de
 * enrich/detect, reduciendo carga y ruido. SIEMPRE conserva notas con señal de
 * alto valor (laboral, crisis de producto, marcas) aunque el título parezca
 * deportivo/espectáculos.
 *
 * Módulo PURO: sin DB, red ni Sheets. No borra ni modifica nada por sí mismo.
 * El llamador decide qué hacer con la decisión (p. ej. no enriquecer la nota).
 */
import { foldText } from '../matchers/text.js';

/** Términos de SALTO: secciones/temas irrelevantes para cobertura PR. */
export const PREFILTRO_SALTAR: readonly string[] = [
  'mundial', 'futbol', 'fútbol', 'deporte', 'deportes', 'liga mx', 'partido',
  'en vivo', 'horoscopo', 'horóscopo', 'cartelera', 'espectaculo', 'espectáculo',
  'espectaculos', 'espectáculos', 'entretenimiento', 'viral', 'virales',
  'famosos', 'celebridad', 'celebridades',
] as const;

/**
 * Términos de ALTO VALOR: si el título los contiene, NUNCA se salta (override).
 * Cubre el paquete laboral promovido, crisis de producto y marcas clave.
 */
export const PREFILTRO_ALTO_VALOR: readonly string[] = [
  'huelga', 'sindicato', 'contrato colectivo', 'trabajadores', 'derechos laborales',
  'salario minimo', 'salario mínimo', 'reforma laboral', 'tequila adulterado',
  'bebidas adulteradas', 'alcohol adulterado', 'jumex', 'bacardi', 'bacardí',
  'ieps', 'bebidas azucaradas',
] as const;

export interface PrefiltroDecision {
  saltar: boolean;
  motivo: string;
}

/**
 * Decide si una nota debe saltarse por el prefiltro de título/sección.
 * Prioridad: ALTO_VALOR (procesar siempre) > SALTAR (saltar) > procesar.
 */
export function decidirPrefiltro(titulo?: string | null, seccion?: string | null): PrefiltroDecision {
  const texto = foldText(`${titulo ?? ''} ${seccion ?? ''}`);

  for (const hv of PREFILTRO_ALTO_VALOR) {
    if (texto.includes(foldText(hv))) {
      return { saltar: false, motivo: `alto_valor:${hv}` };
    }
  }
  for (const sk of PREFILTRO_SALTAR) {
    if (texto.includes(foldText(sk))) {
      return { saltar: true, motivo: `saltar:${sk}` };
    }
  }
  return { saltar: false, motivo: 'sin_coincidencia' };
}
