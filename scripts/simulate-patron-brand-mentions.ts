/**
 * Backtest READ-ONLY de menciones de MARCA DIRECTA de Patrón sobre noticias
 * históricas. Aplica el matcher real (keyword.ts) con las keywords de marca /
 * sector / industria de CLI-0002 y clasifica cada match por tipo de señal, para
 * medir cuánta cobertura de marca directa tenemos hoy, qué medios la traen y qué
 * keywords generan ruido. NO escribe nada.
 *
 * Además prueba, de forma AISLADA (sin tocar Supabase), una regla CANDIDATA para
 * "Patrón" solo (exacta_contextual con contexto de marca/tequila y exclusión de
 * palabra común), para estimar cuántas menciones nuevas capturaría y con qué FP.
 *
 * Uso:
 *   npm run simulate-patron-brand-mentions -- --window-days=7
 *   npm run simulate-patron-brand-mentions -- --window-days=30
 */
import 'dotenv/config';
import { getSupabase } from '../src/supabase/client.js';
import { getKeywordsActivas, type KeywordActivaRow, type NoticiaScanRow } from '../src/supabase/repositories.js';
import {
  matchKeyword, splitTerminos, PESOS_CAMPO,
  type KeywordRule, type CampoBuscable, type TipoKeyword,
} from '../src/matchers/keyword.js';
import { foldText } from '../src/matchers/text.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

const CLI_ID = 'CLI-0002';
const TIPOS: TipoKeyword[] = ['exacta', 'frase_exacta', 'contiene', 'booleana', 'exacta_contextual'];

const MARCA = ['patron', 'tequila patron', 'casa patron', 'bacardi', 'atotonilco'];
const CRISIS = ['adulterad', 'clandestin', 'intoxicac', 'metanol', 'decomiso', 'falsific', 'contaminad'];
const INDUSTRIA = ['exportacion', 'arancel', 't-mec', 'tmec', 'comercio', 'denominacion', 'nom-', 'comercam', 'consejo regulador', 'crt', 'ieps', 'industria'];

type TipoSenal = 'MARCA_DIRECTA' | 'SECTOR_CRISIS' | 'INDUSTRIA' | 'OTRO';
function senalDeKeyword(keyword: string): TipoSenal {
  const k = foldText(keyword);
  if (MARCA.some((m) => k.includes(m))) return 'MARCA_DIRECTA';
  if (CRISIS.some((c) => k.includes(c))) return 'SECTOR_CRISIS';
  if (INDUSTRIA.some((i) => k.includes(i))) return 'INDUSTRIA';
  return 'OTRO';
}

function toRule(row: KeywordActivaRow): KeywordRule {
  const tipo = (TIPOS as string[]).includes(row.tipo_keyword) ? (row.tipo_keyword as TipoKeyword) : 'contiene';
  return {
    keyword_id: row.keyword_id, cliente_id: row.cliente_id, keyword: row.keyword,
    terminos: splitTerminos(row.keyword, row.alias_o_variantes), tipo, regla: row.regla,
    contextoIncluir: splitTerminos(row.contexto_incluir), contextoExcluir: splitTerminos(row.contexto_excluir),
  };
}

/** Regla CANDIDATA para "Patrón" solo (aún NO en Supabase) — se prueba aislada. */
const CTX_PATRON_MARCA = 'tequila|Casa Patrón|Casa Patron|Atotonilco|Bacardí|Bacardi|agave|destilería|destileria|Consejo Regulador|CRT|denominación de origen|denominacion de origen|John Paul DeJoria|spirits|espirituos';
const EXC_PATRON_COMUN =
  'patrón de conducta|patron de conducta|patrón de comportamiento|patron de comportamiento|' +
  'patrón de consumo|patron de consumo|patrón de diseño|patron de diseno|patrón climático|patron climatico|' +
  'patrón de oro|patron de oro|patrón alimentario|patron alimentario|patrón de sueño|patron de sueno|' +
  'jefe|empleador|patrón-trabajador|relación laboral|relacion laboral|sindicato|el patrón del mal|santo patrón|santo patron|patrón cultural|patron cultural';
function reglaPatronCandidata(): KeywordRule {
  return {
    keyword_id: 'CAND-PATRON', cliente_id: CLI_ID, keyword: 'Patrón',
    terminos: splitTerminos('Patrón', 'Patrón Tequila|Patron Tequila'),
    tipo: 'exacta_contextual', regla: null,
    contextoIncluir: splitTerminos(CTX_PATRON_MARCA), contextoExcluir: splitTerminos(EXC_PATRON_COMUN),
  };
}

function camposDe(n: NoticiaScanRow): CampoBuscable[] {
  const textoEfectivo = n.texto_cuerpo_nota ?? n.texto_nota_limpia ?? n.texto_extraido ?? '';
  return [
    { nombre: 'titulo', texto: n.titulo ?? '', peso: PESOS_CAMPO.titulo! },
    { nombre: 'subtitulo', texto: n.subtitulo ?? '', peso: PESOS_CAMPO.subtitulo! },
    { nombre: 'resumen', texto: n.resumen ?? '', peso: PESOS_CAMPO.resumen! },
    { nombre: 'seccion', texto: n.seccion ?? '', peso: PESOS_CAMPO.seccion! },
    { nombre: 'texto_extraido', texto: textoEfectivo, peso: PESOS_CAMPO.texto_extraido! },
    { nombre: 'medio', texto: n.medio_nombre ?? '', peso: PESOS_CAMPO.medio! },
  ];
}

