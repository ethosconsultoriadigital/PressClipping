/**
 * Logger de aplicación (consola) basado en pino.
 *
 * Este es el primero de los tres destinos de logging del sistema:
 *   1. Consola (este módulo)          -> visibilidad inmediata / GitHub Actions
 *   2. Tabla logs_ingesta (Supabase)  -> histórico estructurado (Fase 2+)
 *   3. Pestaña 05_Logs (Sheets)       -> panel operativo (Fase 5)
 *
 * En desarrollo usa salida "pretty"; en CI/Actions conviene LOG_FORMAT=json.
 */
import pino from 'pino';
import { env } from '../config/env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { run_by: env.RUN_BY },
  transport:
    env.LOG_FORMAT === 'pretty'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

/** Crea un logger hijo con contexto fijo (p.ej. el medio en proceso). */
export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
