/**
 * Reporte read-only de staging Jumex (CLI-0001) categorizado — lote NATIONAL
 * MEDIA COVERAGE RAMP (2026-07-20). Aplica el criterio editorial de
 * `src/editorial/jumexCriteria.ts` a las menciones REALES ya existentes en
 * `menciones` (no ejecuta detect-mentions ni inserta nada).
 *
 * NO escribe en Supabase ni Sheets. NO toca la hoja final de Jumex.
 *
 * Uso:
 *   npm run report-jumex-staging-categorized
 *   npm run report-jumex-staging-categorized -- --window-days=30
 */
import 'dotenv/config';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';
import {
  clasificarCategoriaJumexPorId,
  resumirCategoriasJumex,
  evaluarGoNoGoJumex,
  type CategoriaJumex,
} from '../src/editorial/jumexCriteria.js';

const CLI_ID = 'CLI-0001';

function parseWindowDays(argv: string[]): number {
  for (const arg of argv) {
    if (arg.startsWith('--window-days=')) return Number(arg.split('=')[1]) || 30;
  }
  return 30;
}

async function main() {
  const windowDays = parseWindowDays(process.argv.slice(2));
  const sb = getSupabase();
  const hace24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const hace7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const desde = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  logger.info({ cliente: CLI_ID, windowDays }, '=== Jumex staging categorizado (SOLO LECTURA) ===');

  const { data: rows } = await sb
    .from('menciones')
    .select('keyword_id, keyword, created_at, noticias!inner(medio_id, titulo, medios(nombre_medio))')
    .eq('cliente_id', CLI_ID)
    .gte('created_at', desde)
    .order('mencion_id', { ascending: true })
    .limit(5000);

  const filas = (rows ?? []) as any[];
  const categorias: CategoriaJumex[] = filas.map((f) => clasificarCategoriaJumexPorId(f.keyword_id));
  const resumen = resumirCategoriasJumex(categorias);
  const veredicto = evaluarGoNoGoJumex(resumen);

  const c24h = filas.filter((f) => f.created_at >= hace24h).length;
  const c7d = filas.filter((f) => f.created_at >= hace7d).length;

  logger.info(
    { menciones_24h: c24h, menciones_7d: c7d, menciones_ventana: resumen.total, window_days: windowDays },
    'Volumen de menciones',
  );
  logger.info(resumen, 'Resumen por categoría editorial');

  const porMedio: Record<string, number> = {};
  for (const f of filas) {
    const nombre = f.noticias?.medios?.nombre_medio ?? f.noticias?.medio_id ?? 'desconocido';
    porMedio[nombre] = (porMedio[nombre] ?? 0) + 1;
  }
  logger.info({ por_medio: porMedio }, 'Menciones por medio (todas las categorías)');

  const marcaDirecta = filas.filter((f) => clasificarCategoriaJumexPorId(f.keyword_id) === 'MARCA_DIRECTA');
  if (marcaDirecta.length > 0) {
    logger.info({ titulares: marcaDirecta.map((f) => ({ medio: f.noticias?.medios?.nombre_medio, titulo: f.noticias?.titulo })) }, 'Titulares MARCA_DIRECTA');
  } else {
    logger.warn({}, 'Sin titulares MARCA_DIRECTA en la ventana — 0 cobertura de marca real');
  }

  logger.info({ go: veredicto.go, motivo: veredicto.motivo }, '=== Veredicto GO/NO-GO hoja final Jumex ===');
  logger.info({}, '=== Fin reporte — SOLO LECTURA, nada escrito, hoja final Jumex NO tocada ===');
}

main().catch((e) => { logger.error(e, 'Error fatal en report-jumex-staging-categorized'); process.exit(1); });
