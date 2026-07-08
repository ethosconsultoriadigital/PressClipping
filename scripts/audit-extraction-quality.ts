/**
 * AUDITORÍA DE CALIDAD DE EXTRACCIÓN — `01_Noticias_Raw` / `02_Menciones`.
 *
 * SOLO LECTURA. Lee `noticias` (con join a `medios`) y `menciones` desde Supabase
 * y calcula métricas de calidad de extracción por medio y globales:
 *   - % título/URL/fecha/medio válidos
 *   - % cuerpo >= 600 / >= 1200 chars, % vacío
 *   - % encoding sospechoso (mojibake), % boilerplate/listing
 *   - duplicados por URL normalizada y por título similar
 *
 * NO modifica 01/02. NO envía nada. NO llama IA. Salida: consola + JSON local
 * opcional en `data/audit-extraction-quality.json` (no commitear `data/`).
 *
 * Uso:
 *   npm run audit-extraction-quality -- [--window-days=90] [--max=5000] [--json]
 */
import 'dotenv/config';
import { writeFileSync, mkdirSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../src/utils/logger.js';
import { canonicalizeUrl } from '../src/normalizers/url.js';
import { foldText } from '../src/matchers/text.js';
import {
  encodingSospechoso,
  pareceBoilerplate,
  pareceListing,
  fechaValida,
  urlValida,
  clasificarExtraccion,
  accionExtraccion,
  medianaChars,
  type ClasifExtraccion,
} from '../src/comparators/extractionQuality.js';

interface Args { windowDays: number; max: number; json: boolean; }

function parseArgs(argv: string[]): Args {
  const out: Args = { windowDays: 90, max: 5000, json: false };
  for (const a of argv) {
    if (a === '--json') { out.json = true; continue; }
    const m = a.match(/^--([\w-]+)=(.*)$/);
    if (!m) continue;
    if (m[1] === 'window-days') out.windowDays = Number(m[2]) || out.windowDays;
    if (m[1] === 'max') out.max = Number(m[2]) || out.max;
  }
  return out;
}

const txt = (v: unknown): string => String(v ?? '').trim();

/** Mejor cuerpo disponible para medir (limpio > cuerpo_nota > extraído). */
function mejorCuerpo(n: any): string {
  return txt(n.texto_nota_limpia) || txt(n.texto_cuerpo_nota) || txt(n.texto_extraido);
}

interface MedioStat {
  medio_id: string;
  medio: string;
  notas: number;
  chars: number[];
  vacias: number;
  encoding: number;
  boilerplate: number;
  listing: number;
  ge600: number;
  ge1200: number;
}

function pct(n: number, total: number): number {
  return total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
}

/** Clasificación de extracción para un medio, a partir de sus contadores. */
function clasificarMedio(st: MedioStat): ClasifExtraccion {
  return clasificarExtraccion({
    notas: st.notas,
    pct_vacias: pct(st.vacias, st.notas),
    pct_boilerplate: pct(st.boilerplate, st.notas),
    pct_texto_600: pct(st.ge600, st.notas),
    pct_texto_1200: pct(st.ge1200, st.notas),
    mediana_chars: medianaChars(st.chars),
  });
}

async function leerNoticias(sb: SupabaseClient, desdeIso: string, max: number): Promise<any[]> {
  const select =
    'noticia_id, medio_id, titulo, url_original, fecha_publicacion, created_at,' +
    ' texto_nota_limpia, texto_cuerpo_nota, texto_extraido, calidad_extraccion,' +
    ' medios(nombre_medio)';
  const page = 1000;
  const acc: any[] = [];
  for (let from = 0; from < max; from += page) {
    const to = Math.min(from + page, max) - 1;
    const { data, error } = await sb
      .from('noticias')
      .select(select)
      .gte('created_at', desdeIso)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw new Error(`No se pudieron leer noticias: ${error.message}`);
    const rows = (data ?? []) as any[];
    acc.push(...rows);
    if (rows.length < to - from + 1) break;
  }
  return acc;
}

async function contarMenciones(sb: SupabaseClient, desdeIso: string): Promise<number> {
  const { count, error } = await sb
    .from('menciones')
    .select('mencion_id', { count: 'exact', head: true })
    .gte('created_at', desdeIso);
  if (error) throw new Error(`No se pudieron contar menciones: ${error.message}`);
  return count ?? 0;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const desde = new Date(Date.now() - args.windowDays * 24 * 3600 * 1000).toISOString();

  const url = process.env['SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) {
    logger.error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }
  const sb = createClient(url, key);

  logger.info({ windowDays: args.windowDays, max: args.max }, '=== Auditoría de calidad de extracción (SOLO LECTURA) ===');

  const [noticias, totalMenciones] = await Promise.all([
    leerNoticias(sb, desde, args.max),
    contarMenciones(sb, desde),
  ]);

  const total = noticias.length;
  const porMedio = new Map<string, MedioStat>();
  let tituloOk = 0, urlOk = 0, fechaOk = 0, medioOk = 0;
  let vacias = 0, encoding = 0, boiler = 0, listing = 0, ge600 = 0, ge1200 = 0;
  const urlNormSeen = new Map<string, number>();
  const tituloSeen = new Map<string, number>();

  for (const n of noticias) {
    const cuerpo = mejorCuerpo(n);
    const chars = cuerpo.length;
    const medioId = txt(n.medio_id) || 'SIN_MEDIO';
    const medioNombre = txt(n.medios?.nombre_medio) || medioId;
    const urlN = txt(n.url_original);

    if (txt(n.titulo)) tituloOk++;
    if (urlValida(urlN)) urlOk++;
    if (fechaValida(n.fecha_publicacion)) fechaOk++;
    if (medioNombre !== 'SIN_MEDIO') medioOk++;

    const esVacia = chars === 0;
    const esEnc = encodingSospechoso(cuerpo);
    const esBoiler = pareceBoilerplate(cuerpo);
    const esListing = pareceListing(urlN);
    if (esVacia) vacias++;
    if (esEnc) encoding++;
    if (esBoiler) boiler++;
    if (esListing) listing++;
    if (chars >= 600) ge600++;
    if (chars >= 1200) ge1200++;

    if (urlN) {
      const cn = canonicalizeUrl(urlN);
      urlNormSeen.set(cn, (urlNormSeen.get(cn) ?? 0) + 1);
    }
    const tn = foldText(txt(n.titulo)).replace(/\s+/g, ' ').trim();
    if (tn) tituloSeen.set(tn, (tituloSeen.get(tn) ?? 0) + 1);

    let st = porMedio.get(medioId);
    if (!st) {
      st = { medio_id: medioId, medio: medioNombre, notas: 0, chars: [], vacias: 0, encoding: 0, boilerplate: 0, listing: 0, ge600: 0, ge1200: 0 };
      porMedio.set(medioId, st);
    }
    st.notas++;
    st.chars.push(chars);
    if (esVacia) st.vacias++;
    if (esEnc) st.encoding++;
    if (esBoiler) st.boilerplate++;
    if (esListing) st.listing++;
    if (chars >= 600) st.ge600++;
    if (chars >= 1200) st.ge1200++;
  }

  const dupUrl = [...urlNormSeen.values()].reduce((a, c) => a + (c > 1 ? c - 1 : 0), 0);
  const dupTitulo = [...tituloSeen.values()].reduce((a, c) => a + (c > 1 ? c - 1 : 0), 0);

  const medios = [...porMedio.values()]
    .map((st) => {
      const clasificacion = clasificarMedio(st);
      return {
        medio_id: st.medio_id,
        medio: st.medio,
        notas: st.notas,
        mediana_chars: medianaChars(st.chars),
        promedio_chars: Math.round(st.chars.reduce((a, c) => a + c, 0) / (st.chars.length || 1)),
        pct_texto_600: pct(st.ge600, st.notas),
        pct_texto_1200: pct(st.ge1200, st.notas),
        pct_vacias: pct(st.vacias, st.notas),
        pct_encoding_sospechoso: pct(st.encoding, st.notas),
        pct_boilerplate: pct(st.boilerplate, st.notas),
        clasificacion_extraccion: clasificacion,
        accion_recomendada: accionExtraccion(clasificacion),
      };
    })
    .sort((a, b) => b.notas - a.notas);

  const resumen = {
    ventana_dias: args.windowDays,
    total_noticias: total,
    total_menciones: totalMenciones,
    pct_titulo_valido: pct(tituloOk, total),
    pct_url_valida: pct(urlOk, total),
    pct_fecha_valida: pct(fechaOk, total),
    pct_medio_valido: pct(medioOk, total),
    pct_texto_600: pct(ge600, total),
    pct_texto_1200: pct(ge1200, total),
    pct_cuerpo_vacio: pct(vacias, total),
    pct_encoding_sospechoso: pct(encoding, total),
    pct_boilerplate: pct(boiler, total),
    pct_listing: pct(listing, total),
    duplicados_url_norm: dupUrl,
    pct_duplicados_url: pct(dupUrl, total),
    duplicados_titulo_similar: dupTitulo,
    pct_duplicados_titulo: pct(dupTitulo, total),
  };

  logger.info(resumen, 'Resumen global de calidad de extracción.');
  const problematicos = medios.filter((m) =>
    ['EXTRACCION_MALA', 'BOILERPLATE', 'SIN_CUERPO', 'REVISAR_MANUAL'].includes(m.clasificacion_extraccion),
  );
  logger.info({ medios_auditados: medios.length, medios_problematicos: problematicos.length }, 'Medios auditados.');
  for (const m of medios.slice(0, 40)) {
    logger.info(
      {
        medio_id: m.medio_id, medio: m.medio, notas: m.notas, mediana_chars: m.mediana_chars,
        pct_texto_600: m.pct_texto_600, pct_vacias: m.pct_vacias,
        pct_encoding: m.pct_encoding_sospechoso, pct_boilerplate: m.pct_boilerplate,
        clasificacion: m.clasificacion_extraccion, accion: m.accion_recomendada,
      },
      '[medio]',
    );
  }

  if (args.json) {
    try {
      mkdirSync('data', { recursive: true });
      writeFileSync('data/audit-extraction-quality.json', JSON.stringify({ resumen, medios }, null, 2), 'utf8');
      logger.info({ archivo: 'data/audit-extraction-quality.json' }, 'JSON escrito (no commitear data/).');
    } catch (e) {
      logger.warn({ error: e instanceof Error ? e.message : String(e) }, 'No se pudo escribir JSON local.');
    }
  }

  logger.info('=== Auditoría de calidad de extracción completada (sin cambios en 01/02) ===');
}

main().catch((err) => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en audit-extraction-quality');
  process.exit(1);
});
