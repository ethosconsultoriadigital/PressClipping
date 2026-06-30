/**
 * Fase 4 — Detección de menciones.
 *
 * Carga las keywords activas y analiza las noticias aún no procesadas. Por cada
 * coincidencia (según la regla de la keyword y sus puertas de contexto) crea una
 * mención. Marca las noticias como procesadas para no reanalizarlas.
 *
 * Uso:
 *   npm run detect-mentions                        # real, todas las pendientes
 *   npm run detect-mentions -- --limit=70          # real, limitado
 *   npm run detect-mentions -- --dry-run           # no inserta ni marca
 *   npm run detect-mentions -- --limit=70 --dry-run
 *   npm run detect-mentions -- --limit=50 --only-with-text          # solo noticias con texto_cuerpo_nota
 *   npm run detect-mentions -- --limit=50 --only-with-text --dry-run
 *   npm run detect-mentions -- --medio-ids=MED-0030,MED-0008 --only-with-text --dry-run  # aislado por medio
 */
import {
  getConfigMap,
  getKeywordsActivas,
  getNoticiasPendientes,
  insertMenciones,
  markNoticiasProcesadas,
  type KeywordActivaRow,
  type NoticiaScanRow,
  type MencionInsert,
} from '../src/supabase/repositories.js';
import {
  matchKeyword,
  splitTerminos,
  PESOS_CAMPO,
  type KeywordRule,
  type CampoBuscable,
  type TipoKeyword,
} from '../src/matchers/keyword.js';
import { writeIngestaLog } from '../src/logs/ingestaLogger.js';
import { logger } from '../src/utils/logger.js';
import { parseIntOrNull } from '../src/utils/parse.js';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface DetectArgs {
  dryRun: boolean;
  limit?: number;
  /** Solo analizar noticias que ya tienen texto_cuerpo_nota (evita marcar noticias sin texto). */
  onlyWithText?: boolean;
  /** Incluir notas diagnósticas de PressClipping (por defecto se excluyen, no son cobertura orgánica). */
  includeDiagnostic?: boolean;
  /** Aísla la detección a estos medio_id (no mezcla backlog global). */
  medioIds?: string[];
}

function splitList(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

function parseArgs(argv: string[]): DetectArgs {
  const out: DetectArgs = { dryRun: false };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const value = eq === -1 ? '' : body.slice(eq + 1);
    if (key === 'dry-run') out.dryRun = true;
    if (key === 'only-with-text') out.onlyWithText = true;
    if (key === 'include-diagnostic') out.includeDiagnostic = true;
    if (key === 'limit') out.limit = parseIntOrNull(value) ?? undefined;
    if (key === 'medio-ids') out.medioIds = splitList(value);
  }
  return out;
}

const TIPOS_VALIDOS: TipoKeyword[] = [
  'exacta',
  'frase_exacta',
  'contiene',
  'booleana',
  'exacta_contextual',
];

/** Convierte una fila de keyword en la regla que entiende el matcher. */
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

