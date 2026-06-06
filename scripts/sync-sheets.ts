/**
 * Fase 2 — Sincronización Google Sheets → Supabase.
 *
 * Lee 01_Medios, 02_Keywords, 03_Clientes y 04_Configuracion, valida cada fila
 * con zod, e inserta/actualiza (upsert) en Supabase. Reporta filas inválidas
 * sin abortar el resto, y registra un resumen en consola y en logs_ingesta.
 *
 * Uso:  npm run sync-sheets
 */
import { SHEET_TABS } from '../src/sheets/client.js';
import { readTabRows, type RawRow } from '../src/sheets/read.js';
import {
  mapMedioRow,
  mapClienteRow,
  mapKeywordRow,
  mapConfigRow,
} from '../src/types/schemas.js';
import {
  upsertMedios,
  upsertClientes,
  upsertKeywords,
  upsertConfiguracion,
} from '../src/supabase/repositories.js';
import { writeIngestaLog } from '../src/logs/ingestaLogger.js';
import { logger } from '../src/utils/logger.js';

interface SyncOutcome {
  entidad: string;
  leidas: number;
  validas: number;
  invalidas: number;
  escritas: number;
}

/** Mapea+valida un conjunto de filas, separando válidas de errores. */
function validar<T>(
  rows: RawRow[],
  mapper: (r: RawRow) => { success: boolean; data?: T; error?: { issues: { path: (string | number)[]; message: string }[] } },
  entidad: string,
): { validas: T[]; invalidas: number } {
  const validas: T[] = [];
  let invalidas = 0;
  rows.forEach((r, idx) => {
    const res = mapper(r) as ReturnType<typeof mapper>;
    if (res.success && res.data !== undefined) {
      validas.push(res.data);
    } else {
      invalidas += 1;
      const detalle = res.error?.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ');
      logger.warn({ entidad, fila: idx + 2 }, `Fila inválida descartada (${detalle})`);
    }
  });
  return { validas, invalidas };
}

async function syncEntidad<T extends Record<string, unknown>>(
  entidad: string,
  tab: string,
  mapper: (r: RawRow) => any,
  upsert: (rows: T[]) => Promise<number>,
): Promise<SyncOutcome> {
  const started = Date.now();
  const rows = await readTabRows(tab);
  const { validas, invalidas } = validar<T>(rows, mapper, entidad);
  const escritas = await upsert(validas);

  const outcome: SyncOutcome = {
    entidad,
    leidas: rows.length,
    validas: validas.length,
    invalidas,
    escritas,
  };

  logger.info(outcome, `Sincronizado ${entidad}`);
  await writeIngestaLog({
    accion: `sync_${entidad}`,
    nivel: invalidas > 0 ? 'warn' : 'info',
    mensaje: `${escritas} escritas, ${invalidas} inválidas de ${rows.length} leídas`,
    urls_detectadas: rows.length,
    notas_nuevas: escritas,
    errores: invalidas,
    duracion_ms: Date.now() - started,
  });

  return outcome;
}

async function main() {
  logger.info('Iniciando sincronización Sheets → Supabase…');

  // Orden: clientes antes que keywords (FK lógica), config al final.
  const resultados: SyncOutcome[] = [];
  resultados.push(
    await syncEntidad('clientes', SHEET_TABS.CLIENTES, mapClienteRow, upsertClientes),
  );
  resultados.push(
    await syncEntidad('medios', SHEET_TABS.MEDIOS, mapMedioRow, upsertMedios),
  );
  resultados.push(
    await syncEntidad('keywords', SHEET_TABS.KEYWORDS, mapKeywordRow, upsertKeywords),
  );
  resultados.push(
    await syncEntidad(
      'configuracion',
      SHEET_TABS.CONFIGURACION,
      mapConfigRow,
      upsertConfiguracion,
    ),
  );

  const totalInvalidas = resultados.reduce((a, r) => a + r.invalidas, 0);
  logger.info({ resultados }, 'Sincronización completada.');

  if (totalInvalidas > 0) {
    logger.warn(`Se descartaron ${totalInvalidas} fila(s) inválida(s). Revisa los avisos arriba.`);
  }
}

main().catch((err) => {
  logger.error(err, 'Error fatal en sync-sheets.');
  process.exit(1);
});
