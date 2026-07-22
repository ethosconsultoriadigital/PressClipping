/**
 * Auditoría read-only de descubrimiento de keywords para CLI-0001 (Jumex).
 *
 * Busca 25 términos candidatos en los títulos de las noticias de los últimos
 * 30 y 90 días para evaluar qué señal real existe antes de proponer cambios
 * al set de keywords. Solo hace SELECT; no escribe nada.
 *
 * Uso:
 *   npm run audit-jumex-keyword-discovery
 *   npm run audit-jumex-keyword-discovery -- --window-days=90
 */
import 'dotenv/config';
import { getSupabase } from '../src/supabase/client.js';
import { logger } from '../src/utils/logger.js';

interface TermDef {
  term: string;
  /** Categoría sugerida si se propone como keyword nueva. */
  categoria_sugerida: 'MARCA_DIRECTA' | 'PRODUCTO_CATEGORIA' | 'SECTOR_REGULATORIO_ALTO' | 'SECTOR_GENERAL' | 'EXCLUIR' | 'YA_ACTIVA';
  /** KEY-XXXX si ya está activa. */
  keyword_id?: string;
}

const TERMS: TermDef[] = [
  // ── YA ACTIVAS ────────────────────────────────────────────────────────────
  { term: 'Jumex', categoria_sugerida: 'YA_ACTIVA', keyword_id: 'KEY-0001' },
  { term: 'Grupo Jumex', categoria_sugerida: 'YA_ACTIVA', keyword_id: 'KEY-0001' },
  { term: 'Jugos Jumex', categoria_sugerida: 'YA_ACTIVA', keyword_id: 'KEY-0001' },
  { term: 'Museo Jumex', categoria_sugerida: 'YA_ACTIVA', keyword_id: 'KEY-0002' },
  { term: 'bebidas azucaradas', categoria_sugerida: 'YA_ACTIVA', keyword_id: 'KEY-0009' },
  { term: 'IEPS bebidas azucaradas', categoria_sugerida: 'YA_ACTIVA', keyword_id: 'KEY-0065' },
  { term: 'etiquetado frontal', categoria_sugerida: 'YA_ACTIVA', keyword_id: 'KEY-0066' },
  { term: 'retiro de producto', categoria_sugerida: 'YA_ACTIVA', keyword_id: 'KEY-0067' },
  { term: 'Profeco', categoria_sugerida: 'YA_ACTIVA', keyword_id: 'KEY-0068' },
  // ── CANDIDATAS MARCA_DIRECTA ──────────────────────────────────────────────
  { term: 'Jumex Holding', categoria_sugerida: 'MARCA_DIRECTA' },
  { term: 'néctar Jumex', categoria_sugerida: 'MARCA_DIRECTA' },
  { term: 'néctares Jumex', categoria_sugerida: 'MARCA_DIRECTA' },
  { term: 'jugo Jumex', categoria_sugerida: 'MARCA_DIRECTA' },
  // ── CANDIDATAS PRODUCTO_CATEGORIA ─────────────────────────────────────────
  { term: 'industria de jugos', categoria_sugerida: 'PRODUCTO_CATEGORIA' },
  { term: 'néctares de fruta', categoria_sugerida: 'PRODUCTO_CATEGORIA' },
  { term: 'jugos envasados', categoria_sugerida: 'PRODUCTO_CATEGORIA' },
  { term: 'jugos y néctares', categoria_sugerida: 'PRODUCTO_CATEGORIA' },
  // ── CANDIDATAS SECTOR_REGULATORIO_ALTO ────────────────────────────────────
  { term: 'COFEPRIS bebidas', categoria_sugerida: 'SECTOR_REGULATORIO_ALTO' },
  { term: 'NOM bebidas', categoria_sugerida: 'SECTOR_REGULATORIO_ALTO' },
  { term: 'impuesto refrescos', categoria_sugerida: 'SECTOR_REGULATORIO_ALTO' },
  { term: 'reforma fiscal bebidas', categoria_sugerida: 'SECTOR_REGULATORIO_ALTO' },
  // ── CANDIDATAS SECTOR_GENERAL ─────────────────────────────────────────────
  { term: 'industria refresquera', categoria_sugerida: 'SECTOR_GENERAL' },
  { term: 'bebidas no alcohólicas', categoria_sugerida: 'SECTOR_GENERAL' },
  { term: 'industria de bebidas', categoria_sugerida: 'SECTOR_GENERAL' },
  { term: 'agua embotellada', categoria_sugerida: 'SECTOR_GENERAL' },
];

interface TermResult {
  term: string;
  categoria_sugerida: string;
  keyword_id: string;
  hits_30d: number;
  hits_90d: number;
  sample_30d: string[];
}

