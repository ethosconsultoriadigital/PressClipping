/**
 * Simulación READ-ONLY de keywords nacionales candidatas.
 *
 * Mide si un set de keywords candidatas (fixture local NO persistido) produciría
 * cobertura útil sobre noticias YA enriquecidas, sin recrawlear, sin re-enriquecer,
 * sin insertar menciones y sin tocar DB/Sheets. Reutiliza el matcher de producción.
 *
 * Uso:
 *   npm run simulate-candidate-keywords -- --medio-ids=MED-0030,MED-0008,MED-0025,MED-0053 --window-hours=72
 *   npm run simulate-candidate-keywords -- --fixture=tmp/candidate-keywords-national.json --top=20
 *
 * NO escribe nada. Solo imprime métricas.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getSupabase } from '../src/supabase/client.js';
import {
  simulate,
  contarPor,
  type CandidateRow,
  type SimNoticia,
  type SimMatch,
} from '../src/sim/candidateSimulation.js';
import { logger } from '../src/utils/logger.js';

interface Args {
  medioIds: string[];
  windowHours: number;
  fixture: string;
  top: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    medioIds: ['MED-0030', 'MED-0008', 'MED-0025', 'MED-0053'],
    windowHours: 72,
    fixture: 'tmp/candidate-keywords-national.json',
    top: 20,
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const value = eq === -1 ? '' : arg.slice(eq + 1);
    if (key === 'medio-ids') out.medioIds = value.split(',').map((s) => s.trim()).filter(Boolean);
    if (key === 'window-hours') out.windowHours = Number(value) || out.windowHours;
    if (key === 'fixture') out.fixture = value || out.fixture;
    if (key === 'top') out.top = Number(value) || out.top;
  }
  return out;
}

function loadCandidatas(path: string): CandidateRow[] {
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  const arr = Array.isArray(raw) ? raw : raw.candidatas;
  if (!Array.isArray(arr)) throw new Error(`Fixture inválido: se esperaba array o {candidatas:[]} en ${path}`);
  return arr as CandidateRow[];
}

async function fetchNoticias(medioIds: string[], windowHours: number): Promise<SimNoticia[]> {
  const desde = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
  const { data, error } = await getSupabase()
    .from('noticias')
    .select(
      'noticia_id, medio_id, titulo, subtitulo, resumen, seccion, texto_extraido,' +
      ' texto_nota_limpia, texto_cuerpo_nota, url_original, fecha_captura, medios(nombre_medio)',
    )
    .in('medio_id', medioIds)
    .gte('fecha_captura', desde)
    .neq('origen_cobertura', 'pressclipping_diagnostico');
  if (error) throw new Error(`No se pudieron leer noticias: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    noticia_id: r.noticia_id,
    medio_id: r.medio_id,
    medio_nombre: r.medios?.nombre_medio ?? null,
    titulo: r.titulo,
    subtitulo: r.subtitulo,
    resumen: r.resumen,
    seccion: r.seccion,
    texto_extraido: r.texto_extraido,
    texto_nota_limpia: r.texto_nota_limpia ?? null,
    texto_cuerpo_nota: r.texto_cuerpo_nota ?? null,
    url_original: r.url_original,
    fecha: r.fecha_captura,
  }));
}

function nombreMedio(medioId: string | null, matches: SimMatch[], noticias: SimNoticia[]): string {
  return (
    matches.find((m) => m.medio_id === medioId)?.medio_nombre ??
    noticias.find((n) => n.medio_id === medioId)?.medio_nombre ??
    medioId ??
    '(?)'
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  logger.info({ ...args }, '[SIM] Iniciando simulación read-only de keywords candidatas');

  const candidatas = loadCandidatas(args.fixture);
  const noticias = await fetchNoticias(args.medioIds, args.windowHours);
  const matches = simulate(noticias, candidatas);

  const utiles = matches.filter((m) => !m.posible_fp);
  const fps = matches.filter((m) => m.posible_fp);

  // ── Métricas globales ──────────────────────────────────────────────────────
  console.log('\n========== SIMULACIÓN — RESUMEN ==========');
  console.log(`candidatas cargadas: ${candidatas.length}`);
  console.log(`noticias analizadas: ${noticias.length}`);
  console.log(`matches simulados totales: ${matches.length}`);
  console.log(`  útiles (no FP): ${utiles.length}`);
  console.log(`  posibles FP: ${fps.length}`);

  // Notas únicas con al menos un match útil
  const notasUtiles = new Set(utiles.map((m) => m.noticia_id)).size;
  console.log(`notas únicas con match útil: ${notasUtiles}`);

  console.log('\n--- matches por medio ---');
  for (const [mid, n] of Object.entries(contarPor(matches, (m) => m.medio_id ?? '(null)')).sort((a, b) => b[1] - a[1])) {
    const u = utiles.filter((m) => (m.medio_id ?? '(null)') === mid).length;
    console.log(`  ${mid} ${nombreMedio(mid, matches, noticias)}: ${n} (útiles ${u})`);
  }

  console.log('\n--- matches por cliente ---');
  for (const [c, n] of Object.entries(contarPor(matches, (m) => m.cliente ?? m.cliente_id ?? '(null)')).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c}: ${n}`);
  }

  console.log('\n--- matches por keyword candidata ---');
  for (const [k, n] of Object.entries(contarPor(matches, (m) => `${m.keyword_id} ${m.keyword}`)).sort((a, b) => b[1] - a[1])) {
    const u = utiles.filter((m) => `${m.keyword_id} ${m.keyword}` === k).length;
    console.log(`  ${k}: ${n} (útiles ${u})`);
  }

  console.log(`\n--- TOP ${args.top} ejemplos (útiles primero) ---`);
  const ordenados = [...matches].sort((a, b) => Number(a.posible_fp) - Number(b.posible_fp) || b.score - a.score);
  for (const m of ordenados.slice(0, args.top)) {
    console.log(JSON.stringify({
      medio: m.medio_nombre, fecha: m.fecha?.slice(0, 10), cliente: m.cliente,
      keyword: m.keyword, tipo: m.tipo_match, campo: m.campo, score: m.score,
      fp: m.posible_fp, razon_fp: m.razon_fp || undefined,
      titulo: (m.titulo ?? '').slice(0, 110), url: m.url,
      extracto: m.texto_match.slice(0, 140),
    }));
  }

  console.log('\n[SIM] FIN — no se insertó ni modificó nada (read-only).');
}

main().catch((err) => {
  logger.error(err, '[SIM] Error fatal');
  process.exit(1);
});
