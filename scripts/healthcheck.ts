/**
 * healthcheck — diagnóstico integral del sistema (solo lectura).
 *
 * Reporta: credenciales presentes, conexión a Supabase y existencia de tablas,
 * conexión a Google Sheets y pestañas. No escribe ni borra nada.
 *
 * Uso:  npm run healthcheck
 */
import { checkEnv, checkSupabaseTables, checkSheetsTabs } from '../src/validation/checks.js';
import { logger } from '../src/utils/logger.js';

async function main() {
  let problemas = 0;
  const env = checkEnv();
  logger.info(
    { supabase: env.supabase, sheets: env.sheets, anthropic: env.anthropic },
    'Credenciales detectadas',
  );
  if (env.faltantes.length > 0) {
    logger.warn({ faltantes: env.faltantes }, 'Variables de entorno faltantes');
  }

  // Supabase
  if (env.supabase) {
    try {
      const tablas = await checkSupabaseTables();
      const faltan = tablas.filter((t) => !t.ok);
      for (const t of tablas) {
        const linea = `  ${t.ok ? '✅' : '❌'} ${t.tabla}${t.ok ? ` (${t.filas} filas)` : `: ${t.error}`}`;
        (t.ok ? logger.info : logger.error).call(logger, linea);
      }
      if (faltan.length > 0) problemas += faltan.length;
    } catch (err) {
      problemas += 1;
      logger.error(err, 'Fallo al verificar tablas de Supabase');
    }
  } else {
    logger.warn('Supabase: omitido (sin credenciales)');
  }

  // Sheets
  if (env.sheets) {
    try {
      const s = await checkSheetsTabs();
      logger.info({ documento: s.titulo, pestañas: s.pestañas.length, conteos: s.conteos }, 'Google Sheets OK');
      if (s.faltantes.length > 0) {
        logger.warn({ faltantes: s.faltantes }, 'Pestañas esperadas ausentes');
      }
    } catch (err) {
      problemas += 1;
      logger.error(err, 'Fallo al verificar Google Sheets');
    }
  } else {
    logger.warn('Google Sheets: omitido (sin credenciales)');
  }

  if (!env.supabase && !env.sheets) {
    logger.error('Sin credenciales para Supabase ni Sheets: configura .env (ver .env.example).');
    process.exit(1);
  }
  if (problemas > 0) {
    logger.error(`Healthcheck con ${problemas} problema(s).`);
    process.exit(1);
  }
  logger.info('Healthcheck OK.');
}

main().catch((err) => {
  logger.error(err, 'Error fatal en healthcheck.');
  process.exit(1);
});
