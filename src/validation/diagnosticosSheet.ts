/**
 * Lectura del diagnóstico de medios desde la pestaña 08_Validacion_Medios.
 *
 * `validate:media` ESCRIBE esa pestaña (anexa filas). Aquí solo LEEMOS, para que
 * el crawler pueda filtrar por el último diagnóstico conocido de cada medio.
 * Es best-effort: si la pestaña no existe o no hay credenciales, devolvemos un
 * mapa vacío y el crawler sigue con sus filtros duros.
 */
import { getSpreadsheet } from '../sheets/client.js';
import { readTabRows } from '../sheets/read.js';
import { parseBool, parseTextOrNull } from '../utils/parse.js';
import type { DiagnosticoMedio } from '../crawlers/selection.js';

export const TAB_VALIDACION = '08_Validacion_Medios';

/**
 * Devuelve un mapa medio_id → último diagnóstico (por fecha_validacion).
 * Si la pestaña no existe, devuelve un mapa vacío sin lanzar.
 */
export async function readDiagnosticosMedios(): Promise<Map<string, DiagnosticoMedio>> {
  const map = new Map<string, DiagnosticoMedio>();

  const doc = await getSpreadsheet();
  if (!doc.sheetsByTitle[TAB_VALIDACION]) return map;

  const rows = await readTabRows(TAB_VALIDACION);
  const fechaPorId = new Map<string, string>();

  for (const r of rows) {
    const id = parseTextOrNull(r['medio_id']);
    if (!id) continue;
    const fecha = parseTextOrNull(r['fecha_validacion']) ?? '';
    const prev = fechaPorId.get(id);
    // Conserva la fila con fecha_validacion más reciente (ISO ordena lexicográfico).
    if (prev !== undefined && fecha < prev) continue;
    fechaPorId.set(id, fecha);
    map.set(id, {
      estado_diagnostico: parseTextOrNull(r['estado_diagnostico']) ?? '',
      es_especial: parseBool(r['es_especial']),
    });
  }

  return map;
}
