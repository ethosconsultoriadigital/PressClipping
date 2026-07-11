/**
 * Alta de keywords faltantes para CLI-0002 (Patrón/Bacardí/Bebidas alcohólicas)
 * y CLI-0001 (Jumex) — emergencia reemplazo de PressClipping (idempotente).
 *
 * SOLO agrega filas nuevas a `keywords`. NUNCA toca la tabla `clientes` — los
 * clientes ya existen y sus `alertas_activas` NO se modifican (CLI-0001=true,
 * CLI-0002=false, preexistentes; este script no los altera).
 *
 * Motivación: el catálogo de CLI-0002 no tenía "Patrón"/"Tequila Patrón" (marca
 * insignia) ni "Consejo Regulador del Tequila". El catálogo de CLI-0001 (Jumex)
 * solo tenía 3 keywords, faltando las variantes IEPS/regulatorias solicitadas.
 *
 * Diseño de precisión:
 * - "Patrón" a secas NUNCA se usa como keyword (palabra común: jefe/patrón de
 *   diseño). Solo frases específicas ("Tequila Patrón", "Casa Patrón").
 * - "Atotonilco el Alto" (sede de la destilería) usa exacta_contextual con
 *   contexto tequilero obligatorio y exclusión de turismo/pueblo mágico.
 * - "Profeco" y "retiro de producto" (Jumex) usan exacta_contextual con
 *   contexto de bebidas/Jumex y exclusión de ruido de supermercado/promociones.
 *
 * Uso:
 *   npm run tune-patron-jumex-keywords -- --dry   # solo imprime el plan
 *   npm run tune-patron-jumex-keywords            # aplica
 */
import 'dotenv/config';
import { getSupabase } from '../src/supabase/client.js';

interface KeywordRow {
  keyword_id: string;
  cliente_id: string;
  cliente: string;
  keyword: string;
  alias_o_variantes: string | null;
  tipo_keyword: 'exacta' | 'frase_exacta' | 'contiene' | 'booleana' | 'exacta_contextual';
  activa: boolean;
  prioridad: 'Alta' | 'Media' | 'Baja';
  alerta: boolean;
  contexto_incluir: string | null;
  contexto_excluir: string | null;
  notas: string | null;
}

const CLI_0002 = 'CLI-0002';
const CLI_0002_NOMBRE = 'Bebidas alcoholicas';
const CLI_0001 = 'CLI-0001';
const CLI_0001_NOMBRE = 'Jumex';

const CTX_TEQUILA =
  'tequila|agave|destilería|destileria|Patrón|Consejo Regulador|CRT|denominación de origen|' +
  'exportación|IEPS|arancel';
const EXC_TURISMO =
  'pueblo mágico|pueblo magico|turismo|gastronomía|gastronomia|receta|recetas|' +
  'coctel|cóctel|cocteles|cócteles|maridaje|degustación|degustacion|ruta del tequila';

const CTX_JUMEX = 'Jumex|jugos|néctares|nectares|bebidas azucaradas|IEPS';
const EXC_PROMO =
  'Soriana|Julio Regalado|3x2|2x1|4x3|promoción|promocion|descuento|descuentos|' +
  'catálogo|catalogo|supermercado|oferta|ofertas|lonchera';

// KEY-0060..0064: CLI-0002 Patrón/Bacardí/tequila
const KEYWORDS_CLI0002: KeywordRow[] = [
  {
    keyword_id: 'KEY-0060',
    cliente_id: CLI_0002, cliente: CLI_0002_NOMBRE,
    keyword: 'Tequila Patrón',
    alias_o_variantes: 'Tequila Patron',
    tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null, contexto_excluir: null,
    notas: 'Marca insignia. Frase específica: sin ambigüedad ("Patrón" a secas NUNCA se usa solo).',
  },
  {
    keyword_id: 'KEY-0061',
    cliente_id: CLI_0002, cliente: CLI_0002_NOMBRE,
    keyword: 'Casa Patrón',
    alias_o_variantes: 'Casa Patron',
    tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null, contexto_excluir: null,
    notas: 'Nombre de la destilería. Frase específica.',
  },
  {
    keyword_id: 'KEY-0062',
    cliente_id: CLI_0002, cliente: CLI_0002_NOMBRE,
    keyword: 'Atotonilco el Alto',
    alias_o_variantes: null,
    tipo_keyword: 'exacta_contextual',
    activa: true, prioridad: 'Media', alerta: false,
    contexto_incluir: CTX_TEQUILA,
    contexto_excluir: EXC_TURISMO,
    notas: 'Municipio sede de Casa Patrón. Requiere contexto tequilero; excluye turismo/gastronomía.',
  },
  {
    keyword_id: 'KEY-0063',
    cliente_id: CLI_0002, cliente: CLI_0002_NOMBRE,
    keyword: 'Consejo Regulador del Tequila',
    alias_o_variantes: 'CRT',
    tipo_keyword: 'contiene',
    activa: true, prioridad: 'Media', alerta: false,
    contexto_incluir: null, contexto_excluir: null,
    notas: 'Regulador oficial del tequila (análogo a KEY-0014 que ya cubre mezcal).',
  },
  {
    keyword_id: 'KEY-0064',
    cliente_id: CLI_0002, cliente: CLI_0002_NOMBRE,
    keyword: 'IEPS alcohol',
    alias_o_variantes: 'IEPS bebidas alcohólicas|IEPS bebidas alcoholicas',
    tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null, contexto_excluir: null,
    notas: 'Impuesto especial sobre alcohol. Riesgo regulatorio directo para CLI-0002.',
  },
];