/**
 * Arma los campos buscables de una noticia con sus pesos.
 *
 * Prioridad de texto para el campo principal:
 *   texto_cuerpo_nota > texto_nota_limpia > texto_extraido
 *
 * - `texto_cuerpo_nota`: cuerpo puro, sin encabezado editorial. Máxima calidad.
 * - `texto_nota_limpia`: sin ruido fuerte de menú/nav, pero incluye autor/fecha.
 * - `texto_extraido`: fallback raw, puede tener ruido de relacionadas/footer.
 */
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();

  const config = await getConfigMap();
  const configLimit = parseIntOrNull(config['max_noticias_por_deteccion']) ?? 500;
  const limit = args.limit ?? configLimit;

  logger.info(
    { dryRun: args.dryRun, limit, onlyWithText: args.onlyWithText ?? false, includeDiagnostic: args.includeDiagnostic ?? false, medioIds: args.medioIds ?? null },
    'Iniciando detección de menciones',
  );

  const keywordRows = await getKeywordsActivas();
  const reglas = keywordRows.map(toRule);
  const alertaPorKeyword = new Map(keywordRows.map((k) => [k.keyword_id, k.alerta]));

  const noticias = await getNoticiasPendientes({
    limit,
    onlyWithText: args.onlyWithText,
    excludeDiagnostic: !args.includeDiagnostic,
    medioIds: args.medioIds,
  });
  logger.info(
    { keywords: reglas.length, noticias: noticias.length },
    'Noticias pendientes cargadas',
  );

  if (reglas.length === 0) {
    logger.warn('No hay keywords activas; no se detectarán menciones.');
  }

  const menciones: MencionInsert[] = [];
  for (const noticia of noticias) {
    const campos = camposDe(noticia);
    for (const regla of reglas) {
      const res = matchKeyword(regla, campos);
      if (!res) continue;
      menciones.push({
        noticia_id: noticia.noticia_id,
        cliente_id: regla.cliente_id,
        keyword_id: regla.keyword_id,
        keyword: regla.keyword,
        texto_match: res.texto_match,
        tipo_match: res.tipo_match,
        score_relevancia: res.score,
        requiere_alerta: alertaPorKeyword.get(regla.keyword_id) ?? false,
        estado_revision: 'pendiente',
      });
    }
  }

  if (args.dryRun) {
    // Dry-run: mostrar resultado sin escribir en Supabase
    logger.info(
      {
        analizadas: noticias.length,
        menciones_potenciales: menciones.length,
        keywords_activas: reglas.length,
        usandoCuerpo: noticias.filter((n) => n.texto_cuerpo_nota !== null).length,
        usandoTextoLimpio: noticias.filter((n) => n.texto_cuerpo_nota === null && n.texto_nota_limpia !== null).length,
        usandoFallback: noticias.filter((n) => n.texto_cuerpo_nota === null && n.texto_nota_limpia === null && n.texto_extraido !== null).length,
        sinTexto: noticias.filter((n) => n.texto_cuerpo_nota === null && n.texto_nota_limpia === null && n.texto_extraido === null).length,
      },
      '[dry-run] Resumen — no se insertó nada ni se marcó ninguna noticia',
    );

    // Mostrar top menciones (máx 10)
    const top = menciones.slice(0, 10);
    for (const m of top) {
      const noticia = noticias.find((n) => n.noticia_id === m.noticia_id);
      // Determinar en qué campo se detectó el match
      const campoMatch = (() => {
        if (noticia) {
          const campos = camposDe(noticia);
          for (const c of campos) {
            if (c.texto && m.texto_match && c.texto.includes(m.texto_match.slice(0, 20))) {
              return c.nombre;
            }
          }
        }
        return 'desconocido';
      })();

      logger.info(
        {
          noticia_id: m.noticia_id,
          titulo: noticia?.titulo ?? '(sin título)',
          medio: noticia?.medio_nombre ?? '(desconocido)',
          keyword: m.keyword,
          tipo_match: m.tipo_match,
          score: m.score_relevancia,
          campo_match: campoMatch,
          usaTextoLimpio: noticia?.texto_nota_limpia !== null,
          extracto_match: m.texto_match?.slice(0, 200) ?? null,
        },
        '[dry-run] Mención potencial',
      );
    }

    if (menciones.length > 10) {
      logger.info(
        { total: menciones.length, mostradas: 10 },
        '[dry-run] Solo se muestran las primeras 10 menciones',
      );
    }
    return;
  }

  // Modo real: insertar y marcar
  const insertadas = await insertMenciones(menciones);
  await markNoticiasProcesadas(noticias.map((n) => n.noticia_id));

  await writeIngestaLog({
    accion: 'detect_mentions',
    nivel: 'info',
    mensaje: `${insertadas} menciones de ${noticias.length} noticias analizadas`,
    urls_detectadas: noticias.length,
    notas_nuevas: insertadas,
    duracion_ms: Date.now() - started,
  });

  logger.info(
    { analizadas: noticias.length, menciones: insertadas },
    'Detección de menciones completada.',
  );
}

main().catch((err) => {
  logger.error(err, 'Error fatal en detect-mentions.');
  process.exit(1);
});
