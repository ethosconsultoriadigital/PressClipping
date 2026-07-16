/**
 * Fortalece la captura de MARCA DIRECTA de Patrón (CLI-0002). Idempotente.
 *
 * Gaps confirmados por `audit-patron-brand-keywords` + backtest
 * `simulate-patron-brand-mentions` (0 flood de la regla candidata):
 *   1. KEY-0060 "Tequila Patrón" no cubre el orden invertido "Patrón Tequila".
 *   2. KEY-0015 "Bacardí" no tiene el alias explícito "Bacardí México".
 *   3. NO existe "Patrón" solo: menciones que dicen solo "Patrón" (sin "Tequila"/
 *      "Casa") no se capturan. Se agrega como exacta_contextual con contexto de
 *      marca/tequila y exclusión fuerte de la palabra común (jefe, patrón de
 *      conducta/diseño/consumo, santo patrón, etc.).
 *
 * SOLO toca estas 3 keywords. NO toca la tabla `clientes` ni `alertas_activas`.
 * NO conecta hojas finales. NO envía nada.
 *
 * Uso:
 *   npm run tune-patron-brand-keywords -- --dry
 *   npm run tune-patron-brand-keywords
 */
import 'dotenv/config';
import { getSupabase } from '../src/supabase/client.js';

const CLI_ID = 'CLI-0002';
const CLI_NOMBRE = 'Bebidas alcoholicas';

const CTX_PATRON_MARCA =
  'tequila|Casa Patrón|Casa Patron|Atotonilco|Bacardí|Bacardi|agave|destilería|destileria|' +
  'Consejo Regulador|CRT|denominación de origen|denominacion de origen|John Paul DeJoria|' +
  'spirits|espirituosa|espirituoso|licor|añejo|anejo|reposado|blanco|cristalino';
const EXC_PATRON_COMUN =
  'patrón de conducta|patron de conducta|patrón de comportamiento|patron de comportamiento|' +
  'patrón de consumo|patron de consumo|patrón de diseño|patron de diseno|patrón climático|patron climatico|' +
  'patrón de oro|patron de oro|patrón alimentario|patron alimentario|patrón de sueño|patron de sueno|' +
  'jefe|empleador|patrón-trabajador|relación laboral|relacion laboral|santo patrón|santo patron|' +
  'patrón cultural|patron cultural|el patrón del mal|patrón de medida|patron de medida|patrón de gasto|patron de gasto';

interface KwUpdate { keyword_id: string; patch: Record<string, unknown>; }

/** Actualizaciones de alias sobre keywords existentes (append seguro de variantes). */
const UPDATES: KwUpdate[] = [
  {
    keyword_id: 'KEY-0060', // Tequila Patrón (frase_exacta, alerta=true) — agregar orden invertido
    patch: { alias_o_variantes: 'Tequila Patron|Patrón Tequila|Patron Tequila' },
  },
  {
    keyword_id: 'KEY-0015', // Bacardí (contiene con contexto) — agregar alias país
    patch: { alias_o_variantes: 'Bacardi|Bacardí México|Bacardi Mexico|Bacardí Mexico' },
  },
];

/** Nueva keyword "Patrón" solo, exacta_contextual (no existía). */
const NUEVA_PATRON = {
  keyword_id: 'KEY-0069',
  cliente_id: CLI_ID,
  cliente: CLI_NOMBRE,
  keyword: 'Patrón',
  alias_o_variantes: 'Patron',
  tipo_keyword: 'exacta_contextual',
  activa: true,
  prioridad: 'Alta',
  alerta: true,
  contexto_incluir: CTX_PATRON_MARCA,
  contexto_excluir: EXC_PATRON_COMUN,
  notas: 'Marca directa "Patrón" a secas. exacta_contextual: exige contexto de marca/tequila y ' +
         'excluye la palabra común (jefe, patrón de conducta/diseño/consumo, santo patrón, etc.). ' +
         'Agregada 2026-07-16 para no perder menciones de marca que solo dicen "Patrón".',
};

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();

  const ids = [...UPDATES.map((u) => u.keyword_id), NUEVA_PATRON.keyword_id];
  const { data: antes } = await sb
    .from('keywords')
    .select('keyword_id, cliente_id, keyword, alias_o_variantes, tipo_keyword, alerta')
    .in('keyword_id', ids)
    .order('keyword_id');
  console.log('=== ANTES ===');
  for (const k of antes ?? []) console.log(JSON.stringify(k));

  // Guarda: las keywords a actualizar deben pertenecer a CLI-0002.
  const conflicto = (antes ?? []).filter((k) => k.cliente_id !== CLI_ID);
  if (conflicto.length > 0) {
    console.error('CONFLICTO: alguna keyword pertenece a otro cliente. Abortar.');
    for (const c of conflicto) console.error(`  ${c.keyword_id} → ${c.cliente_id}`);
    process.exit(1);
  }
  // Guarda: KEY-0069 no debe existir con otro cliente.
  const key69 = (antes ?? []).find((k) => k.keyword_id === 'KEY-0069');
  if (key69 && key69.cliente_id !== CLI_ID) {
    console.error(`CONFLICTO: KEY-0069 ya existe con cliente ${key69.cliente_id}. Abortar.`);
    process.exit(1);
  }

  if (dry) {
    console.log('\n[DRY] Updates de alias:');
    for (const u of UPDATES) console.log(`  ${u.keyword_id} → alias_o_variantes = "${u.patch['alias_o_variantes']}"`);
    console.log('\n[DRY] Nueva keyword:');
    console.log(`  ${NUEVA_PATRON.keyword_id} "${NUEVA_PATRON.keyword}" tipo=${NUEVA_PATRON.tipo_keyword} alerta=${NUEVA_PATRON.alerta}`);
    console.log(`     contexto_incluir=${CTX_PATRON_MARCA}`);
    console.log(`     contexto_excluir=${EXC_PATRON_COMUN}`);
    console.log('\n[DRY] No se escribió nada. clientes/alertas_activas NO se tocan.');
    return;
  }

  for (const u of UPDATES) {
    const { error } = await sb.from('keywords').update(u.patch as never).eq('keyword_id', u.keyword_id);
    if (error) { console.error(`UPDATE ${u.keyword_id} error:`, error.message); process.exit(1); }
  }
  const { error: errIns } = await sb.from('keywords').upsert(NUEVA_PATRON as never, { onConflict: 'keyword_id' });
  if (errIns) { console.error('UPSERT KEY-0069 error:', errIns.message); process.exit(1); }

  const { data: despues } = await sb
    .from('keywords')
    .select('keyword_id, cliente_id, keyword, alias_o_variantes, tipo_keyword, contexto_incluir, contexto_excluir, alerta, activa')
    .in('keyword_id', ids)
    .order('keyword_id');
  console.log('\n=== DESPUÉS ===');
  for (const k of despues ?? []) console.log(JSON.stringify(k));
  console.log('\nOK. Marca Patrón reforzada. Solo se tocaron KEY-0060, KEY-0015 y KEY-0069.');
}

main().catch((e) => { console.error(e); process.exit(1); });
