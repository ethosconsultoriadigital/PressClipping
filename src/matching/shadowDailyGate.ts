/**
 * Gate PURO para autorizar `detect real` en el tier daily-validated.
 *
 * Las puertas contextuales CLI-0002 (comercio→bebidas) y CLI-0003 (laboral
 * amplio→contexto laboral) YA se aplican dentro del matcher (`matchKeyword` vía
 * `pasaPuertaContextualClienteKeyword`), de modo que cualquier potencial que
 * llega aquí es contextualmente válido: `CLI-0002 sin bebidas = 0` y
 * `CLI-0003 sin contexto = 0` están garantizados por construcción.
 *
 * Este gate agrega los límites operativos del ciclo diario:
 *   - dry-run debe haber terminado bien (code 0)
 *   - sin notas sin texto (sinTexto = 0)
 *   - potenciales <= máximo (default 100)
 *   - sin flood por keyword (una sola keyword no puede acaparar el lote)
 *   - sin flood por medio (un solo medio no puede acaparar el lote)
 */

export interface GateDailyInput {
  /** Código de salida del subproceso detect dry-run. */
  detectCode: number;
  /** Notas sin texto reportadas por el dry-run. */
  sinTexto: number | undefined;
  /** Menciones potenciales del dry-run. */
  potenciales: number;
  /** Conteo por keyword (opcional; si falta, no se evalúa flood por keyword). */
  porKeyword?: Record<string, number>;
  /** Conteo por medio (opcional; si falta, no se evalúa flood por medio). */
  porMedio?: Record<string, number>;
  /** Máximo de potenciales permitido. Default 100. */
  maxPotenciales?: number;
  /** Fracción máxima que puede acaparar una sola keyword/medio. Default 0.6. */
  maxFraccionFlood?: number;
  /** Umbral mínimo de potenciales para siquiera evaluar flood. Default 8. */
  minParaFlood?: number;
}

export interface GateDailyResultado {
  pasa: boolean;
  motivo: string;
}

export function evaluarGateDaily(input: GateDailyInput): GateDailyResultado {
  const maxPotenciales = input.maxPotenciales ?? 100;
  const maxFraccion = input.maxFraccionFlood ?? 0.6;
  const minParaFlood = input.minParaFlood ?? 8;

  if (input.detectCode !== 0) {
    return { pasa: false, motivo: 'dry_run_error' };
  }
  if (input.sinTexto !== undefined && input.sinTexto > 0) {
    return { pasa: false, motivo: 'hay_notas_sin_texto' };
  }
  if (input.potenciales > maxPotenciales) {
    return { pasa: false, motivo: `flood_potenciales(${input.potenciales}>${maxPotenciales})` };
  }

  // Flood por keyword / medio: solo si hay volumen suficiente para que importe.
  if (input.potenciales >= minParaFlood) {
    const tope = Math.floor(input.potenciales * maxFraccion);
    if (input.porKeyword) {
      const max = Math.max(0, ...Object.values(input.porKeyword));
      if (max > tope) return { pasa: false, motivo: `flood_keyword(${max}>${tope})` };
    }
    if (input.porMedio) {
      const max = Math.max(0, ...Object.values(input.porMedio));
      if (max > tope) return { pasa: false, motivo: `flood_medio(${max}>${tope})` };
    }
  }

  return { pasa: true, motivo: 'gate_ok' };
}
