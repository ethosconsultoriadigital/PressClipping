/**
 * Diagnóstico directo por URL de PressClipping.
 *
 * Dado un registro SOLO_PRESSCLIPPING con URL, prueba si Ethos puede extraer
 * esa nota directamente con su extractor HTML normal. Sirve para distinguir
 * si el gap es de descubrimiento/fuente (la URL extrae bien) o de bloqueo/
 * extracción (la URL falla).
 *
 * Uso:
 *   npm run diagnose-url -- --url=<url> --medio="<medio>" --keyword="<keyword>"
 *   npm run diagnose-url -- --url=<url> --keyword="tequila" --save-diagnostic
 *
 * Por default NO inserta nada en Supabase. Con --save-diagnostic guarda la nota
 * marcada como pressclipping_diagnostico (no cuenta como cobertura orgánica).
 *
 * NO corre IA, NO genera XML, NO envía alertas, NO toca 01_Noticias_Raw.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { fetchAndExtract } from '../src/extractors/html.js';
import { canonicalizeUrl } from '../src/normalizers/url.js';
import { foldText } from '../src/matchers/text.js';
import { sha256, hashContenido } from '../src/utils/hash.js';
import { logger } from '../src/utils/logger.js';

interface DiagArgs {
  url?: string;
  medio?: string;
  keyword?: string;
  /** Variantes/alias separados por | para probar además de la keyword. */
  variantes?: string;
  saveDiagnostic: boolean;
  maxChars?: number;
}

function parseArgs(argv: string[]): DiagArgs {
  const out: DiagArgs = { saveDiagnostic: false };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'url':             out.url = val; break;
      case 'medio':           out.medio = val; break;
      case 'keyword':         out.keyword = val; break;
      case 'variantes':       out.variantes = val; break;
      case 'save-diagnostic': out.saveDiagnostic = true; break;
      case 'max-chars':       out.maxChars = Number(val) || undefined; break;
    }
  }
  return out;
}

const fold = (s?: string | null): string => foldText(s ?? '').replace(/\s+/g, ' ').trim();

/** Devuelve un fragmento de ~radio chars alrededor de la 1ª aparición del término (sobre texto original). */
function fragmentoContexto(textoOriginal: string, termino: string, radio = 90): string | null {
  if (!termino) return null;
  const foldDoc = foldText(textoOriginal).replace(/\s+/g, ' ');
  const foldTerm = fold(termino);
  const idx = foldDoc.indexOf(foldTerm);
  if (idx === -1) return null;
  const desde = Math.max(0, idx - radio);
  const hasta = Math.min(foldDoc.length, idx + foldTerm.length + radio);
  return (desde > 0 ? '…' : '') + foldDoc.substring(desde, hasta).trim() + (hasta < foldDoc.length ? '…' : '');
}

