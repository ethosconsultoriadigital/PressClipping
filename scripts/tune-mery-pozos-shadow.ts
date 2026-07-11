/**
 * Alta shadow de CLI-MERY-TEST — Merilyn Gómez Pozos (idempotente).
 *
 * Crea el cliente CLI-MERY-TEST (alertas_activas=false, shadow only) y sus
 * keywords de alta precisión para monitorear a la diputada federal
 * Merilyn Gómez Pozos / Mery Pozos en medios nacionales y de Jalisco.
 *
 * Diseño de precisión:
 * - Nombres completos/compuestos únicos: frase_exacta, alerta=true (P1/P2).
 * - Apodo + apellido compuesto ("Mery Pozos"): frase_exacta, alerta=true.
 * - Nombre con cargo ("diputada Mery Pozos"): frase_exacta, alerta=true.
 * - Variantes amplias ("Merilyn Gómez", "Gómez Pozos"): exacta_contextual,
 *   alerta=false, con contexto político obligatorio anti-homónimos.
 * - Bloqueo de "Pozos" infraestructura: contexto_excluir en variantes amplias.
 *
 * NO toca noticias, menciones, logs ni Sheets. Solo clientes + keywords.
 * alertas_activas = false garantizado; ningún envío posible desde este cliente.
 *
 * Uso:
 *   npm run tune-mery-pozos-shadow            # aplica (requiere creds Supabase)
 *   npm run tune-mery-pozos-shadow -- --dry   # solo imprime el plan, no escribe
 */
import 'dotenv/config';
import { getSupabase } from '../src/supabase/client.js';

// ── Interfaces ────────────────────────────────────────────────────────────────

interface ClienteRow {
  cliente_id: string;
  nombre_cliente: string;
  industria: string | null;
  marcas: string | null;
  competidores: string | null;
  voceros: string | null;
  temas_sensibles: string | null;
  activo: boolean;
  prioridad_ia: string | null;
  alertas_activas: boolean;
  notas: string | null;
}

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

// ── Constantes ────────────────────────────────────────────────────────────────

const CLI_ID = 'CLI-MERY-TEST';
const CLI_NOMBRE = 'Mery Pozos / Merilyn Gómez Pozos';

/** Contexto político que sube confianza en variantes amplias. */
const CTX_POLITICO =
  'diputada|diputado|diputados|federal|Cámara de Diputados|Camara de Diputados|' +
  'Congreso|San Lázaro|San Lazaro|Morena|MC|Movimiento Ciudadano|' +
  'Jalisco|Guadalajara|candidata|candidatura|elección|eleccion|alcaldía|alcaldia|' +
  'presidencia municipal|reforma|iniciativa|comisión|comision|presupuesto|' +
  'legislativa|legislativo|política|politica|político|politico';

/** Excluye homónimos/ruido en variantes amplias: "pozos" infraestructura, entretenimiento. */
const EXC_POZOS_INFRA =
  'pozo artesiano|pozos de agua|pozos petroleros|pozos urbanos|perforación de pozos|' +
  'perforacion de pozos|Pemex|pozos Pemex|agua potable|acuífero|acuifero|' +
  'hidrocarburos|extracción de pozos|extraccion de pozos';

/** Excluye homónimos de "Mery" (entretenimiento, redes, deportes). */
const EXC_MERY_OCI =
  'entretenimiento|espectáculos|espectaculos|actriz|actor|cantante|modelo|' +
  'influencer|youtuber|tiktoker|futbol|fútbol|deportes|partido|liga|cine|televisión|television';

// ── Cliente ───────────────────────────────────────────────────────────────────

