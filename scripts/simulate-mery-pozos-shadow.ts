/**
 * Simulador read-only de detección para CLI-MERY-TEST — Mery Pozos / Merilyn Gómez Pozos.
 *
 * Escanea TODAS las noticias en la ventana indicada (no solo `menciones_procesado=false`)
 * y aplica únicamente las keywords de CLI-MERY-TEST, sin escribir nada en Supabase ni Sheets.
 *
 * Diferencia con detect-mentions --dry-run:
 * - detect-mentions solo ve noticias pendientes (menciones_procesado=false)
 * - simulate-mery-pozos-shadow ve todas las noticias en la ventana, incluso las ya procesadas
 *
 * Uso:
 *   npm run simulate-mery-pozos-shadow                     # ventana 180 días
 *   npm run simulate-mery-pozos-shadow -- --window-days=30 # ventana 30 días
 *   npm run simulate-mery-pozos-shadow -- --window-days=365 --limit=2000
 */
import 'dotenv/config';
import { getSupabase } from '../src/supabase/client.js';
import { getKeywordsActivas, type KeywordActivaRow, type NoticiaScanRow } from '../src/supabase/repositories.js';
import {
  matchKeyword,
  splitTerminos,
  PESOS_CAMPO,
  type KeywordRule,
  type CampoBuscable,
  type TipoKeyword,
} from '../src/matchers/keyword.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

const CLI_ID = 'CLI-MERY-TEST';

const TIPOS_VALIDOS: TipoKeyword[] = ['exacta', 'frase_exacta', 'contiene', 'booleana', 'exacta_contextual'];

