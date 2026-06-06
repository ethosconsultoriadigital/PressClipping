/**
 * validate:sheets — valida la conexión y estructura de Google Sheets.
 *
 * Confirma: conexión, pestañas esperadas presentes, conteo de filas de las
 * pestañas de entrada y que las cabeceras de 01_Medios permiten mapear filas.
 * Solo lectura.
 *
 * Uso:  npm run validate:sheets
 */
import { checkEnv, checkSheetsTabs } from '../src/validation/checks.js';
import { readTabRows } from '../src/sheets/read.js';
import { SHEET_TABS } from '../src/sheets/client.js';
import { mapMedioRow } from '../src/types/schemas.js';
import { logger } from '../src/utils/logger.js';

async function main() {
  const env = checkEnv();
  if (!env.sheets) {
    const relevantes = env.faltantes.filter((k) => k.startsWith('GOOGLE_'));
    logger.error({ faltantes: relevantes }, 'Faltan credenciales de Google Sheets.');
    process.exit(1);
  }

  const s = await checkSheetsTabs();
  logger.info({ documento: s.titulo, conteos: s.conteos }, 'Conexión a Sheets OK');

  // Pestañas de entrada críticas para el pipeline.
  const criticas = [SHEET_TABS.MEDIOS, SHEET_TABS.KEYWORDS, SHEET_TABS.CLIENTES, SHEET_TABS.CONFIGURACION];
  const criticasFaltantes = criticas.filter((t) => s.faltantes.includes(t));
  if (s.faltantes.length > 0) {
    logger.warn({ faltantes: s.faltantes }, 'Pestañas esperadas ausentes');
  }

  // Validación de cabeceras de 01_Medios: ¿podemos mapear filas?
  const rows = await readTabRows(SHEET_TABS.MEDIOS);
  let validas = 0;
  let invalidas = 0;
  for (const r of rows) {
    if (mapMedioRow(r).success) validas += 1;
    else invalidas += 1;
  }
  logger.info({ filas: rows.length, validas, invalidas }, 'Mapeo de 01_Medios');

  if (criticasFaltantes.length > 0) {
    logger.error({ criticasFaltantes }, 'Faltan pestañas de entrada críticas.');
    process.exit(1);
  }
  logger.info('validate:sheets OK.');
}

main().catch((err) => {
  logger.error(err, 'Error fatal en validate:sheets.');
  process.exit(1);
});