interface Args { windowDays: number; limit: number; }
function parseArgs(argv: string[]): Args {
  const out: Args = { windowDays: 7, limit: 2000 };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [k, v] = arg.slice(2).split('=');
    if (k === 'window-days') out.windowDays = parseIntOrNull(v ?? '') ?? out.windowDays;
    if (k === 'limit') out.limit = parseIntOrNull(v ?? '') ?? out.limit;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sb = getSupabase();
  logger.info({ cliente: CLI_ID, windowDays: args.windowDays }, '=== Backtest menciones de marca Patrón (SOLO LECTURA) ===');

  const all = await getKeywordsActivas();
  const reglas = all.filter((k) => k.cliente_id === CLI_ID).map(toRule);
  const candidata = reglaPatronCandidata();

  const isoDesde = new Date(Date.now() - args.windowDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: raw, error } = await sb
    .from('noticias')
    .select('noticia_id, medio_id, titulo, subtitulo, resumen, texto_extraido, texto_nota_limpia, texto_cuerpo_nota, seccion, url_original, fecha_publicacion, medios(nombre_medio)')
    .gte('fecha_publicacion', isoDesde)
    .order('fecha_publicacion', { ascending: false })
    .limit(args.limit);
  if (error) { logger.error({ error: error.message }, 'Error leyendo noticias'); process.exit(1); }

  const noticias = (raw ?? []).map((r: any) => ({
    noticia_id: r.noticia_id, medio_id: r.medio_id, titulo: r.titulo, subtitulo: r.subtitulo,
    resumen: r.resumen, texto_extraido: r.texto_extraido, texto_nota_limpia: r.texto_nota_limpia ?? null,
    texto_cuerpo_nota: r.texto_cuerpo_nota ?? null, seccion: r.seccion, medio_nombre: r.medios?.nombre_medio ?? null,
    url: r.url_original ?? null, fecha: r.fecha_publicacion ?? null,
  }));
  logger.info({ total_noticias: noticias.length, desde: isoDesde }, 'Noticias cargadas');

  const porSenal: Record<TipoSenal, number> = { MARCA_DIRECTA: 0, SECTOR_CRISIS: 0, INDUSTRIA: 0, OTRO: 0 };
  const marcaHits: any[] = [];
  const kwHits = new Map<string, number>();
  let candNuevas = 0;
  const candEjemplos: any[] = [];

  for (const n of noticias) {
    const campos = camposDe(n);
    let yaMatcheoMarcaExistente = false;
    for (const regla of reglas) {
      const res = matchKeyword(regla, campos);
      if (!res) continue;
      const senal = senalDeKeyword(regla.keyword);
      porSenal[senal]++;
      kwHits.set(regla.keyword_id, (kwHits.get(regla.keyword_id) ?? 0) + 1);
      if (senal === 'MARCA_DIRECTA') {
        yaMatcheoMarcaExistente = true;
        marcaHits.push({ medio: n.medio_nombre, fecha: (n as any).fecha?.slice(0, 10), keyword: regla.keyword, titulo: n.titulo?.slice(0, 90), url: (n as any).url });
      }
    }
    // Regla candidata "Patrón": ¿capturaría algo que las keywords actuales NO?
    const candRes = matchKeyword(candidata, campos);
    if (candRes && !yaMatcheoMarcaExistente) {
      candNuevas++;
      if (candEjemplos.length < 15) candEjemplos.push({ medio: n.medio_nombre, titulo: n.titulo?.slice(0, 100), extracto: candRes.texto_match?.slice(0, 120), url: (n as any).url });
    }
  }

  logger.info({ por_senal_matches: porSenal, keywords_con_hits: kwHits.size }, '=== RESUMEN por tipo de señal ===');
  logger.info({ menciones_marca_directa: marcaHits.length, medios: [...new Set(marcaHits.map((m) => m.medio))] }, 'Marca directa detectada (keywords actuales)');
  for (const m of marcaHits.slice(0, 20)) logger.info(m, '[marca directa]');

  logger.info(
    { candidata_patron_solo_nuevas: candNuevas, nota: candNuevas > 0 ? 'la regla candidata "Patrón" capturaría estas menciones que hoy se pierden' : 'la regla candidata no aporta menciones nuevas en esta ventana' },
    '=== Candidata "Patrón" solo (aislada, no en Supabase) ===',
  );
  for (const e of candEjemplos) logger.info(e, '[candidata Patrón — mención nueva]');

  logger.info({ nota: 'SOLO LECTURA — nada escrito.' }, '=== Fin backtest marca ===');
}

main().catch((e) => { console.error(e); process.exit(1); });
