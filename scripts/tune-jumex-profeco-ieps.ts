/**
 * Afinación acotada de KEY-0068 (Profeco, CLI-0001 Jumex).
 *
 * Problema: `contexto_incluir` tenía "IEPS" a secas. El IEPS (Impuesto Especial
 * sobre Producción y Servicios) también aplica a gasolina/diésel/tabaco, no solo
 * a bebidas azucaradas — por eso "Profeco" matcheaba notas de precio de gasolina
 * (FP confirmado: 2 de 9 menciones/7d de CLI-0001 eran de gasolina).
 *
 * Fix determinístico y mínimo: quitar "IEPS" suelto de `contexto_incluir` (dejar
 * solo Jumex/jugos/néctares/bebidas azucaradas, que si son específicos de la
 * categoría) y agregar `contexto_excluir` para gasolina/diésel/combustible como
 * cinturón de seguridad adicional. NO cambia KEY-0065 (IEPS bebidas azucaradas,
 * que ya es una frase completa y no sufre este problema). NO toca Jumex final.
 *
 * Uso:
 *   npm run tune-jumex-profeco-ieps -- --dry   # imprime el plan, no escribe
 *   npm run tune-jumex-profeco-ieps            # aplica
 */
import 'dotenv/config';
import { getSupabase } from '../src/supabase/client.js';

const KEY_ID = 'KEY-0068';
const CLI_ID = 'CLI-0001';

const NUEVO_CONTEXTO_INCLUIR = 'Jumex|jugos|néctares|nectares|bebidas azucaradas';
const NUEVO_CONTEXTO_EXCLUIR =
  'Soriana|Julio Regalado|3x2|2x1|4x3|promoción|promocion|descuento|descuentos|' +
  'catálogo|catalogo|supermercado|oferta|ofertas|lonchera|' +
  'gasolina|diésel|diesel|combustible|combustibles|magna|premium|tabaco|cigarros';

const UPDATE = {
  contexto_incluir: NUEVO_CONTEXTO_INCLUIR,
  contexto_excluir: NUEVO_CONTEXTO_EXCLUIR,
  notas: 'Afinada 2026-07-16: se quitó "IEPS" suelto de contexto_incluir (aplica también a ' +
         'gasolina/tabaco, no solo bebidas azucaradas) — causaba FP en notas de precio de ' +
         'gasolina. Se agregó contexto_excluir para gasolina/diésel/combustible/tabaco.',
};

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();

  const { data: antes } = await sb
    .from('keywords')
    .select('keyword_id, cliente_id, keyword, tipo_keyword, contexto_incluir, contexto_excluir, activa, alerta')
    .eq('keyword_id', KEY_ID);
  console.log('=== KEY-0068 (Profeco) ANTES ===');
  console.log(antes?.length ? JSON.stringify(antes[0], null, 2) : '(no existe)');

  const fila = (antes ?? [])[0];
  if (!fila) { console.error('KEY-0068 no existe. Abortar (nada escrito).'); process.exit(1); }
  if (fila.cliente_id !== CLI_ID) {
    console.error(`CONFLICTO: KEY-0068 pertenece a ${fila.cliente_id}, no a ${CLI_ID}. Abortar.`);
    process.exit(1);
  }

  if (dry) {
    console.log('\n[DRY] Cambios que se aplicarían a KEY-0068:');
    console.log(`  contexto_incluir: "${fila.contexto_incluir}" → "${NUEVO_CONTEXTO_INCLUIR}"`);
    console.log(`  contexto_excluir: "${fila.contexto_excluir}" → "${NUEVO_CONTEXTO_EXCLUIR}"`);
    console.log('\n[DRY] No se escribió nada. Jumex NO se conecta a hoja final. clientes/alertas_activas NO se tocan.');
    return;
  }

  const { error } = await sb.from('keywords').update(UPDATE as never).eq('keyword_id', KEY_ID);
  if (error) { console.error('UPDATE error:', error.message); process.exit(1); }

  const { data: despues } = await sb
    .from('keywords')
    .select('keyword_id, cliente_id, keyword, tipo_keyword, contexto_incluir, contexto_excluir, activa, alerta')
    .eq('keyword_id', KEY_ID);
  console.log('\n=== KEY-0068 DESPUÉS ===');
  console.log(JSON.stringify(despues?.[0], null, 2));
  console.log('\nOK. KEY-0068 afinada. Solo se tocó esa keyword. Jumex sigue en staging (sin hoja final).');
}

main().catch((e) => { console.error(e); process.exit(1); });