async function countHits(
  sb: ReturnType<typeof getSupabase>,
  term: string,
  since: string,
): Promise<{ count: number; samples: string[] }> {
  const { data, error } = await sb
    .from('noticias')
    .select('titulo')
    .ilike('titulo', `%${term}%`)
    .gte('created_at', since)
    .limit(5);

  if (error) {
    logger.warn({ term, error: error.message }, 'Error en countHits');
    return { count: 0, samples: [] };
  }

  // Supabase no retorna count directamente con select('titulo'), pedimos count aparte
  const { count, error: errCount } = await sb
    .from('noticias')
    .select('*', { count: 'exact', head: true })
    .ilike('titulo', `%${term}%`)
    .gte('created_at', since);

  if (errCount) {
    logger.warn({ term, error: errCount.message }, 'Error en count');
    return { count: (data ?? []).length, samples: (data ?? []).map((r) => r.titulo ?? '(sin título)') };
  }

  return {
    count: count ?? 0,
    samples: (data ?? []).map((r) => r.titulo ?? '(sin título)'),
  };
}

async function main() {
  const sb = getSupabase();

  const now = Date.now();
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since90d = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();

  logger.info({ terms: TERMS.length, windows: '30d / 90d' }, '=== JUMEX KEYWORD DISCOVERY AUDIT (SOLO LECTURA) ===');

  const results: TermResult[] = [];

  for (const t of TERMS) {
    const r30 = await countHits(sb, t.term, since30d);
    const r90 = await countHits(sb, t.term, since90d);

    results.push({
      term: t.term,
      categoria_sugerida: t.categoria_sugerida,
      keyword_id: t.keyword_id ?? '—',
      hits_30d: r30.count,
      hits_90d: r90.count,
      sample_30d: r30.samples,
    });

    // Brief throttle to avoid hammering PostgREST
    await new Promise((r) => setTimeout(r, 80));
  }

  // ── Tabla resumen ──────────────────────────────────────────────────────────
  logger.info({}, '\n=== RESUMEN POR TÉRMINO ===');
  for (const r of results) {
    const indicator =
      r.hits_30d === 0 ? '⬜ SIN SEÑAL' :
      r.hits_30d < 3  ? '🟡 DÉBIL' :
      r.hits_30d < 10 ? '🟠 MODERADO' :
                        '🔴 ALTO';

    logger.info(
      {
        term: r.term,
        categoria: r.categoria_sugerida,
        keyword_id: r.keyword_id,
        hits_30d: r.hits_30d,
        hits_90d: r.hits_90d,
        señal: indicator,
      },
      '',
    );
  }

  // ── Candidatas con señal real (>0 hits/30d, no ya activas) ───────────────
  const candidatasConSenal = results.filter(
    (r) => r.hits_30d > 0 && r.categoria_sugerida !== 'YA_ACTIVA',
  );

  if (candidatasConSenal.length === 0) {
    logger.info({}, '\nCandidatas con señal real (30d): NINGUNA — set actual es suficiente o hay brecha de cobertura.');
  } else {
    logger.info(
      { candidatas: candidatasConSenal.map((r) => `${r.term} (${r.hits_30d}/30d, ${r.categoria_sugerida})`) },
      '\nCandidatas con señal real (30d):',
    );

    // Muestra titulares para las candidatas con señal
    for (const r of candidatasConSenal) {
      if (r.sample_30d.length > 0) {
        logger.info({ term: r.term, titulares: r.sample_30d }, 'Sample titulares');
      }
    }
  }

  // ── Cobertura actual (YA_ACTIVAS) ─────────────────────────────────────────
  const yaActivas = results.filter((r) => r.categoria_sugerida === 'YA_ACTIVA');
  logger.info(
    {
      activas: yaActivas.map((r) => ({
        term: r.term,
        keyword_id: r.keyword_id,
        hits_30d: r.hits_30d,
        hits_90d: r.hits_90d,
      })),
    },
    '\nCobertura actual (keywords YA activas):',
  );

  // ── Veredicto rápido ───────────────────────────────────────────────────────
  const marcaDirectaActual = yaActivas.filter((r) => r.keyword_id === 'KEY-0001').reduce((s, r) => s + r.hits_30d, 0);
  const candidatasNuevasSenal = candidatasConSenal.filter((r) => r.categoria_sugerida === 'MARCA_DIRECTA');

  logger.info(
    {
      marca_directa_hits_30d: marcaDirectaActual,
      candidatas_marca_directa_con_senal: candidatasNuevasSenal.length,
      candidatas_producto_categoria_con_senal: candidatasConSenal.filter((r) => r.categoria_sugerida === 'PRODUCTO_CATEGORIA').length,
    },
    '\n=== Veredicto rápido ===',
  );

  logger.info({}, '=== Fin auditoría — SOLO LECTURA, nada escrito ===');
}

main().catch((e) => { logger.error(e, 'Error en audit-jumex-keyword-discovery'); process.exit(1); });