const CLIENTE: ClienteRow = {
  cliente_id: CLI_ID,
  nombre_cliente: CLI_NOMBRE,
  industria: 'persona_publica',
  marcas: null,
  competidores: null,
  voceros: 'Merilyn Gómez Pozos|Mery Pozos|Mery Gómez Pozos',
  temas_sensibles: 'candidatura|elección|acusación|denuncia|escándalo|conflicto de interés',
  activo: true,
  prioridad_ia: 'Baja',
  alertas_activas: false,   // SIEMPRE false — shadow only, nunca produce envíos reales
  notas: 'Shadow only. Persona pública: diputada federal Jalisco / Morena. ' +
         'Foco: nacional + Jalisco. alertas_activas=false garantizado. ' +
         'No producción. No envíos reales. No modificar alertas_activas sin autorización explícita.',
};

// ── Keywords ──────────────────────────────────────────────────────────────────
//
// KEY-0040 a KEY-0051: Mery Pozos / Merilyn Gómez Pozos
//
// Tier 1 — Nombre completo / compuesto único (frase_exacta, alerta=true):
//   KEY-0040 "Merilyn Gómez Pozos"
//   KEY-0041 "Mery Pozos"
//   KEY-0042 "Mery Gómez Pozos"
//   KEY-0043 "Merilyn Gomez Pozos" (sin acento)
//   KEY-0044 "Mery Gomez Pozos" (sin acento)
//
// Tier 2 — Con cargo (frase_exacta, alerta=true):
//   KEY-0045 "diputada Mery Pozos"
//   KEY-0046 "diputada Merilyn Gómez"
//   KEY-0047 "diputada federal Merilyn Gómez Pozos"
//
// Tier 3 — Variantes amplias (exacta_contextual, alerta=false, con contexto):
//   KEY-0048 "Merilyn Gómez"   (contexto político)
//   KEY-0049 "Mery Gómez"      (contexto político + excluir entretenimiento)
//   KEY-0050 "Gómez Pozos"     (contexto político + excluir infraestructura)
//   KEY-0051 "Gomez Pozos"     (sin acento, contexto político + excluir infra)