function toRule(row: KeywordActivaRow): KeywordRule {
  const tipo = (TIPOS_VALIDOS as string[]).includes(row.tipo_keyword)
    ? (row.tipo_keyword as TipoKeyword)
    : 'contiene';
  return {
    keyword_id: row.keyword_id,
    cliente_id: row.cliente_id,
    keyword: row.keyword,
    terminos: splitTerminos(row.keyword, row.alias_o_variantes),
    tipo,
    regla: row.regla,
    contextoIncluir: splitTerminos(row.contexto_incluir),
    contextoExcluir: splitTerminos(row.contexto_excluir),
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

interface SimArgs { windowDays: number; limit: number; }

function parseArgs(argv: string[]): SimArgs {
  const out: SimArgs = { windowDays: 180, limit: 2000 };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const value = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'window-days') out.windowDays = parseIntOrNull(value) ?? out.windowDays;
    if (key === 'limit') out.limit = parseIntOrNull(value) ?? out.limit;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sb = getSupabase();

  logger.info({ cli: CLI_ID, windowDays: args.windowDays, limit: args.limit }, '=== Simulador Mery Pozos shadow (SOLO LECTURA) ===');

  // ── Cargar keywords de CLI-MERY-TEST ────────────────────────────────────────
  const allKeywords = await getKeywordsActivas();
  const kwRows = allKeywords.filter((k) => k.cliente_id === CLI_ID);
  if (kwRows.length === 0) {
    logger.error({ cli: CLI_ID }, 'No hay keywords activas para CLI-MERY-TEST. Verifica que tune-mery-pozos-shadow fue ejecutado.');
    process.exit(1);
  }
  const reglas = kwRows.map(toRule);
  logger.info({ keywords: reglas.length, ids: kwRows.map((k) => k.keyword_id).join(',') }, 'Keywords Mery Pozos cargadas');

  // ── Leer noticias de la ventana (todas, incluyendo ya procesadas) ─────────
  const fechaDesde = new Date();
  fechaDesde.setDate(fechaDesde.getDate() - args.windowDays);
  const isoDesde = fechaDesde.toISOString();

  const { data: raw, error } = await sb
    .from('noticias')
    .select(
      'noticia_id, medio_id, titulo, subtitulo, resumen, texto_extraido,' +
      ' texto_nota_limpia, texto_cuerpo_nota, seccion, url_original, fecha_publicacion, medios(nombre_medio)',
    )
    .gte('fecha_publicacion', isoDesde)
    .order('fecha_publicacion', { ascending: false })
    .limit(args.limit);

  if (error) { logger.error({ error: error.message }, 'Error leyendo noticias'); process.exit(1); }

  const noticias: (NoticiaScanRow & { url_noticia?: string; fecha_publicacion?: string })[] = (raw ?? []).map((r: any) => ({
    noticia_id: r.noticia_id,
    medio_id: r.medio_id,
    titulo: r.titulo,
    subtitulo: r.subtitulo,
    resumen: r.resumen,
    texto_extraido: r.texto_extraido,
    texto_nota_limpia: r.texto_nota_limpia ?? null,
    texto_cuerpo_nota: r.texto_cuerpo_nota ?? null,
    seccion: r.seccion,
    medio_nombre: r.medios?.nombre_medio ?? null,
    url_noticia: r.url_original ?? null,
    fecha_publicacion: r.fecha_publicacion ?? null,
  }));

  logger.info({ total_noticias: noticias.length, desde: isoDesde }, 'Noticias cargadas para simulación');

  // ── Detección ────────────────────────────────────────────────────────────────
  interface Match {
    noticia_id: string;
    titulo: string | null;
    medio: string | null;
    url: string | null;
    fecha: string | null;
    keyword_id: string;
    keyword: string;
    tipo_match: string;
    campo: string;
    score: number;
    con_texto: boolean;
    extracto: string | null;
  }

  const matches: Match[] = [];
  const kwHits = new Map<string, number>();

  for (const n of noticias) {
    const campos = camposDe(n);
    const tieneCuerpo = n.texto_cuerpo_nota !== null || n.texto_nota_limpia !== null || n.texto_extraido !== null;

    for (const regla of reglas) {
      const res = matchKeyword(regla, campos);
      if (!res) continue;
      matches.push({
        noticia_id: n.noticia_id,
        titulo: n.titulo,
        medio: n.medio_nombre,
        url: n.url_noticia ?? null,
        fecha: n.fecha_publicacion ?? null,
        keyword_id: regla.keyword_id,
        keyword: regla.keyword,
        tipo_match: res.tipo_match,
        campo: res.campo,
        score: res.score,
        con_texto: tieneCuerpo,
        extracto: res.texto_match?.slice(0, 150) ?? null,
      });
      kwHits.set(regla.keyword_id, (kwHits.get(regla.keyword_id) ?? 0) + 1);
    }
  }

  // ── Resumen ──────────────────────────────────────────────────────────────────
  const totalPotenciales = matches.length;
  const conTexto = matches.filter((m) => m.con_texto).length;
  const sinTexto = matches.filter((m) => !m.con_texto).length;
  const kwHitsEntries = Array.from(kwHits.entries()).sort((a, b) => b[1] - a[1]);

  logger.info(
    {
      noticias_analizadas: noticias.length,
      matches_potenciales: totalPotenciales,
      con_texto_cuerpo: conTexto,
      sin_texto_titulo_only: sinTexto,
      keywords_con_hits: kwHits.size,
      keywords_sin_hits: reglas.length - kwHits.size,
    },
    '=== RESUMEN SIMULACIÓN (SOLO LECTURA — NO SE INSERTÓ NADA) ===',
  );

  logger.info({ hits_por_keyword: kwHitsEntries.map(([id, n]) => `${id}:${n}`).join(' | ') }, 'Hits por keyword');

  // Mostrar primeros 20 matches
  const mostrar = matches.slice(0, 20);
  for (const m of mostrar) {
    logger.info(
      {
        keyword: m.keyword,
        keyword_id: m.keyword_id,
        medio: m.medio,
        fecha: m.fecha ? m.fecha.slice(0, 10) : null,
        tipo_match: m.tipo_match,
        campo: m.campo,
        score: m.score,
        con_texto: m.con_texto,
        titulo: m.titulo?.slice(0, 100),
        url: m.url,
        extracto: m.extracto,
      },
      '[simulación] Match potencial',
    );
  }
  if (matches.length > 20) {
    logger.info({ total: matches.length, mostrados: 20 }, '[simulación] Solo se muestran los primeros 20');
  }

  logger.info(
    { insertadas: 0, marcadas_procesadas: 0 },
    '=== FIN — NADA ESCRITO. Solo lectura. ===',
  );
}

main().catch((e) => { console.error(e); process.exit(1); });
