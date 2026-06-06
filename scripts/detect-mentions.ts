/**
 * Fase 4 — Detección de menciones.
 *
 * Carga las keywords activas y analiza las noticias aún no procesadas. Por cada
 * coincidencia (según la regla de la keyword y sus puertas de contexto) crea una
 * mención. Marca las noticias como procesadas para no reanalizarlas.
 *
 * Uso:  npm run detect-mentions
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

/** Arma los campos buscables de una noticia con sus pesos. */
function camposDe(n: NoticiaScanRow): CampoBuscable[] {
  return [
    { nombre: 'titulo', texto: n.titulo ?? '', peso: PESOS_CAMPO.titulo! },
    { nombre: 'subtitulo', texto: n.subtitulo ?? '', peso: PESOS_CAMPO.subtitulo! },
    { nombre: 'resumen', texto: n.resumen ?? '', peso: PESOS_CAMPO.resumen! },
    { nombre: 'seccion', texto: n.seccion ?? '', peso: PESOS_CAMPO.seccion! },
    { nombre: 'texto_extraido', texto: n.texto_extraido ?? '', peso: PESOS_CAMPO.texto_extraido! },
    { nombre: 'medio', texto: n.medio_nombre ?? '', peso: PESOS_CAMPO.medio! },
  ];
}

async function main() {
  const started = Date.now();
  const config = await getConfigMap();
  const limit = parseIntOrNull(config['max_noticias_por_deteccion']) ?? 500;

  const keywordRows = await getKeywordsActivas();
  const reglas = keywordRows.map(toRule);
  const alertaPorKeyword = new Map(keywordRows.map((k) => [k.keyword_id, k.alerta]));

  const noticias = await getNoticiasPendientes(limit);
  logger.info(
    { keywords: reglas.length, noticias: noticias.length },
    'Iniciando detección de menciones',
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
