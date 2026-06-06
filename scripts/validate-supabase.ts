/**
 * validate:supabase — valida la conexión y el esquema de Supabase.
 *
 * Confirma que cada tabla esperada existe y cuenta sus filas (head, sin traer
 * datos). Solo lectura.
 *
 * Uso:  npm run validate:supabase
 */
import { checkEnv, checkSupabaseTables } from '../src/validation/checks.js';
import { logger } from '../src/utils/logger.js';

async function main() {
  const env = checkEnv();
  if (!env.supabase) {
    const relevantes = env.faltantes.filter((k) => k.startsWith('SUPABASE_'));
    logger.error({ faltantes: relevantes }, 'Faltan credenciales de Supabase.');
    process.exit(1);
  }

  const tablas = await checkSupabaseTables();
  for (const t of tablas) {
    if (t.ok) logger.info(`  ✅ ${t.tabla} (${t.filas} filas)`);
    else logger.error(`  ❌ ${t.tabla}: ${t.error}`);
  }

  const faltan = tablas.filter((t) => !t.ok);
  if (faltan.length > 0) {
    logger.error(
      { tablas: faltan.map((t) => t.tabla) },
      'Faltan tablas. ¿Aplicaste supabase/migrations (0001-0003)?',
    );
    process.exit(1);
  }
  logger.info('validate:supabase OK.');
}

main().catch((err) => {
  logger.error(err, 'Error fatal en validate:supabase.');
  process.exit(1);
});
