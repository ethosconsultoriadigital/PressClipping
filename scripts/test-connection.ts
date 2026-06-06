/**
 * Prueba de conexión a Supabase y/o Google Sheets.
 *
 * Uso:
 *   npm run test:connection            # prueba ambos
 *   npm run test:connection -- supabase
 *   npm run test:connection -- sheets
 *
 * Sale con código 1 si alguna comprobación solicitada falla (útil en CI).
 */
import { checkSupabaseConnection } from '../src/supabase/client.js';
import { checkSheetsConnection } from '../src/sheets/client.js';
import { logger } from '../src/utils/logger.js';

type Target = 'supabase' | 'sheets';

async function main() {
  const arg = process.argv[2]?.toLowerCase();
  const targets: Target[] =
    arg === 'supabase' ? ['supabase'] : arg === 'sheets' ? ['sheets'] : ['supabase', 'sheets'];

  let allOk = true;

  for (const target of targets) {
    try {
      const result =
        target === 'supabase'
          ? await checkSupabaseConnection()
          : await checkSheetsConnection();

      if (result.ok) {
        logger.info({ target }, `✅ ${target}: ${result.detail}`);
      } else {
        allOk = false;
        logger.error({ target }, `❌ ${target}: ${result.detail}`);
      }
    } catch (err) {
      allOk = false;
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ target }, `❌ ${target}: ${msg}`);
    }
  }

  if (!allOk) {
    logger.error('Una o más comprobaciones fallaron.');
    process.exit(1);
  }
  logger.info('Todas las comprobaciones solicitadas pasaron.');
}

main().catch((err) => {
  logger.error(err, 'Error inesperado en test-connection.');
  process.exit(1);
});
