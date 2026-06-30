/**
 * Tuning controlado de keywords nacionales (idempotente).
 *
 * Promueve el paquete mínimo de keywords laborales con señal real, crea keywords
 * P1 de crisis para bebidas alcohólicas, endurece Bacardí anti-FP y deja varias
 * keywords de prueba inactivas (activa=false). Mapea a las columnas reales del
 * esquema: tipo_keyword, activa, prioridad, alerta, contexto_incluir, contexto_excluir.
 *
 * Idempotente: upsert por keyword_id (PK). Reejecutar no duplica ni rompe.
 *
 * Uso:
 *   npm run tune-national-keywords            # aplica (requiere creds Supabase)
 *   npm run tune-national-keywords -- --dry   # solo imprime el plan, no escribe
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

const CLI_LAB = 'CLI-0003';
const CLI_BEB = 'CLI-0002';

const ROWS: KeywordRow[] = [
  // ── Reforma laboral (CLI-0003) — paquete mínimo con señal real ──────────────
  {
    keyword_id: 'KEY-0017', cliente_id: CLI_LAB, cliente: 'Reforma laboral',
    keyword: 'huelga', alias_o_variantes: null, tipo_keyword: 'contiene',
    activa: true, prioridad: 'Alta', alerta: false,
    contexto_incluir: 'laboral|trabajadores|sindicato|contrato colectivo|empresa|STPS|paro|derechos laborales',
    contexto_excluir: 'futbol|fútbol|deportivo|partido|liga|mundial|espectáculos|entretenimiento|actores|actrices|cine|televisión|huelga de hambre',
    notas: 'Keyword nacional laboral; promovida tras simulación en medios nacionales. Gates contra ruido deportes/espectáculos.',
  },
  {
    keyword_id: 'KEY-0018', cliente_id: CLI_LAB, cliente: 'Reforma laboral',
    keyword: 'contrato colectivo', alias_o_variantes: 'contrato colectivo de trabajo', tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: false,
    contexto_incluir: 'laboral|trabajadores|sindicato|empresa|patrón|patron|STPS',
    contexto_excluir: 'futbol|deportivo|entretenimiento',
    notas: 'Keyword nacional laboral; baja probabilidad de ruido.',
  },
  {
    keyword_id: 'KEY-0019', cliente_id: CLI_LAB, cliente: 'Reforma laboral',
    keyword: 'sindicato', alias_o_variantes: 'sindicatos|sindical', tipo_keyword: 'contiene',
    activa: true, prioridad: 'Media', alerta: false,
    contexto_incluir: 'laboral|trabajadores|huelga|contrato colectivo|empresa|patrón|patron|STPS|paro',
    contexto_excluir: 'actores|actrices|artistas|cine|televisión|futbol|fútbol|deportivo|liga|mundial|espectáculos|entretenimiento',
    notas: 'Keyword nacional laboral; gates por posible ruido en espectáculos/deportes (Sindicato de Actores).',
  },
  {
    keyword_id: 'KEY-0020', cliente_id: CLI_LAB, cliente: 'Reforma laboral',
    keyword: 'derechos laborales', alias_o_variantes: null, tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Media', alerta: false,
    contexto_incluir: null,
    contexto_excluir: null,
    notas: 'Sin alias "jornada laboral" para evitar FP de notas no laborales (p.ej. homicidios). frase_exacta da precisión; sin excludes amplios (horario/agenda) que bloquearían notas laborales legítimas.',
  },
  {
    keyword_id: 'KEY-0021', cliente_id: CLI_LAB, cliente: 'Reforma laboral',
    keyword: 'trabajadores', alias_o_variantes: null, tipo_keyword: 'contiene',
    activa: true, prioridad: 'Baja', alerta: false,
    contexto_incluir: 'laboral|huelga|sindicato|contrato colectivo|STPS|derechos laborales|reforma laboral|paro laboral|subcontratación',
    contexto_excluir: 'futbol|deportivo|mundial|clima|accidente|policía|entretenimiento',
    notas: 'Término amplio; solo cuenta con gates fuertes. Baja prioridad, vigilar ruido.',
  },

  // ── Reforma laboral — pruebas INACTIVAS (activa=false; no afectan detección) ──
  {
    keyword_id: 'KEY-0022', cliente_id: CLI_LAB, cliente: 'Reforma laboral',
    keyword: 'STPS', alias_o_variantes: 'Secretaría del Trabajo y Previsión Social', tipo_keyword: 'contiene',
    activa: false, prioridad: 'Media', alerta: false,
    contexto_incluir: 'laboral|trabajo|trabajadores|empleo|sindicato|salario',
    contexto_excluir: 'futbol|deportivo|mundial',
    notas: 'test nacional laboral; no activada aún.',
  },
  {
    keyword_id: 'KEY-0023', cliente_id: CLI_LAB, cliente: 'Reforma laboral',
    keyword: 'Secretaría del Trabajo', alias_o_variantes: 'Secretaria del Trabajo', tipo_keyword: 'frase_exacta',
    activa: false, prioridad: 'Media', alerta: false,
    contexto_incluir: null, contexto_excluir: null,
    notas: 'test nacional laboral; no activada aún.',
  },
  {
    keyword_id: 'KEY-0024', cliente_id: CLI_LAB, cliente: 'Reforma laboral',
    keyword: 'subcontratación', alias_o_variantes: 'subcontratacion', tipo_keyword: 'contiene',
    activa: false, prioridad: 'Baja', alerta: false,
    contexto_incluir: 'laboral|trabajo|empresa|reforma|nómina|nomina',
    contexto_excluir: 'futbol|deportivo',
    notas: 'test nacional laboral; no activada aún.',
  },
  {
    keyword_id: 'KEY-0025', cliente_id: CLI_LAB, cliente: 'Reforma laboral',
    keyword: 'outsourcing', alias_o_variantes: null, tipo_keyword: 'contiene',
    activa: false, prioridad: 'Baja', alerta: false,
    contexto_incluir: 'laboral|trabajo|empresa|reforma|nómina|nomina',
    contexto_excluir: 'futbol|deportivo',
    notas: 'test nacional laboral; no activada aún.',
  },

  // ── Bebidas alcohólicas (CLI-0002) — crisis P1 ───────────────────────────────
  {
    keyword_id: 'KEY-0026', cliente_id: CLI_BEB, cliente: 'Bebidas alcoholicas',
    keyword: 'tequila adulterado', alias_o_variantes: null, tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: 'salud|intoxicación|adulterado|falsificado|clandestino|autoridad|COFEPRIS|decomiso|riesgo sanitario',
    contexto_excluir: 'receta|coctel|cóctel|bar|restaurante|turismo|festival',
    notas: 'P1 crisis de producto; bajo volumen, alto valor reputacional.',
  },
  {
    keyword_id: 'KEY-0027', cliente_id: CLI_BEB, cliente: 'Bebidas alcoholicas',
    keyword: 'bebidas adulteradas', alias_o_variantes: 'bebida adulterada', tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null,
    contexto_excluir: 'bar|restaurante|coctel|cóctel|turismo|festival|receta',
    notas: 'P1 crisis de producto; alto valor reputacional.',
  },
  {
    keyword_id: 'KEY-0028', cliente_id: CLI_BEB, cliente: 'Bebidas alcoholicas',
    keyword: 'alcohol adulterado', alias_o_variantes: 'metanol|alcohol metílico', tipo_keyword: 'frase_exacta',
    activa: true, prioridad: 'Alta', alerta: true,
    contexto_incluir: null,
    contexto_excluir: 'bar|restaurante|coctel|cóctel|turismo|festival|receta',
    notas: 'P1 crisis de producto; alto valor reputacional.',
  },
  {
    // INACTIVA: genérica de alto riesgo de FP (alcoholímetro/operativo). Se deja test.
    keyword_id: 'KEY-0029', cliente_id: CLI_BEB, cliente: 'Bebidas alcoholicas',
    keyword: 'bebidas alcohólicas', alias_o_variantes: null, tipo_keyword: 'contiene',
    activa: false, prioridad: 'Media', alerta: false,
    contexto_incluir: 'industria|producción|produccion|exportación|exportacion|impuesto|IEPS|venta|consumo|regulación|regulacion|mercado',
    contexto_excluir: 'alcoholímetro|alcoholimetro|operativo|conductor|conductores|CURVA|detenido|detenidos|accidente|choque|policía|policia|tránsito|transito|vialidad|bar|restaurante|coctel|cóctel|turismo',
    notas: 'INACTIVA (test). Genérica de alto riesgo de FP por alcoholímetro/operativo; requiere validación antes de activar.',
  },

  // ── Endurecer Bacardí existente (KEY-0015) anti-FP ──────────────────────────
  {
    keyword_id: 'KEY-0015', cliente_id: CLI_BEB, cliente: 'Bebidas alcoholicas',
    keyword: 'Bacardí', alias_o_variantes: 'Bacardi', tipo_keyword: 'contiene',
    activa: true, prioridad: 'Alta', alerta: false,
    contexto_incluir: 'ron|bebidas alcohólicas|bebidas alcoholicas|destilados|marca|industria|comercialización|comercializacion|producción|produccion|exportación|exportacion|spirits|Bacardí México|Bacardi Limited',
    contexto_excluir: 'calle|avenida|av.|colonia|fraccionamiento|plaza|bulevar|boulevard|residencial|privada|apellido|persona|dirección|direccion|domicilio',
    notas: 'Endurecida anti-FP para cobertura nacional; evitar matches por calle/persona/apellido.',
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
    for (const r of ROWS) console.log(`  ${r.keyword_id} ${r.keyword} cli=${r.cliente_id} activa=${r.activa} prio=${r.prioridad} alerta=${r.alerta}`);
    return;
  }

  const { error } = await sb.from('keywords').upsert(ROWS as never[], { onConflict: 'keyword_id' });
  if (error) { console.error('UPSERT error:', error.message); process.exit(1); }

  const { data: after } = await sb
    .from('keywords')
    .select('keyword_id, keyword, cliente_id, cliente, tipo_keyword, activa, prioridad, alerta, contexto_incluir, contexto_excluir, notas')
    .in('keyword_id', ids)
    .order('keyword_id');
  console.log('\n=== DESPUÉS ===');
  for (const k of after ?? []) console.log(JSON.stringify(k));
  console.log(`\nOK. Filas upsertadas: ${ROWS.length}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
