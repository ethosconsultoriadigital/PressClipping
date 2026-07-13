/**
 * Afinación acotada de KEY-0063 (Consejo Regulador del Tequila / alias "CRT").
 *
 * Problema: con tipo_keyword=`contiene`, el alias "CRT" matchea notas de
 * tecnología no relacionadas al tequila ("CFE Internet…", "…registro de
 * celulares…", "CRT monitor/display"). FP a nivel de detección.
 *
 * Fix determinístico y mínimo: cambiar KEY-0063 a `exacta_contextual` y exigir
 * contexto tequilero/bebidas (contexto_incluir). Así:
 *   - "Consejo Regulador del Tequila" → PASA (contiene "tequila").
 *   - "CRT del tequila" / "tequila CRT" → PASA (CRT palabra + contexto tequila).
 *   - "CRT monitor" / "CRT display" / "CRT technology" → BLOQUEA (sin contexto).
 *
 * SOLO toca KEY-0063. NO toca `clientes` ni `alertas_activas`. Idempotente.
 *
 * Uso:
 *   npm run tune-crt-keyword -- --dry   # imprime el plan, no escribe
 *   npm run tune-crt-keyword            # aplica
 */
import 'dotenv/config';
import { getSupabase } from '../src/supabase/client.js';

const KEY_ID = 'KEY-0063';
const CLI_ID = 'CLI-0002';

/** Contexto tequilero/bebidas que abre la puerta de "CRT". */
const CONTEXTO_INCLUIR =
  'tequila|agave|mezcal|destilado|destilados|bebida|bebidas|alcohol|alcoholica|alcoholicas|' +
  'licor|licores|denominación de origen|denominacion de origen|consejo regulador|' +
  'industria tequilera|tequilera|espirituosa|espirituosas|NOM-006|NOM-070|COMERCAM';

const UPDATE = {
  tipo_keyword: 'exacta_contextual',
  contexto_incluir: CONTEXTO_INCLUIR,
  notas: 'Afinada 2026-07-13: alias "CRT" pasaba de contiene→exacta_contextual para exigir ' +
         'contexto tequilero (evita FP tech: "CRT monitor/display", "CFE Internet…"). Solo KEY-0063.',
};

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();

  const { data: antes } = await sb
    .from('keywords')
    .select('keyword_id, cliente_id, keyword, alias_o_variantes, tipo_keyword, contexto_incluir, contexto_excluir, activa, alerta')
    .eq('keyword_id', KEY_ID);
  console.log('=== KEY-0063 ANTES ===');
  console.log(antes?.length ? JSON.stringify(antes[0], null, 2) : '(no existe)');

  const fila = (antes ?? [])[0];
  if (!fila) { console.error('KEY-0063 no existe. Abortar (nada escrito).'); process.exit(1); }
  if (fila.cliente_id !== CLI_ID) {
    console.error(`CONFLICTO: KEY-0063 pertenece a ${fila.cliente_id}, no a ${CLI_ID}. Abortar.`);
    process.exit(1);
  }

  if (dry) {
    console.log('\n[DRY] Cambios que se aplicarían a KEY-0063:');
    console.log(`  tipo_keyword: ${fila.tipo_keyword} → ${UPDATE.tipo_keyword}`);
    console.log(`  contexto_incluir: ${fila.contexto_incluir ?? '(vacío)'} → ${UPDATE.contexto_incluir}`);
    console.log('\n[DRY] No se escribió nada. clientes/alertas_activas NO se tocan.');
    return;
  }

  const { error } = await sb.from('keywords').update(UPDATE as never).eq('keyword_id', KEY_ID);
  if (error) { console.error('UPDATE error:', error.message); process.exit(1); }

  const { data: despues } = await sb
    .from('keywords')
    .select('keyword_id, cliente_id, keyword, alias_o_variantes, tipo_keyword, contexto_incluir, activa, alerta')
    .eq('keyword_id', KEY_ID);
  console.log('\n=== KEY-0063 DESPUÉS ===');
  console.log(JSON.stringify(despues?.[0], null, 2));
  console.log('\nOK. KEY-0063 afinada. Solo se tocó esa keyword.');
}

main().catch((e) => { console.error(e); process.exit(1); });
