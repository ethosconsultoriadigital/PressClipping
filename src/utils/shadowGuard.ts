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

/**
 * Flags que intentan ENVÍO REAL de alertas y están PROHIBIDOS en alertas sombra.
 * (`--no-<x>` siempre se permite: es confirmación segura.)
 */
export const ACCIONES_PROHIBIDAS_ALERTAS = [
  'send',
  'enviar',
  'whatsapp',
  'twilio',
  'email',
  'emails',
  'correos',
  'gmail',
  'smtp',
  'alerts',
  'alertas',
] as const;

/**
 * Verifica que ningún flag intente habilitar envío real en alertas sombra.
 * Devuelve ok=false con un mensaje claro para salir con exit 2.
 */
export function verificarFlagsAlertasSombra(argv: string[]): ResultadoGuarda {
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const flag = arg.slice(2).split('=')[0]!.trim().toLowerCase();
    if (flag.startsWith('no-')) continue; // --no-* = confirmación segura
    if ((ACCIONES_PROHIBIDAS_ALERTAS as readonly string[]).includes(flag)) {
      return {
        ok: false,
        violacion: flag,
        mensaje: 'Shadow alerts forbid real sending.',
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
/** ¿El valor de precision_ajustada representa "no calculable" (denominador 0)? */
export function esPrecisionNA(valor: unknown): boolean {
  return String(valor ?? '').trim().toUpperCase() === 'N/A';
}

export function notasShadow(opts: {
  windowHours?: number;
  mediosCurados?: number;
  promovidasDiagnostico?: number;
  /** Valor crudo de precision_ajustada; si es N/A se justifica el denominador cero. */
  precisionAjustada?: string | number;
  /** Marcadores de integridad de la escritura en Sheets. */
  sheets429?: boolean;
  sheetsWriteFailed?: boolean;
  sheetsWriteMismatch?: boolean;
  /**
   * Trazabilidad adicional del workflow (p.ej. tier nacional B). Se concatena al
   * final de forma segura sin alterar las notas base del shadow scheduler.
   * Ej.: "workflow=shadow-national-tier; tier=nacional_b; medios=MED-0025,MED-0053; frecuencia=6h"
   */
  notasExtra?: string;
}): string {
  const partes = ['modo=shadow', 'sin alertas', 'sin export-results'];
  if (opts.windowHours != null) partes.push(`ventana_movil=${opts.windowHours}h`);
  if (opts.mediosCurados != null) partes.push(`medios_curados=${opts.mediosCurados}`);
  if (esPrecisionNA(opts.precisionAjustada)) {
    partes.push('precision_ajustada=N/A_denominador_cero');
  }
  if (opts.sheets429) partes.push('sheets_429');
  if (opts.sheetsWriteFailed) partes.push('sheets_write_failed');
  if (opts.sheetsWriteMismatch) partes.push('sheets_write_mismatch');
  partes.push(`promovidas_diagnostico=${opts.promovidasDiagnostico ?? 0}`);
  const extra = opts.notasExtra?.trim();
  if (extra) partes.push(extra);
  return partes.join('; ');
}

/**
 * Ensambla la trazabilidad de workflow/tier para `notasShadow.notasExtra`.
 * Devuelve '' si no hay datos (el shadow base no se altera). Cada parte es
 * `clave=valor`; el resultado se concatena con '; '.
 * Ej.: "workflow=shadow-national-tier; tier=nacional_b; medios=MED-0025,MED-0053; frecuencia=6h"
 */
export function notasTrazabilidadWorkflow(opts: {
  workflow?: string;
  tier?: string;
  medios?: string;
  frecuencia?: string;
  /** Fuente preferida usada por el tier (p.ej. 'sitemap' en el tier crisis). */
  fuente?: string;
}): string {
  const partes: string[] = [];
  if (opts.workflow?.trim()) partes.push(`workflow=${opts.workflow.trim()}`);
  if (opts.tier?.trim()) partes.push(`tier=${opts.tier.trim()}`);
  if (opts.medios?.trim()) partes.push(`medios=${opts.medios.trim()}`);
  if (opts.fuente?.trim()) partes.push(`fuente=${opts.fuente.trim()}`);
  if (opts.frecuencia?.trim()) partes.push(`frecuencia=${opts.frecuencia.trim()}`);
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
  /** No se pudo escribir 05 en Sheets (429/timeout/error). */
  sheetsWriteFailed?: boolean;
  /** 05 se escribió pero el read-back no coincide con lo generado. */
  sheetsWriteMismatch?: boolean;
}

/**
 * Determina el estado del ciclo sombra:
 *   - shadow_error: comparativo falló, flood de FP, o NO se pudo escribir 05.
 *   - shadow_warning: read-back de 05 no coincide, dry-run no limpio o errores
 *     de crawl.
 *   - shadow_ok: todo correcto.
 *
 * NUNCA devuelve shadow_ok si 05 no se escribió o no coincide con lo generado
 * (regla de consistencia 05↔07).
 */
export function estadoCicloSombra(s: SenalesCiclo): EstadoCicloSombra {
  const umbral = s.umbralFlood ?? 25;
  if (!s.compareOk) return 'shadow_error';
  if (s.sheetsWriteFailed) return 'shadow_error';
  if ((s.potenciales ?? 0) > umbral) return 'shadow_error';
  if (s.sheetsWriteMismatch) return 'shadow_warning';
  if ((s.dryRunSinTexto ?? 0) > 0) return 'shadow_warning';
  if ((s.crawlErrores ?? 0) > 0) return 'shadow_warning';
  return 'shadow_ok';
}
