/**
 * Auditoría READ-ONLY de las keywords de marca/sector de CLI-0002 (Patrón).
 *
 * Clasifica cada keyword activa por tipo de señal (MARCA_DIRECTA / SECTOR_CRISIS
 * / INDUSTRIA / RUIDO) y estima su riesgo de falso positivo, para decidir si
 * falta cobertura de marca directa (Patrón/Bacardí) o si alguna keyword es
 * demasiado amplia. NO escribe nada (Supabase ni Sheets). Sin IA.
 *
 * Uso:
 *   npm run audit-patron-brand-keywords
 */
import 'dotenv/config';
import { getSupabase } from '../src/supabase/client.js';
import { foldText } from '../src/matchers/text.js';
import { logger } from '../src/utils/logger.js';

const CLI_ID = 'CLI-0002';

type TipoSenal = 'MARCA_DIRECTA' | 'SECTOR_CRISIS' | 'INDUSTRIA' | 'RUIDO';

/** Marcas directas del cliente (máxima prioridad editorial). */
const MARCA = ['patron', 'tequila patron', 'casa patron', 'bacardi', 'atotonilco'];
/** Señales de crisis/salud (alerta si hay contexto). */
const CRISIS = ['adulterad', 'clandestin', 'intoxicac', 'metanol', 'decomiso', 'falsific', 'contaminad', 'muert'];
/** Señales de industria/comercio/regulación. */
const INDUSTRIA = ['exportacion', 'arancel', 't-mec', 'tmec', 'comercio', 'denominacion', 'nom-', 'comercam', 'consejo regulador', 'crt', 'ieps', 'industria'];

const fold = (s: string): string => foldText(s);

function clasificarSenal(keyword: string): TipoSenal {
  const k = fold(keyword);
  if (MARCA.some((m) => k.includes(m))) return 'MARCA_DIRECTA';
  if (CRISIS.some((c) => k.includes(c))) return 'SECTOR_CRISIS';
  if (INDUSTRIA.some((i) => k.includes(i))) return 'INDUSTRIA';
  return 'RUIDO';
}

/** Riesgo de FP: alto si es 'contiene' sin contexto, o palabra común. */
function riesgoFp(k: { tipo_keyword: string; contexto_incluir: string | null; keyword: string }): 'ALTO' | 'MEDIO' | 'BAJO' {
  const esComun = /^(patron|tequila|mezcal|agave|aranceles?|comercio exterior|bebidas alcoholicas)$/.test(fold(k.keyword).trim());
  const tieneContexto = Boolean(k.contexto_incluir && k.contexto_incluir.trim().length > 0);
  if (k.tipo_keyword === 'frase_exacta') return 'BAJO';
  if (k.tipo_keyword === 'exacta_contextual' && tieneContexto) return 'BAJO';
  if (k.tipo_keyword === 'contiene' && !tieneContexto) return 'ALTO';
  if (esComun && !tieneContexto) return 'ALTO';
  return 'MEDIO';
}

async function main() {
  const sb = getSupabase();
  logger.info({ cliente: CLI_ID }, '=== Auditoría de keywords de marca Patrón (SOLO LECTURA) ===');

  const { data, error } = await sb
    .from('keywords')
    .select('keyword_id, keyword, alias_o_variantes, tipo_keyword, contexto_incluir, contexto_excluir, prioridad, activa, alerta')
    .eq('cliente_id', CLI_ID)
    .order('keyword_id');
  if (error) { logger.error({ error: error.message }, 'Error leyendo keywords'); process.exit(1); }

  const keywords = (data ?? []) as any[];
  const porSenal: Record<TipoSenal, number> = { MARCA_DIRECTA: 0, SECTOR_CRISIS: 0, INDUSTRIA: 0, RUIDO: 0 };
  const marcaDirecta: string[] = [];

  for (const k of keywords) {
    const senal = clasificarSenal(k.keyword);
    const riesgo = riesgoFp(k);
    porSenal[senal]++;
    if (senal === 'MARCA_DIRECTA') marcaDirecta.push(`${k.keyword_id}:${k.keyword}`);
    logger.info(
      {
        keyword_id: k.keyword_id,
        keyword: k.keyword,
        alias: k.alias_o_variantes,
        match_type: k.tipo_keyword,
        tipo_senal: senal,
        riesgo_fp: riesgo,
        alerta: k.alerta,
        prioridad: k.prioridad,
        activa: k.activa,
        tiene_contexto: Boolean(k.contexto_incluir),
      },
      '[keyword]',
    );
  }

  // ── Cobertura de marca directa esperada ─────────────────────────────────────
  const esperadasMarca = [
    'Tequila Patrón', 'Casa Patrón', 'Patrón', 'Patrón Tequila', 'Patron Tequila',
    'Bacardí', 'Bacardi', 'Bacardí México', 'Atotonilco el Alto',
  ];
  const foldedKw = keywords.flatMap((k) => [fold(k.keyword), ...(k.alias_o_variantes ? String(k.alias_o_variantes).split('|').map(fold) : [])]);
  const faltantesMarca = esperadasMarca.filter((e) => !foldedKw.includes(fold(e)));
  const patronSolo = keywords.find((k) => fold(k.keyword).trim() === 'patron');

  logger.info(
    {
      total_keywords: keywords.length,
      por_senal: porSenal,
      marca_directa_existentes: marcaDirecta,
      marca_directa_faltantes: faltantesMarca,
      patron_solo_existe: Boolean(patronSolo),
      nota_patron_solo: patronSolo
        ? 'existe (verificar que tenga contexto anti-palabra-común)'
        : 'NO existe — brand mentions que solo dicen "Patrón" (sin "Tequila"/"Casa") NO se capturan',
    },
    '=== RESUMEN cobertura de marca directa ===',
  );

  logger.info({ nota: 'SOLO LECTURA — nada modificado.' }, '=== Fin auditoría keywords marca ===');
}

main().catch((e) => { console.error(e); process.exit(1); });
