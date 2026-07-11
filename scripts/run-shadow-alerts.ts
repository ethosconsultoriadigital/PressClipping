/**
 * ALERTAS SOMBRA (shadow alerts) — simulación SIN envíos reales.
 *
 * Lee menciones ya detectadas (Supabase, solo lectura) dentro de una ventana
 * móvil, aplica reglas DETERMINÍSTICAS (sin IA) y registra los candidatos de
 * alerta en `10_Alertas_Sombra` (append histórico). NUNCA envía WhatsApp/correo,
 * NUNCA llama Twilio/Gmail/SMTP, NUNCA toca producción.
 *
 * Por default es seguro: dry-run, sin envío, sin whatsapp, sin email.
 * Cualquier intento de --send / --whatsapp / --email aborta con exit 2.
 *
 * Uso:
 *   npm run shadow-alerts -- --window-hours=48 --output=sheet \
 *     --dry-run --no-send --no-whatsapp --no-email
 */
import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { logger } from '../src/utils/logger.js';
import {
  verificarFlagsAlertasSombra,
  verificarAllowlistShadow,
  verificarEnvObservacion,
  parseShadowClientAllowlist,
} from '../src/utils/shadowGuard.js';
import { ventanaMovil } from '../src/utils/dateWindow.js';
import { OUTPUT_TABS, getOutputTab, withSheetsRetry } from '../src/sheets/client.js';
import { appendHistoryRows, ensureOutputHeaders, type OutRow } from '../src/sheets/write.js';
import {
  evaluarLote,
  normalizarValoracion,
  camposObservabilidad,
  ALERTAS_SOMBRA_HEADERS,
  type MencionAlertaInput,
  type CandidatoAlertaSombra,
} from '../src/alerts/shadowAlertRules.js';
import { computeClusterFields } from '../src/notifications/grouping.js';

/** Pestaña de salida (solo-append) para alertas sombra. */
const ALERTAS_TAB = '10_Alertas_Sombra';

interface AlertArgs {
  windowHours: number;
  output: 'console' | 'sheet';
  runId: string;
  /** Clientes con alertas_activas=false permitidos SOLO en shadow/dry-run. */
  shadowClientAllowlist: string[];
  /** Modo observación: fuerza output=sheet y registra trazabilidad sin envío. */
  observeOnly: boolean;
  /** Trazabilidad para 10.notas (workflow/tier/fuente que dispara la observación). */
  workflowLabel?: string;
  tierLabel?: string;
  fuente?: string;
}

