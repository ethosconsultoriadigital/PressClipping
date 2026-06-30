/**
 * Fix barato KEYWORD_GAP: keywords de T-MEC / comercio exterior (idempotente).
 *
 * Recupera cobertura de notas T-MEC/aranceles/comercio exterior que ya aparecen
 * en medios técnicamente cubiertos (El Economista MED-0001, Forbes MED-0145) pero
 * que Ethos no detectaba por falta de keyword. Asociadas a CLI-0002 (Bebidas
 * alcohólicas) porque el riesgo regulatorio/comercial afecta exportación de
 * tequila/mezcal/destilados; no existe cliente transversal en el esquema.
 *
 * Mapea al esquema REAL de keywords: tipo_keyword, activa, prioridad, alerta,
 * contexto_incluir, contexto_excluir, alias_o_variantes. Todas alerta=false
 * (no son P1). Idempotente: upsert por keyword_id (PK).
 *
 * Uso:
 *   npm run tune-tmec-keywords            # aplica (requiere creds Supabase)
 *   npm run tune-tmec-keywords -- --dry   # solo imprime el plan, no escribe
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

const CLI_BEB = 'CLI-0002';
const CLIENTE = 'Bebidas alcoholicas';

// Gate de exclusión común anti deportes/espectáculos/ruido.
const EXC_DEP = 'futbol|fútbol|mundial|deportes|deportivo|liga|partido|entretenimiento|espectáculos|espectaculos|opinión deportiva|moda';

const ROWS: KeywordRow[] = [
  {
    keyword_id: 'KEY-0030', cliente_id: CLI_BEB, cliente: CLIENTE,
    keyword: 'T-MEC', alias_o_variantes: 'TMEC|T MEC', tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Media', alerta: false,
    contexto_incluir: 'comercio|exportación|exportacion|aranceles|arancel|tratado|Estados Unidos|Canadá|Canada|México|Mexico|industria|bebidas|tequila|mezcal|destilados|agroindustria',
    contexto_excluir: EXC_DEP,
    notas: 'KEYWORD_GAP comercio exterior; recupera cobertura T-MEC en El Economista/Forbes ya crawleados; riesgo regulatorio para exportación de bebidas alcohólicas.',
  },
  {
    keyword_id: 'KEY-0031', cliente_id: CLI_BEB, cliente: CLIENTE,
    keyword: 'aranceles', alias_o_variantes: 'arancel|arancelaria|arancelario|arancelarias|arancelarios', tipo_keyword: 'exacta_contextual',
    activa: true, prioridad: 'Media', alerta: false,
    contexto_incluir: 'comercio|exportación|exportacion|importación|importacion|Estados Unidos|Canadá|Canada|México|Mexico|T-MEC|tratado|industria|bebidas|tequila|mezcal|destilados|agroindustria',
    contexto_excluir: `${EXC_DEP}|compras personales|horóscopo|horoscopo`,
    notas: 'Comercio exterior con gate exacta_contextual para evitar ruido económico genérico; alias arancel/arancelaria.',
  },
  {
    keyword_id: 'KEY-0032', cliente_id: CLI_BEB, cliente: CLIENTE,
    keyword: 'comercio exterior', alias_o_variantes: null, tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Baja', alerta: false,
    contexto_incluir: 'México|Mexico|Estados Unidos|Canadá|Canada|exportación|exportacion|industria|bebidas|tequila|mezcal|destilados|agroindustria|T-MEC|aranceles',
    contexto_excluir: 'deportes|deportivo|entretenimiento|espectáculos|espectaculos',
    notas: 'Baja prioridad; monitoreo sectorial amplio de comercio exterior.',
  },
  {
    keyword_id: 'KEY-0033', cliente_id: CLI_BEB, cliente: CLIENTE,
    keyword: 'exportación de tequila', alias_o_variantes: 'exportaciones de tequila|exportación de mezcal|exportacion de mezcal|exportación de destilados|exportacion de destilados', tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: false,
    contexto_incluir: 'industria|Estados Unidos|comercio|T-MEC|aranceles|Consejo Regulador del Tequila|CRT|denominación de origen|denominacion de origen',
    contexto_excluir: 'turismo|bar|coctel|cóctel|restaurante|receta',
    notas: 'Sectorial alto valor tequila/exportación; gates anti-turismo/coctelería. frase_exacta = alta precisión.',
  },
];

async function main() {
  const dry = process.argv.includes('--dry');
  const ids = ROWS.map((r) => r.keyword_id);
  const sb = getSupabase();

  const { data: before } = await sb
    .from('keywords')
    .select('keyword_id, keyword, cliente_id, activa, prioridad, alerta')
    .in('keyword_id', ids)
    .order('keyword_id');
  console.log('=== ANTES (filas existentes que toca el tuning) ===');
  for (const k of before ?? []) console.log(JSON.stringify(k));
  console.log(`(existentes: ${(before ?? []).length} / objetivo: ${ROWS.length})`);

  if (dry) {
    console.log('\n[DRY] Plan de upsert (no se escribe):');
    for (const r of ROWS) console.log(`  ${r.keyword_id} ${r.keyword} cli=${r.cliente_id} tipo=${r.tipo_keyword} activa=${r.activa} prio=${r.prioridad} alerta=${r.alerta}`);
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
  console.log(`\nOK. Filas upsertadas: ${ROWS.length}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