const KEYWORDS: KeywordRow[] = [
  // ── Tier 1 — Nombre completo/compuesto ───────────────────────────────────────
  {
    keyword_id: 'KEY-0040',
    cliente_id: CLI_ID, cliente: CLI_NOMBRE,
    keyword: 'Merilyn Gómez Pozos',
    alias_o_variantes: 'Merilyn Gomez Pozos',
    tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null, contexto_excluir: null,
    notas: 'Nombre completo exacto. Cero ambigüedad. P1/P2 shadow.',
  },
  {
    keyword_id: 'KEY-0041',
    cliente_id: CLI_ID, cliente: CLI_NOMBRE,
    keyword: 'Mery Pozos',
    alias_o_variantes: null,
    tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null, contexto_excluir: null,
    notas: 'Apodo + apellido compuesto. Alta especificidad. P1/P2 shadow.',
  },
  {
    keyword_id: 'KEY-0042',
    cliente_id: CLI_ID, cliente: CLI_NOMBRE,
    keyword: 'Mery Gómez Pozos',
    alias_o_variantes: 'Mery Gomez Pozos',
    tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null, contexto_excluir: null,
    notas: 'Variante con apodo + apellido materno. Alta especificidad.',
  },
  {
    keyword_id: 'KEY-0043',
    cliente_id: CLI_ID, cliente: CLI_NOMBRE,
    keyword: 'Merilyn Gomez Pozos',
    alias_o_variantes: null,
    tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null, contexto_excluir: null,
    notas: 'Nombre completo sin acentos (encoding alt).',
  },
  {
    keyword_id: 'KEY-0044',
    cliente_id: CLI_ID, cliente: CLI_NOMBRE,
    keyword: 'Mery Gomez Pozos',
    alias_o_variantes: null,
    tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Media', alerta: true,
    contexto_incluir: null, contexto_excluir: null,
    notas: 'Apodo + apellidos sin acentos (encoding alt).',
  },
  // ── Tier 2 — Con cargo ────────────────────────────────────────────────────────
  {
    keyword_id: 'KEY-0045',
    cliente_id: CLI_ID, cliente: CLI_NOMBRE,
    keyword: 'diputada Mery Pozos',
    alias_o_variantes: 'Mery Pozos diputada|Mery Pozos, diputada',
    tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null, contexto_excluir: null,
    notas: 'Con cargo explícito. Alta confianza. P1 si acusaciones/crisis.',
  },
  {
    keyword_id: 'KEY-0046',
    cliente_id: CLI_ID, cliente: CLI_NOMBRE,
    keyword: 'diputada Merilyn Gómez',
    alias_o_variantes: 'Merilyn Gómez diputada|diputada Merilyn Gomez|Merilyn Gomez diputada',
    tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null, contexto_excluir: null,
    notas: 'Cargo + nombre parcial. Alta confianza.',
  },
  {
    keyword_id: 'KEY-0047',
    cliente_id: CLI_ID, cliente: CLI_NOMBRE,
    keyword: 'diputada federal Merilyn Gómez Pozos',
    alias_o_variantes: 'diputada federal Merilyn Gomez Pozos',
    tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null, contexto_excluir: null,
    notas: 'Cargo federal completo. Cero ambigüedad. P1 en crisis.',
  },
  // ── Tier 3 — Variantes amplias (monitor, no alerta) ──────────────────────────
  {
    keyword_id: 'KEY-0048',
    cliente_id: CLI_ID, cliente: CLI_NOMBRE,
    keyword: 'Merilyn Gómez',
    alias_o_variantes: 'Merilyn Gomez',
    tipo_keyword: 'exacta_contextual',
    activa: true, prioridad: 'Media', alerta: false,
    contexto_incluir: CTX_POLITICO,
    contexto_excluir: EXC_MERY_OCI,
    notas: 'Nombre parcial: exige contexto político. Monitor (alerta=false).',
  },
  {
    keyword_id: 'KEY-0049',
    cliente_id: CLI_ID, cliente: CLI_NOMBRE,
    keyword: 'Mery Gómez',
    alias_o_variantes: 'Mery Gomez',
    tipo_keyword: 'exacta_contextual',
    activa: true, prioridad: 'Baja', alerta: false,
    contexto_incluir: CTX_POLITICO,
    contexto_excluir: EXC_MERY_OCI,
    notas: 'Apodo + apellido materno: exige contexto político fuerte. Monitor.',
  },
  {
    keyword_id: 'KEY-0050',
    cliente_id: CLI_ID, cliente: CLI_NOMBRE,
    keyword: 'Gómez Pozos',
    alias_o_variantes: 'Gomez Pozos',
    tipo_keyword: 'exacta_contextual',
    activa: true, prioridad: 'Media', alerta: false,
    contexto_incluir: CTX_POLITICO,
    contexto_excluir: EXC_POZOS_INFRA,
    notas: 'Apellido compuesto: exige contexto político; excluye "pozos" infraestructura. Monitor.',
  },
  {
    keyword_id: 'KEY-0051',
    cliente_id: CLI_ID, cliente: CLI_NOMBRE,
    keyword: 'Gomez Pozos',
    alias_o_variantes: null,
    tipo_keyword: 'exacta_contextual',
    activa: true, prioridad: 'Media', alerta: false,
    contexto_incluir: CTX_POLITICO,
    contexto_excluir: EXC_POZOS_INFRA,
    notas: 'Apellido compuesto sin acentos: exige contexto político; excluye "pozos" infra. Monitor.',
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const dry = process.argv.includes('--dry');
  const sb = getSupabase();

  // ── Lectura previa ──────────────────────────────────────────────────────────
  const { data: cliAntes } = await sb
    .from('clientes')
    .select('cliente_id, nombre_cliente, alertas_activas, activo, notas')
    .eq('cliente_id', CLI_ID);
  console.log('=== CLIENTE ANTES ===');
  console.log(cliAntes?.length ? JSON.stringify(cliAntes[0]) : '(no existe aún)');

  const kwIds = KEYWORDS.map((k) => k.keyword_id);
  const { data: kwAntes } = await sb
    .from('keywords')
    .select('keyword_id, keyword, cliente_id, activa, prioridad, alerta')
    .in('keyword_id', kwIds)
    .order('keyword_id');
  console.log('\n=== KEYWORDS ANTES ===');
  for (const k of kwAntes ?? []) console.log(JSON.stringify(k));
  console.log(`(existentes: ${(kwAntes ?? []).length} / objetivo: ${KEYWORDS.length})`);

  // ── Validación de conflictos: ningún KEY-004x puede pertenecer a otro cliente ──
  const conflictoKw = (kwAntes ?? []).filter((k) => k.cliente_id !== CLI_ID);
  if (conflictoKw.length > 0) {
    console.error('CONFLICTO CRÍTICO: los siguientes keyword_ids ya existen con otro cliente_id:');
    for (const c of conflictoKw) console.error(`  ${c.keyword_id} → cliente=${c.cliente_id}`);
    console.error('Abortar. No se escribió nada.');
    process.exit(1);
  }

  // ── Validación de cliente existente: alertas_activas nunca debe ser true ───────
  const cliExistente = (cliAntes ?? [])[0];
  if (cliExistente && cliExistente.alertas_activas === true) {
    console.error('CONFLICTO CRÍTICO: CLI-MERY-TEST ya existe con alertas_activas=true.');
    console.error('Abortar. No se puede sobrescribir sin revisión manual.');
    process.exit(1);
  }

  if (dry) {
    console.log('\n[DRY] Plan cliente:');
    console.log(`  ${CLIENTE.cliente_id} "${CLIENTE.nombre_cliente}" alertas_activas=${CLIENTE.alertas_activas}`);
    console.log('\n[DRY] Plan keywords:');
    for (const k of KEYWORDS) {
      console.log(
        `  ${k.keyword_id} "${k.keyword}" tipo=${k.tipo_keyword} prio=${k.prioridad} alerta=${k.alerta}`,
      );
    }
    console.log('\n[DRY] No se escribió nada.');
    return;
  }

  // ── Upsert cliente ──────────────────────────────────────────────────────────
  const { error: errCli } = await sb
    .from('clientes')
    .upsert(CLIENTE as never, { onConflict: 'cliente_id' });
  if (errCli) { console.error('UPSERT clientes error:', errCli.message); process.exit(1); }

  // ── Upsert keywords ─────────────────────────────────────────────────────────
  const { error: errKw } = await sb
    .from('keywords')
    .upsert(KEYWORDS as never[], { onConflict: 'keyword_id' });
  if (errKw) { console.error('UPSERT keywords error:', errKw.message); process.exit(1); }

  // ── Lectura posterior ───────────────────────────────────────────────────────
  const { data: cliDespues } = await sb
    .from('clientes')
    .select('cliente_id, nombre_cliente, alertas_activas, activo, notas')
    .eq('cliente_id', CLI_ID);
  console.log('\n=== CLIENTE DESPUÉS ===');
  console.log(JSON.stringify(cliDespues?.[0]));

  // Verificación de seguridad: alertas_activas DEBE ser false
  if (cliDespues?.[0]?.alertas_activas !== false) {
    console.error('ERROR CRÍTICO: alertas_activas no es false después del upsert. Abortar.');
    process.exit(1);
  }

  const { data: kwDespues } = await sb
    .from('keywords')
    .select('keyword_id, cliente_id, keyword, tipo_keyword, activa, prioridad, alerta')
    .in('keyword_id', kwIds)
    .order('keyword_id');
  console.log('\n=== KEYWORDS DESPUÉS ===');
  for (const k of kwDespues ?? []) console.log(JSON.stringify(k));

  console.log(`\nOK. Cliente ${CLI_ID} upsertado. Keywords: ${KEYWORDS.length}.`);
  console.log('SEGURIDAD: alertas_activas=false confirmado. Shadow only. Sin envíos posibles.');
}

main().catch((e) => { console.error(e); process.exit(1); });