// KEY-0065..0068: CLI-0001 Jumex (IEPS + regulatorio)
const KEYWORDS_CLI0001: KeywordRow[] = [
  {
    keyword_id: 'KEY-0065',
    cliente_id: CLI_0001, cliente: CLI_0001_NOMBRE,
    keyword: 'IEPS bebidas azucaradas',
    alias_o_variantes: 'IEPS refrescos|IEPS jugos|IEPS néctares|IEPS nectares',
    tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null, contexto_excluir: null,
    notas: 'Impuesto especial directo a la industria de jugos/refrescos. Distinto de KEY-0009 genérico.',
  },
  {
    keyword_id: 'KEY-0066',
    cliente_id: CLI_0001, cliente: CLI_0001_NOMBRE,
    keyword: 'etiquetado frontal',
    alias_o_variantes: null,
    tipo_keyword: 'exacta_contextual',
    activa: true, prioridad: 'Media', alerta: false,
    contexto_incluir: CTX_JUMEX,
    contexto_excluir: null,
    notas: 'Término genérico (aplica a muchas industrias): exige contexto de jugos/Jumex/bebidas.',
  },
  {
    keyword_id: 'KEY-0067',
    cliente_id: CLI_0001, cliente: CLI_0001_NOMBRE,
    keyword: 'retiro de producto',
    alias_o_variantes: 'recall de producto',
    tipo_keyword: 'exacta_contextual',
    activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: CTX_JUMEX,
    contexto_excluir: null,
    notas: 'Genérico y de alto riesgo reputacional: exige contexto Jumex/jugos para evitar FP de otras industrias.',
  },
  {
    keyword_id: 'KEY-0068',
    cliente_id: CLI_0001, cliente: CLI_0001_NOMBRE,
    keyword: 'Profeco',
    alias_o_variantes: null,
    tipo_keyword: 'exacta_contextual',
    activa: true, prioridad: 'Media', alerta: false,
    contexto_incluir: CTX_JUMEX,
    contexto_excluir: EXC_PROMO,
    notas: 'Profeco a secas dispararía flood (noticias de supermercados/promos). Exige contexto Jumex; excluye promociones.',
  },
];

const KEYWORDS: KeywordRow[] = [...KEYWORDS_CLI0002, ...KEYWORDS_CLI0001];

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();

  const kwIds = KEYWORDS.map((k) => k.keyword_id);
  const { data: kwAntes } = await sb
    .from('keywords')
    .select('keyword_id, keyword, cliente_id, activa')
    .in('keyword_id', kwIds)
    .order('keyword_id');
  console.log('=== KEYWORDS ANTES ===');
  for (const k of kwAntes ?? []) console.log(JSON.stringify(k));
  console.log(`(existentes: ${(kwAntes ?? []).length} / objetivo: ${KEYWORDS.length})`);

  // Guarda de conflicto: ningún keyword_id planeado puede pertenecer a OTRO cliente.
  const conflicto = (kwAntes ?? []).filter((k) => {
    const planeada = KEYWORDS.find((p) => p.keyword_id === k.keyword_id);
    return planeada && k.cliente_id !== planeada.cliente_id;
  });
  if (conflicto.length > 0) {
    console.error('CONFLICTO CRÍTICO: los siguientes keyword_ids ya existen con otro cliente_id:');
    for (const c of conflicto) console.error(`  ${c.keyword_id} → cliente=${c.cliente_id}`);
    console.error('Abortar. No se escribió nada.');
    process.exit(1);
  }

  // Guarda: confirmar que CLI-0001 y CLI-0002 existen (no crear clientes desde aquí).
  const { data: clientesExistentes } = await sb
    .from('clientes')
    .select('cliente_id, alertas_activas')
    .in('cliente_id', [CLI_0001, CLI_0002]);
  const idsExistentes = new Set((clientesExistentes ?? []).map((c) => c.cliente_id));
  if (!idsExistentes.has(CLI_0001) || !idsExistentes.has(CLI_0002)) {
    console.error('CONFLICTO CRÍTICO: CLI-0001 y/o CLI-0002 no existen en la tabla clientes. Abortar.');
    process.exit(1);
  }

  if (dry) {
    console.log('\n[DRY] Plan keywords a insertar:');
    for (const k of KEYWORDS) {
      console.log(`  ${k.keyword_id} [${k.cliente_id}] "${k.keyword}" tipo=${k.tipo_keyword} alerta=${k.alerta}`);
    }
    console.log('\n[DRY] No se escribió nada. clientes NO se toca en ningún modo.');
    return;
  }

  const { error: errKw } = await sb
    .from('keywords')
    .upsert(KEYWORDS as never[], { onConflict: 'keyword_id' });
  if (errKw) { console.error('UPSERT keywords error:', errKw.message); process.exit(1); }

  // Verificación de seguridad: alertas_activas de ambos clientes NO cambió.
  const { data: clientesDespues } = await sb
    .from('clientes')
    .select('cliente_id, alertas_activas')
    .in('cliente_id', [CLI_0001, CLI_0002]);
  console.log('\n=== CLIENTES (verificación, sin cambios esperados) ===');
  for (const c of clientesDespues ?? []) console.log(JSON.stringify(c));

  const { data: kwDespues } = await sb
    .from('keywords')
    .select('keyword_id, cliente_id, keyword, tipo_keyword, activa, alerta')
    .in('keyword_id', kwIds)
    .order('keyword_id');
  console.log('\n=== KEYWORDS DESPUÉS ===');
  for (const k of kwDespues ?? []) console.log(JSON.stringify(k));

  console.log(`\nOK. ${KEYWORDS.length} keywords insertadas/actualizadas. clientes NO modificado.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