/** Determina la razón probable del gap a partir del resultado de extracción. */
function razonProbable(
  ok: boolean,
  cuerpoChars: number,
  contieneKeyword: boolean,
  contieneVariante: boolean,
): string {
  if (!ok) return 'ETHOS_SOURCE_BLOCKED — la URL no se pudo descargar/extraer (bloqueo, 403/timeout, o requiere JS).';
  if (cuerpoChars < 200) return 'ETHOS_EXTRACTION_GAP — descarga OK pero el extractor obtuvo muy poco cuerpo (posible paywall/JS).';
  if (contieneKeyword || contieneVariante) {
    return 'ETHOS_DISCOVERY_GAP — la URL extrae bien y contiene la keyword: el gap es de descubrimiento/fuente, no de extracción. Reparar/agregar la fuente del medio.';
  }
  return 'PC_FALSE_POSITIVE — la URL extrae bien pero el cuerpo NO contiene la keyword: posible falso positivo de PressClipping o término en zona no textual.';
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.url) {
    logger.error({}, 'Debes especificar --url=<url>.');
    process.exit(1);
  }

  logger.info({ url: args.url, medio: args.medio, keyword: args.keyword, saveDiagnostic: args.saveDiagnostic },
    'Diagnóstico de extracción por URL (no cuenta como cobertura orgánica)');

  const extracto = await fetchAndExtract(args.url, { maxChars: args.maxChars });

  const cuerpo = fold(
    (extracto.texto_cuerpo_nota ?? extracto.texto_nota_limpia ?? extracto.texto_extraido ?? '') +
    ' ' + (extracto.titulo ?? ''),
  );
  const kwFold = fold(args.keyword);
  const contieneKeyword = kwFold.length > 0 && cuerpo.includes(kwFold);

  const variantesList = (args.variantes ?? '').split('|').map(v => fold(v)).filter(Boolean);
  const variantePresente = variantesList.find(v => cuerpo.includes(v));
  const contieneVariante = !!variantePresente;

  const cuerpoChars = extracto.cuerpo_nota_chars ?? extracto.texto_cuerpo_nota?.length ?? 0;
  const limpioChars = extracto.texto_limpio_chars ?? extracto.texto_nota_limpia?.length ?? 0;

  const razon = razonProbable(extracto.ok, cuerpoChars, contieneKeyword, contieneVariante);

  // Fragmento de contexto alrededor de la keyword (o de la variante encontrada).
  const textoFull = (extracto.texto_cuerpo_nota ?? extracto.texto_nota_limpia ?? extracto.texto_extraido ?? '') + ' ' + (extracto.titulo ?? '');
  const fragmento = fragmentoContexto(textoFull, contieneKeyword ? (args.keyword ?? '') : (variantePresente ?? ''));

  // Entidades de cliente comunes para señal de relevancia real.
  const entidadesCliente = ['jumex', 'museo jumex', 'grupo jumex', 'tequila', 'mezcal', 'ieps', 'salario minimo', 'reforma laboral'];
  const cuerpoFold = cuerpo;
  const entidadPresente = entidadesCliente.find(e => cuerpoFold.includes(fold(e)));

  console.log('\n=== DIAGNÓSTICO DE EXTRACCIÓN POR URL ===');
  console.log(`  url:                 ${args.url}`);
  console.log(`  medio:               ${args.medio ?? '(no especificado)'}`);
  console.log(`  keyword:             ${args.keyword ?? '(no especificada)'}`);
  console.log(`  http_ok:             ${extracto.ok}`);
  console.log(`  error:               ${extracto.error ?? '-'}`);
  console.log(`  titulo_extraido:     ${extracto.titulo ?? '-'}`);
  console.log(`  metodo_titulo:       ${extracto.metodo_titulo ?? '-'}`);
  console.log(`  metodo_texto:        ${extracto.metodo_texto ?? '-'}`);
  console.log(`  calidad_extraccion:  ${extracto.calidad_extraccion ?? '-'}`);
  console.log(`  texto_limpio_chars:  ${limpioChars}`);
  console.log(`  cuerpo_nota_chars:   ${cuerpoChars}`);
  console.log(`  contiene_keyword:    ${contieneKeyword ? 'SÍ' : 'NO'}`);
  console.log(`  contiene_variante:   ${contieneVariante ? `SÍ (${variantePresente})` : 'NO'}`);
  console.log(`  contiene_entidad:    ${entidadPresente ? `SÍ (${entidadPresente})` : 'NO'}`);
  console.log(`  fragmento_contexto:  ${fragmento ?? '(término no localizado en cuerpo)'}`);
  console.log(`  cuerpo_preview:      ${(extracto.texto_cuerpo_nota ?? extracto.texto_nota_limpia ?? '').substring(0, 200)}`);
  console.log(`\n  RAZÓN PROBABLE:      ${razon}\n`);

  if (!args.saveDiagnostic) {
    logger.info({}, 'Diagnóstico terminado (no se guardó nada). Usa --save-diagnostic para persistir.');
    return;
  }

  // ── Guardar como diagnóstico (no cobertura orgánica) ──────────────────────
  const sb = createClient(process.env['SUPABASE_URL']!, process.env['SUPABASE_SERVICE_ROLE_KEY']!);

  // Resolver medio_id por nombre si se proporcionó
  let medioId: string | null = null;
  if (args.medio) {
    const { data: medio } = await sb
      .from('medios')
      .select('medio_id')
      .ilike('nombre_medio', `%${args.medio}%`)
      .limit(1);
    medioId = medio?.[0]?.medio_id ?? null;
  }

  const urlCanonica = canonicalizeUrl(args.url);
  const row: Record<string, unknown> = {
    medio_id: medioId,
    url_original: args.url,
    url_canonica: urlCanonica,
    titulo: extracto.titulo ?? null,
    resumen: extracto.resumen ?? null,
    texto_extraido: extracto.texto_extraido ?? null,
    texto_nota_limpia: extracto.texto_nota_limpia ?? null,
    extracto_nota_1300: extracto.extracto_nota_1300 ?? null,
    calidad_extraccion: extracto.calidad_extraccion ?? null,
    texto_limpio_chars: limpioChars,
    texto_cuerpo_nota: extracto.texto_cuerpo_nota ?? null,
    extracto_cuerpo_1300: extracto.extracto_cuerpo_1300 ?? null,
    cuerpo_nota_chars: cuerpoChars,
    tipo_nota: extracto.tipo_nota ?? null,
    autor: extracto.autor ?? null,
    seccion: extracto.seccion ?? null,
    imagen_principal: extracto.imagen ?? null,
    hash_url: sha256(urlCanonica),
    hash_contenido: hashContenido(extracto.titulo ?? null, extracto.resumen ?? null),
    fuente_extraccion: 'PRESSCLIPPING_DIAGNOSTIC_URL',
    estado_extraccion: 'diagnostico',
    menciones_procesado: false,
    origen_cobertura: 'pressclipping_diagnostico',
    fuente_comparativo_url: args.url,
    notas: 'Importada desde URL PressClipping para diagnóstico; no contar como cobertura orgánica.',
  };

  const { error } = await sb.from('noticias').insert(row);
  if (error) {
    if (error.message.includes('origen_cobertura') || error.message.includes('fuente_comparativo_url')) {
      logger.error({ error: error.message },
        'Faltan columnas de la migración 0012. Aplica 0012_origen_cobertura.sql en Supabase SQL Editor antes de usar --save-diagnostic.');
      process.exit(1);
    }
    if (error.code === '23505') {
      logger.warn({}, 'La nota ya existe (hash_url duplicado). No se insertó de nuevo.');
      return;
    }
    logger.error({ error: error.message }, 'Error al guardar diagnóstico');
    process.exit(1);
  }
  logger.info({ origen_cobertura: 'pressclipping_diagnostico' },
    'Diagnóstico guardado en noticias (marcado como NO orgánico).');
}

main().catch(err => {
  logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en diagnose-url-extraction');
  process.exit(1);
});
