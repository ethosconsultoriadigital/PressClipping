/**
 * Lógica PURA de readiness de sustitución de PressClipping por Ethos.
 *
 * Sin red, sin IA, sin efectos: reglas determinísticas para (a) excluir el
 * cliente de PRUEBA de las métricas ejecutivas y (b) derivar un estado de
 * readiness por cliente a partir de scores ya calculados. Testeable.
 */

export type EstadoReadiness =
  | 'LISTO_PARA_PILOTO_INTERNO'
  | 'SHADOW_ESTABLE_NO_REAL'
  | 'NECESITA_MAS_COBERTURA'
  | 'NO_LISTO'
  | 'SOLO_TEST';

/** Cliente de PRUEBA: se EXCLUYE de readiness ejecutivo (nunca se borra). */
export function esClientePrueba(clienteId?: string | null, cliente?: string | null): boolean {
  const id = String(clienteId ?? '').trim().toUpperCase();
  const nombre = String(cliente ?? '').trim().toLowerCase();
  if (id === 'CLI-PRUEBA') return true;
  return /\b(prueba|test|demo|sandbox)\b/.test(nombre);
}

export interface ScoresCliente {
  /** % de cobertura de Ethos vs PressClipping (0-100). */
  cobertura_vs_pc: number;
  /** % de gap real accionable estimado sobre SOLO_PRESSCLIPPING (0-100). */
  gap_real_estimado: number;
  /** precisión estimada de Ethos (0-100). */
  precision_estimada: number;
  /** score de calidad de extracción (0-100). */
  extraccion_score: number;
  /** score de alertas (madurez de trazabilidad/dedupe) (0-100). */
  alertas_score: number;
  /** ¿es el cliente de prueba? (fuerza SOLO_TEST). */
  es_prueba?: boolean;
}

/**
 * Deriva el estado de readiness de forma determinística. Conservador: exige
 * cobertura alta + precisión alta para hablar de piloto interno; nunca implica
 * sustitución global ni envío real.
 */
export function estadoReadiness(s: ScoresCliente): EstadoReadiness {
  if (s.es_prueba) return 'SOLO_TEST';
  if (s.cobertura_vs_pc < 40 || s.precision_estimada < 60) return 'NO_LISTO';
  if (s.cobertura_vs_pc < 70) return 'NECESITA_MAS_COBERTURA';
  // cobertura >= 70
  if (s.precision_estimada >= 85 && s.extraccion_score >= 70 && s.alertas_score >= 70) {
    return 'LISTO_PARA_PILOTO_INTERNO';
  }
  return 'SHADOW_ESTABLE_NO_REAL';
}

/** Siguiente acción recomendada por estado (texto operable, no envío real). */
export function siguienteAccion(estado: EstadoReadiness): string {
  switch (estado) {
    case 'LISTO_PARA_PILOTO_INTERNO': return 'preparar credenciales internas (dry-run → piloto interno, sin cliente externo)';
    case 'SHADOW_ESTABLE_NO_REAL':    return 'mantener shadow; afinar alertas/precisión antes de piloto';
    case 'NECESITA_MAS_COBERTURA':    return 'cerrar gaps accionables y reparar fuentes prioritarias';
    case 'NO_LISTO':                  return 'auditoría dedicada de cobertura/precisión antes de avanzar';
    case 'SOLO_TEST':                 return 'excluir de readiness ejecutivo (cliente de prueba)';
  }
}
