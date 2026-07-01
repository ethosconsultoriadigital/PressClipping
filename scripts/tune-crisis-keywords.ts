/**
 * Tuning de keywords de crisis para CLI-0002 Bebidas alcohólicas (idempotente).
 *
 * Cierra el KEYWORD_GAP de crisis de producto (alcohol/tequila/licor/destilados
 * adulterados o clandestinos, metanol, intoxicación, decomiso/aseguramiento,
 * COFEPRIS) detectado al monitorear la crisis de tequila adulterado en Guanajuato.
 *
 * Complementa a las ya existentes KEY-0026 (tequila adulterado), KEY-0027
 * (bebidas adulteradas) y KEY-0028 (alcohol adulterado, que ya incluye metanol
 * como alias). NO las recrea; solo agrega variantes faltantes y refuerza KEY-0026.
 *
 * Diseño de precisión (validado en simulación read-only, 0% FP):
 * - Crisis directa de producto: frase_exacta + alerta=true (P1). Excluye ruido de
 *   coctelería/turismo/gastronomía. No se excluye por ruido cuando el término ya
 *   es "adulterado/clandestino" (auto-contextual).
 * - Términos amplios (intoxicación, decomiso, COFEPRIS): exacta_contextual con
 *   include_terms de bebidas y exclude_terms anti-droga/industrial/farmacéutico.
 * - Autoridad/regulador (decomiso, COFEPRIS): alerta=false (monitor, no P1).
 *
 * Uso:
 *   npm run tune-crisis-keywords            # aplica (requiere creds Supabase)
 *   npm run tune-crisis-keywords -- --dry   # solo imprime el plan, no escribe
 *
 * NO toca noticias, menciones, logs ni Sheets. Solo la tabla keywords.
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

const CLI = 'CLI-0002';
const CLIENTE = 'Bebidas alcoholicas';
// Gate anti coctelería/turismo/gastronomía para crisis directa de producto.
const EXC_OCIO = 'bar|restaurante|coctel|cóctel|turismo|festival|receta|maridaje|cata';

const ROWS: KeywordRow[] = [
  {
    keyword_id: 'KEY-0034', cliente_id: CLI, cliente: CLIENTE,
    keyword: 'licor adulterado', alias_o_variantes: 'licor adulterada|licores adulterados|licor clandestino|licores clandestinos',
    tipo_keyword: 'frase_exacta', activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null, contexto_excluir: EXC_OCIO,
    notas: 'Crisis producto: licor adulterado/clandestino. P1.',
  },
  {
    keyword_id: 'KEY-0035', cliente_id: CLI, cliente: CLIENTE,
    keyword: 'bebidas clandestinas', alias_o_variantes: 'bebida clandestina|alcohol clandestino|bebidas alcohólicas clandestinas|venta clandestina de alcohol',
    tipo_keyword: 'frase_exacta', activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null, contexto_excluir: EXC_OCIO,
    notas: 'Crisis producto: mercado clandestino de bebidas. P1.',
  },
  {
    keyword_id: 'KEY-0036', cliente_id: CLI, cliente: CLIENTE,
    keyword: 'destilados adulterados', alias_o_variantes: 'destilados clandestinos|destilado adulterado|destilado clandestino|mezcal adulterado|mezcal clandestino',
    tipo_keyword: 'frase_exacta', activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null, contexto_excluir: EXC_OCIO,
    notas: 'Crisis producto: destilados/mezcal adulterado o clandestino. P1.',
  },
  {
    keyword_id: 'KEY-0037', cliente_id: CLI, cliente: CLIENTE,
    keyword: 'intoxicación por alcohol', alias_o_variantes: 'intoxicación alcohólica|intoxicacion alcoholica|intoxicados por alcohol|intoxicación por bebidas|intoxicación etílica|intoxicacion etilica|intoxicación por metanol',
    tipo_keyword: 'exacta_contextual', activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: 'alcohol|bebidas|tequila|mezcal|licor|destilados|metanol|Guanajuato|Irapuato|Salamanca|adulterado|clandestino',
    contexto_excluir: 'drogas|estupefacientes|monóxido|monoxido|sobredosis de droga',
    notas: 'Crisis salud: intoxicación por alcohol/metanol; contextual anti-drogas/monóxido. P1.',
  },
  {
    keyword_id: 'KEY-0038', cliente_id: CLI, cliente: CLIENTE,
    keyword: 'decomiso de alcohol', alias_o_variantes: 'decomiso de bebidas|aseguramiento de alcohol|aseguramiento de bebidas|bebidas aseguradas|alcohol asegurado|decomiso de bebidas alcohólicas|aseguran botellas|catean vinatería|catean vinaterías',
    tipo_keyword: 'exacta_contextual', activa: true, prioridad: 'Media', alerta: false,
    contexto_incluir: 'adulterado|clandestino|COFEPRIS|autoridad|Guanajuato|Irapuato|riesgo|metanol|vinatería|vinateria|Fiscalía|Fiscalia',
    contexto_excluir: 'droga|drogas|armas|vehículos|vehiculos|narcótico|narcotico|hidrocarburos|huachicol|combustible',
    notas: 'Acción de autoridad sobre bebidas (decomiso/aseguramiento); alerta=false (monitor).',
  },
  {
    keyword_id: 'KEY-0039', cliente_id: CLI, cliente: CLIENTE,
    keyword: 'COFEPRIS', alias_o_variantes: 'Comisión Federal para la Protección contra Riesgos Sanitarios',
    tipo_keyword: 'exacta_contextual', activa: true, prioridad: 'Media', alerta: false,
    contexto_incluir: 'alcohol|bebidas|tequila|mezcal|destilados|licor|adulterado|clandestino|metanol|decomiso|aseguramiento',
    contexto_excluir: 'vacuna|medicamento|fármaco|farmaco|cosmético|cosmetico|tabaco|suplemento|dispositivo médico',
    notas: 'Regulador con gate de bebidas para evitar ruido de fármacos/cosméticos; alerta=false (monitor).',
  },
  // Refuerzo de KEY-0026: variantes "contaminado / con metanol / apócrifo" + inc permisivo.
  {
    keyword_id: 'KEY-0026', cliente_id: CLI, cliente: CLIENTE,
    keyword: 'tequila adulterado', alias_o_variantes: 'tequila adulterada|tequila contaminado|tequila con metanol|tequila apócrifo|tequila apocrifo|tequila falso',
    tipo_keyword: 'frase_exacta', activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: 'salud|intoxicación|intoxicacion|adulterado|contaminado|falsificado|clandestino|autoridad|COFEPRIS|decomiso|riesgo sanitario|metanol|muertos|fallecidos',
    contexto_excluir: 'receta|coctel|cóctel|bar|restaurante|turismo|festival',
    notas: 'P1 crisis producto; variantes contaminado/con metanol/apócrifo.',
  },
];

async function main() {
  const dry = process.argv.includes('--dry');
  const ids = ROWS.map((r) => r.keyword_id);
  const sb = getSupabase();

  const { data: before } = await sb
    .from('keywords')
    .select('keyword_id, keyword, cliente_id, activa, prioridad, alerta, alias_o_variantes')
    .in('keyword_id', ids)
    .order('keyword_id');
  console.log('=== ANTES (filas existentes que toca el tuning) ===');
  for (const k of before ?? []) console.log(JSON.stringify(k));
  console.log(`(existentes: ${(before ?? []).length} / objetivo: ${ROWS.length})`);

  if (dry) {
    console.log('\n[DRY] Plan de upsert (no se escribe):');
    for (const r of ROWS) console.log(`  ${r.keyword_id} ${r.keyword} cli=${r.cliente_id} tipo=${r.tipo_keyword} prio=${r.prioridad} alerta=${r.alerta}`);
    return;
  }

  const { error } = await sb.from('keywords').upsert(ROWS as never[], { onConflict: 'keyword_id' });
  if (error) { console.error('UPSERT error:', error.message); process.exit(1); }

  const { data: after } = await sb
    .from('keywords')
    .select('keyword_id, cliente_id, cliente, keyword, tipo_keyword, activa, prioridad, alerta, contexto_incluir, contexto_excluir, notas')
    .in('keyword_id', ids)
    .order('keyword_id');
  console.log('\n=== DESPUÉS ===');
  for (const k of after ?? []) console.log(JSON.stringify(k));
  console.log(`\nOK. Filas upsertadas: ${ROWS.length} (6 nuevas + refuerzo KEY-0026).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