function parseArgs(argv: string[]): AlertArgs {
  const out: AlertArgs = {
    windowHours: 48,
    output: 'sheet',
    runId: `SA-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    shadowClientAllowlist: parseShadowClientAllowlist(argv),
    observeOnly: false,
  };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'window-hours': out.windowHours = Number(val) || out.windowHours; break;
      case 'output':       out.output = (val as 'console' | 'sheet') || out.output; break;
      case 'run-id':       out.runId = val || out.runId; break;
      case 'observe-only': out.observeOnly = true; break;
      case 'workflow-label': out.workflowLabel = val || out.workflowLabel; break;
      case 'tier-label':   out.tierLabel = val || out.tierLabel; break;
      case 'fuente':       out.fuente = val || out.fuente; break;
      case 'shadow-client-allowlist': break; // ya parseado arriba (parseShadowClientAllowlist)
      // Confirmaciones seguras (no habilitan nada): se aceptan tal cual.
      case 'dry-run': case 'no-send': case 'no-whatsapp': case 'no-email':
      case 'no-correos': case 'no-twilio': case 'no-gmail': case 'no-smtp':
        break;
    }
  }
  // --dry-run fuerza output=console para no escribir en 10_Alertas_Sombra.
  // --observe-only tiene precedencia sobre --dry-run (observe-only siempre escribe a sheet).
  if (!out.observeOnly && argv.some((a) => a === '--dry-run')) out.output = 'console';
  // El modo observación SIEMPRE escribe a la pestaña 10 (nunca console).
  if (out.observeOnly) out.output = 'sheet';
  return out;
}

const txt = (v: unknown): string => String(v ?? '').trim();

/** ¿El estado_revision sugiere un falso positivo? */
function esFalsoPositivo(estadoRevision: unknown): boolean {
  return txt(estadoRevision).toLowerCase().includes('falso');
}

/** Mapa keyword_id → {activa, alerta, prioridad} (incluye inactivas). */
async function cargarKeywords(
  sb: SupabaseClient,
): Promise<Map<string, { activa: boolean; alerta: boolean; prioridad: string | null }>> {
  const { data, error } = await sb
    .from('keywords')
    .select('keyword_id, activa, alerta, prioridad');
  if (error) throw new Error(`No se pudieron leer keywords: ${error.message}`);
  const map = new Map<string, { activa: boolean; alerta: boolean; prioridad: string | null }>();
  for (const k of (data ?? []) as any[]) {
    map.set(k.keyword_id, {
      activa: k.activa !== false,
      alerta: k.alerta === true,
      prioridad: k.prioridad ?? null,
    });
  }
  return map;
}

/** Lee menciones detectadas recientemente (created_at >= desde), con joins. */
async function cargarMencionesRecientes(
  sb: SupabaseClient,
  desdeIso: string,
): Promise<any[]> {
  const select =
    'mencion_id, noticia_id, cliente_id, keyword, keyword_id, sentimiento,' +
    ' score_relevancia, requiere_alerta, estado_revision, tema, created_at,' +
    ' clientes(nombre_cliente, activo, alertas_activas, temas_sensibles),' +
    ' noticias!inner(titulo, url_original, fecha_publicacion,' +
    ' medios(nombre_medio, prioridad, activo))';
  const { data, error } = await sb
    .from('menciones')
    .select(select)
    .gte('created_at', desdeIso)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) throw new Error(`No se pudieron leer menciones recientes: ${error.message}`);
  return (data ?? []) as any[];
}

function aInput(
  m: any,
  keywords: Map<string, { activa: boolean; alerta: boolean; prioridad: string | null }>,
  allowlist: Set<string> = new Set(),
): MencionAlertaInput {
  const kw = m.keyword_id ? keywords.get(m.keyword_id) : undefined;
  const temasSensibles = txt(m.clientes?.temas_sensibles).toLowerCase();
  const tema = txt(m.tema);
  const keywordTxt = txt(m.keyword);
  const temaReputacional =
    temasSensibles !== '' &&
    ((keywordTxt !== '' && temasSensibles.includes(keywordTxt.toLowerCase())) ||
      (tema !== '' && temasSensibles.includes(tema.toLowerCase())));

  return {
    mencion_id: m.mencion_id ?? null,
    noticia_id: m.noticia_id ?? null,
    cliente_id: m.cliente_id ?? null,
    cliente: m.clientes?.nombre_cliente ?? null,
    fecha_publicacion: m.noticias?.fecha_publicacion ?? null,
    medio: m.noticias?.medios?.nombre_medio ?? null,
    titulo: m.noticias?.titulo ?? null,
    url: m.noticias?.url_original ?? null,
    keyword: m.keyword ?? null,
    grupo_tema: m.tema ?? null,
    sentimiento: m.sentimiento ?? null,
    valoracion: m.score_relevancia ?? null,
    prioridad_medio: m.noticias?.medios?.prioridad ?? null,
    cliente_activo: m.clientes?.activo !== false,
    cliente_alertas_activas: m.clientes?.alertas_activas !== false,
    keyword_activa: kw ? kw.activa : true,
    keyword_alerta: kw ? kw.alerta : false,
    keyword_prioridad: kw?.prioridad ?? null,
    tema_reputacional: temaReputacional,
    es_falso_positivo: esFalsoPositivo(m.estado_revision),
    requiere_alerta: m.requiere_alerta === true,
    permitir_shadow_cliente_inactivo: allowlist.has(txt(m.cliente_id)),
  };
}

interface TrazaObservacion {
  workflow?: string;
  tier?: string;
  fuente?: string;
  allowlist?: string[];
}

/** Campos de cluster para un candidato (estables y auditables). */
function clusterDe(c: CandidatoAlertaSombra) {
  return computeClusterFields({
    cliente_id: c.cliente_id ?? '',
    keyword: c.keywords_detectadas || c.keyword || '',
    titulo: c.titulo ?? '',
    razon: `${c.regla_disparo ?? ''} ${c.grupo_tema ?? ''}`,
    fecha_publicacion: c.fecha_publicacion ?? '',
  });
}

function aFilaSheet(
  c: CandidatoAlertaSombra,
  runId: string,
  fecha: string,
  traza: TrazaObservacion = {},
  clusterCountById: Map<string, number> = new Map(),
): OutRow {
  // Trazabilidad y no-envío se preservan en `notas` como tokens clave=valor
  // (sin cambiar el esquema de headers de 10_Alertas_Sombra).
  const notas = [
    'modo=shadow',
    'sin_envios_reales', 'sin_whatsapp', 'sin_email', 'sin_twilio', 'sin_gmail_smtp',
    'sin_envio=true',
    `requiere_alerta=${c.requiere_alerta === true}`,
  ];
  if (c.permitir_shadow_cliente_inactivo === true) {
    notas.push('cliente_alertas_inactivas_permitido_por_shadow_allowlist');
  }
  if (traza.allowlist && traza.allowlist.length > 0) notas.push(`shadow_client_allowlist=${traza.allowlist.join(',')}`);
  if (traza.workflow) notas.push(`workflow=${traza.workflow}`);
  if (traza.tier) notas.push(`tier=${traza.tier}`);
  if (traza.fuente) notas.push(`fuente=${traza.fuente}`);
  if (c.keywords_detectadas) notas.push(`keywords_detectadas=${c.keywords_detectadas}`);

  const obs = camposObservabilidad(c.estado_shadow);
  const cl = clusterDe(c);
  const clusterCount = clusterCountById.get(cl.cluster_id) ?? 1;

  return {
    run_id: runId,
    fecha_ejecucion: fecha,
    modo: 'shadow',
    cliente_id: c.cliente_id ?? '',
    cliente: c.cliente ?? '',
    mencion_id: c.mencion_id ?? '',
    noticia_id: c.noticia_id ?? '',
    fecha_publicacion: c.fecha_publicacion ?? '',
    medio: c.medio ?? '',
    titulo: c.titulo ?? '',
    url: c.url ?? '',
    keyword: c.keyword ?? '',
    grupo_tema: c.grupo_tema ?? '',
    sentimiento: c.sentimiento ?? '',
    valoracion: c.valoracion == null ? '' : String(normalizarValoracion(c.valoracion)),
    prioridad_medio: c.prioridad_medio ?? '',
    tipo_alerta_simulada: c.tipo_alerta_simulada,
    canal_simulado: c.canal_simulado,
    habria_alerta: c.habria_alerta,
    motivo_alerta: c.motivo_alerta,
    motivo_bloqueo: c.motivo_bloqueo,
    regla_disparo: c.regla_disparo,
    dedupe_key: c.dedupe_key,
    estado_shadow: c.estado_shadow,
    notas: notas.join('; '),
    // ── Observabilidad explícita ──
    prioridad_alerta: obs.prioridad_alerta,
    es_p1: obs.es_p1,
    es_p2: obs.es_p2,
    estado_alerta: obs.estado_alerta,
    es_duplicada: obs.es_duplicada,
    cluster_id: cl.cluster_id,
    cluster_key: cl.cluster_key,
    cluster_tema: cl.cluster_tema,
    cluster_region: cl.cluster_region,
    cluster_count: clusterCount,
    sin_envio: true,
    canal: c.canal_simulado,
    workflow: traza.workflow ?? '',
    tier: traza.tier ?? '',
    fuente: traza.fuente ?? '',
    shadow_client_allowlist: (traza.allowlist ?? []).join(','),
    send_enabled: false,
    whatsapp_enabled: false,
    email_enabled: false,
  };
}

/** Llave de fila para anti-duplicado en reintentos del MISMO run. */
function llaveFila(runId: string, mencionId: unknown, dedupeKey: string, idx: number): string {
  const mid = txt(mencionId);
  return `${runId}::${mid || `${dedupeKey}#${idx}`}`;
}

/**
 * Lee llaves ya presentes en 10 (run_id::mencion_id) para no re-escribir si el
 * MISMO run se reintenta. Usa mencion_id (no dedupe_key) para no colapsar las
 * filas DUPLICADA, que comparten dedupe_key con su fila primaria.
 */
async function leerLlavesExistentes(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const tab = await getOutputTab(ALERTAS_TAB);
    await withSheetsRetry(() => tab.loadHeaderRow(), `loadHeaderRow ${ALERTAS_TAB}`);
    const rows = await withSheetsRetry(() => tab.getRows(), `getRows ${ALERTAS_TAB}`);
    for (const r of rows) {
      const mid = txt(r.get('mencion_id'));
      if (mid) set.add(`${txt(r.get('run_id'))}::${mid}`);
    }
  } catch {
    // La pestaña aún no existe: no hay llaves previas.
  }
  return set;
}

/** Cuenta filas ya presentes en 10 para un run_id dado (readback post-write). */
async function contarFilasDeRun(runId: string): Promise<number> {
  try {
    const tab = await getOutputTab(ALERTAS_TAB);
    await withSheetsRetry(() => tab.loadHeaderRow(), `loadHeaderRow ${ALERTAS_TAB}`);
    const rows = await withSheetsRetry(() => tab.getRows(), `getRows ${ALERTAS_TAB}`);
    return rows.filter((r) => txt(r.get('run_id')) === runId).length;
  } catch {
    return 0;
  }
}

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);

  // ── Guarda dura anti-envío ───────────────────────────────────────────────
  const guarda = verificarFlagsAlertasSombra(rawArgv);
  if (!guarda.ok) {
    logger.error({ violacion: guarda.violacion }, guarda.mensaje ?? 'Shadow alerts forbid real sending.');
    process.exit(2);
  }

  // ── Guarda del allowlist shadow-only (nunca junto a envío real) ───────────
  const guardaAllowlist = verificarAllowlistShadow(rawArgv);
  if (!guardaAllowlist.ok) {
    logger.error({ violacion: guardaAllowlist.violacion }, guardaAllowlist.mensaje ?? 'shadow-client-allowlist inválido.');
    process.exit(2);
  }

  // ── Guarda de entorno anti-envío (SEND_ALERTS/WHATSAPP_ENABLED/EMAIL_ENABLED) ──
  const guardaEnv = verificarEnvObservacion(process.env);
  if (!guardaEnv.ok) {
    logger.error({ violacion: guardaEnv.violacion }, guardaEnv.mensaje ?? 'Envío real detectado en el entorno.');
    process.exit(2);
  }

  const args = parseArgs(rawArgv);
  const { desde, hasta } = ventanaMovil(args.windowHours);

  logger.info(
    {
      modo: 'shadow',
      submodo: 'alertas_sombra',
      shadow_alerts_observacion: args.observeOnly,
      windowHours: args.windowHours,
      fechaDesde: desde,
      fechaHasta: hasta,
      output: args.output,
      tab: args.output === 'sheet' ? ALERTAS_TAB : null,
      runId: args.runId,
      send: false,
      whatsapp: false,
      email: false,
      twilio: false,
      gmail_smtp: false,
      shadow_client_allowlist: args.shadowClientAllowlist,
      workflow: args.workflowLabel ?? null,
      tier: args.tierLabel ?? null,
      fuente: args.fuente ?? null,
    },
    args.observeOnly
      ? '=== Iniciando ALERTAS SOMBRA — MODO OBSERVACIÓN (escribe 10, sin envíos) ==='
      : '=== Iniciando ALERTAS SOMBRA (simulación, sin envíos) ===',
  );

  const sb: SupabaseClient = createClient(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );

  const [keywords, crudas] = await Promise.all([
    cargarKeywords(sb),
    cargarMencionesRecientes(sb, desde),
  ]);

  const allowlist = new Set(args.shadowClientAllowlist);
  const inputs = crudas.map((m) => aInput(m, keywords, allowlist));
  const { candidatos, resumen } = evaluarLote(inputs);

  logger.info(
    {
      menciones_evaluadas: resumen.evaluadas,
      alertas_sombra_candidatas: resumen.candidatas,
      alertas_sombra_p1_inmediata: resumen.p1_inmediata,
      alertas_sombra_p2_resumen: resumen.p2_resumen,
      alertas_sombra_p3_dashboard: resumen.p3_dashboard,
      alertas_sombra_bloqueadas: resumen.bloqueada,
      alertas_sombra_duplicadas: resumen.duplicada,
    },
    'Resumen de alertas sombra (sin envíos reales).',
  );

  // Ejemplos legibles (hasta 3 candidatos con alerta) para auditoría.
  const ejemplos = candidatos.filter((c) => c.habria_alerta === 'SÍ').slice(0, 3);
  for (const e of ejemplos) {
    logger.info(
      {
        cliente: e.cliente,
        keyword: e.keyword,
        medio: e.medio,
        titulo: e.titulo,
        tipo: e.tipo_alerta_simulada,
        canal: e.canal_simulado,
        motivo: e.motivo_alerta,
        regla: e.regla_disparo,
      },
      '[ejemplo] alerta sombra simulada',
    );
  }

  if (args.output === 'sheet') {
    const fecha = new Date().toISOString();
    const traza: TrazaObservacion = {
      workflow: args.workflowLabel,
      tier: args.tierLabel,
      fuente: args.fuente,
      allowlist: args.shadowClientAllowlist,
    };
    // cluster_count por run: nº de candidatos que comparten cluster_id.
    const clusterCountById = new Map<string, number>();
    for (const c of candidatos) {
      const { cluster_id } = clusterDe(c);
      clusterCountById.set(cluster_id, (clusterCountById.get(cluster_id) ?? 0) + 1);
    }
    const existentes = await leerLlavesExistentes();
    const preexistentesDelRun = await contarFilasDeRun(args.runId);
    const filas: OutRow[] = [];
    candidatos.forEach((c, idx) => {
      const llave = llaveFila(args.runId, c.mencion_id, c.dedupe_key, idx);
      if (existentes.has(llave)) return; // ya escrita en un reintento del mismo run
      existentes.add(llave);
      filas.push(aFilaSheet(c, args.runId, fecha, traza, clusterCountById));
    });
    // Migración incremental de cabeceras: agrega columnas de observabilidad si
    // faltan (no borra ni reordena las existentes). Readback de header incluido.
    const ensure = await ensureOutputHeaders(ALERTAS_TAB, [...ALERTAS_SOMBRA_HEADERS]);
    if (ensure.columnas_agregadas.length > 0) {
      logger.info(
        { tab: ALERTAS_TAB, columnas_agregadas: ensure.columnas_agregadas },
        'Alertas sombra: columnas de observabilidad agregadas a 10_Alertas_Sombra.',
      );
    }
    const escritas = await appendHistoryRows(ALERTAS_TAB, [...ALERTAS_SOMBRA_HEADERS], filas);
    // Readback obligatorio: releer 10 y contar filas de este run.
    const filas10Readback = await contarFilasDeRun(args.runId);
    const esperado = preexistentesDelRun + escritas;
    const mismatch = filas10Readback !== esperado;
    logger.info(
      {
        tab: ALERTAS_TAB,
        shadow_alerts_observacion: args.observeOnly,
        filas_10_escritas: escritas,
        filas_10_readback: filas10Readback,
        filas_10_esperadas: esperado,
        mismatch,
        candidatos_total: candidatos.length,
        send: false,
        whatsapp: false,
        email: false,
      },
      mismatch
        ? 'Alertas sombra: MISMATCH en readback de 10_Alertas_Sombra.'
        : 'Alertas sombra registradas en 10_Alertas_Sombra (append histórico, sin envíos).',
    );
  } else {
    logger.info({ candidatos_total: candidatos.length }, 'output=console: no se escribió en Sheets.');
  }

  logger.info({ modo: 'shadow', submodo: 'alertas_sombra' }, '=== Alertas sombra completado ===');
}

main().catch((err) => {
  logger.error(
    { error: err instanceof Error ? err.message : String(err) },
    'Error fatal en run-shadow-alerts',
  );
  process.exit(1);
});
