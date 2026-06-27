/**
 * Guardas de "modo sombra" (shadow scheduler).
 *
 * El modo sombra acumula histórico orgánico y comparativo SIN entregar nada al
 * cliente. Por código impide habilitar acciones de producción: export-results,
 * alertas, WhatsApp/correos, generate-xml, classify-ia, export-raw-news.
 *
 * Lógica PURA (sin red ni DB) para poder testearla.
 */

/** Acciones prohibidas en modo sombra (forma canónica del flag, sin `--`). */
export const ACCIONES_PROHIBIDAS_SOMBRA = [
  'export-results',
  'alerts',
  'alertas',
  'whatsapp',
  'correos',
  'emails',
  'generate-xml',
  'classify-ia',
  'export-raw-news',
] as const;

export interface ResultadoGuarda {
  ok: boolean;
  /** Flag ofensivo (si ok=false). */
  violacion?: string;
  mensaje?: string;
}

/**
 * Verifica que ningún flag de los argv intente HABILITAR una acción prohibida.
 * Los flags con prefijo `no-` (p.ej. `--no-export-results`) son confirmaciones
 * seguras y se permiten.
 */
export function verificarFlagsSombra(argv: string[]): ResultadoGuarda {
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const flag = arg.slice(2).split('=')[0]!.trim().toLowerCase();
    if (flag.startsWith('no-')) continue; // --no-* = confirmación segura
    if ((ACCIONES_PROHIBIDAS_SOMBRA as readonly string[]).includes(flag)) {
      return {
        ok: false,
        violacion: flag,
        mensaje: `Shadow mode forbids ${flag}. Acciones prohibidas: ${ACCIONES_PROHIBIDAS_SOMBRA.join(', ')}.`,
      };
    }
  }
  return { ok: true };
}

/** Valor de la columna `modo` en 07_Metricas_Live según el tipo de corrida. */
export function modoMetrica(shadow: boolean, haraCrawl: boolean): string {
  if (shadow) return 'shadow';
  return haraCrawl ? 'ciclo_completo' : 'solo_comparacion';
}

/**
 * Construye el texto de la columna `notas` de 07_Metricas_Live para modo sombra,
 * dejando trazabilidad explícita de la ventana móvil y los medios curados.
 * Ej.: "modo=shadow; sin alertas; sin export-results; ventana_movil=48h; medios_curados=25; promovidas_diagnostico=0"
 */
export function notasShadow(opts: {
  windowHours?: number;
  mediosCurados?: number;
  promovidasDiagnostico?: number;
}): string {
  const partes = ['modo=shadow', 'sin alertas', 'sin export-results'];
  if (opts.windowHours != null) partes.push(`ventana_movil=${opts.windowHours}h`);
  if (opts.mediosCurados != null) partes.push(`medios_curados=${opts.mediosCurados}`);
  partes.push(`promovidas_diagnostico=${opts.promovidasDiagnostico ?? 0}`);
  return partes.join('; ');
}

export type EstadoCicloSombra = 'shadow_ok' | 'shadow_warning' | 'shadow_error';

export interface SenalesCiclo {
  compareOk: boolean;
  dryRunSinTexto?: number;
  crawlErrores?: number;
  potenciales?: number;
  /** Umbral de menciones potenciales que se considera "flood". */
  umbralFlood?: number;
}

/**
 * Determina el estado del ciclo sombra:
 *   - shadow_error: el comparativo falló o hubo flood de falsos positivos.
 *   - shadow_warning: dry-run no limpio (sinTexto>0) o errores de crawl.
 *   - shadow_ok: todo correcto.
 */
export function estadoCicloSombra(s: SenalesCiclo): EstadoCicloSombra {
  const umbral = s.umbralFlood ?? 25;
  if (!s.compareOk) return 'shadow_error';
  if ((s.potenciales ?? 0) > umbral) return 'shadow_error';
  if ((s.dryRunSinTexto ?? 0) > 0) return 'shadow_warning';
  if ((s.crawlErrores ?? 0) > 0) return 'shadow_warning';
  return 'shadow_ok';
}
