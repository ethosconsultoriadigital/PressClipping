/**
 * Escritura de logs estructurados a la tabla logs_ingesta (Supabase).
 *
 * Segundo de los tres destinos de logging (consola → DB → pestaña 05_Logs).
 * El volcado a la pestaña 05_Logs se implementa en la Fase 5.
 */
import { getSupabase } from '../supabase/client.js';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';

export interface IngestaLogEntry {
  fuente_id?: string | null;
  medio_id?: string | null;
  accion: string;
  nivel?: 'info' | 'warn' | 'error';
  mensaje?: string | null;
  urls_detectadas?: number;
  notas_nuevas?: number;
  duplicados?: number;
  errores?: number;
  duracion_ms?: number | null;
}

/**
 * Inserta una entrada de log en logs_ingesta. Nunca lanza: si el log falla,
 * lo reportamos por consola pero no tumbamos la corrida que estábamos midiendo.
 */
export async function writeIngestaLog(entry: IngestaLogEntry): Promise<void> {
  const row = {
    fecha_hora: new Date().toISOString(),
    fuente_id: entry.fuente_id ?? null,
    medio_id: entry.medio_id ?? null,
    accion: entry.accion,
    nivel: entry.nivel ?? 'info',
    mensaje: entry.mensaje ?? null,
    urls_detectadas: entry.urls_detectadas ?? 0,
    notas_nuevas: entry.notas_nuevas ?? 0,
    duplicados: entry.duplicados ?? 0,
    errores: entry.errores ?? 0,
    duracion_ms: entry.duracion_ms ?? null,
    ejecutado_por: env.RUN_BY,
  };

  try {
    const { error } = await getSupabase().from('logs_ingesta').insert(row);
    if (error) {
      logger.warn({ err: error.message, accion: entry.accion }, 'No se pudo escribir en logs_ingesta');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, accion: entry.accion }, 'Fallo inesperado al escribir log');
  }
}
