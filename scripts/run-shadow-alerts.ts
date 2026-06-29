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
import { verificarFlagsAlertasSombra } from '../src/utils/shadowGuard.js';
import { ventanaMovil } from '../src/utils/dateWindow.js';
import { OUTPUT_TABS, getOutputTab, withSheetsRetry } from '../src/sheets/client.js';
import { appendHistoryRows, type OutRow } from '../src/sheets/write.js';
import {
  evaluarLote,
  normalizarValoracion,
  ALERTAS_SOMBRA_HEADERS,
  type MencionAlertaInput,
  type CandidatoAlertaSombra,
} from '../src/alerts/shadowAlertRules.js';

/** Pestaña de salida (solo-append) para alertas sombra. */
const ALERTAS_TAB = '10_Alertas_Sombra';

interface AlertArgs {
  windowHours: number;
  output: 'console' | 'sheet';
  runId: string;
}

function parseArgs(argv: string[]): AlertArgs {
  const out: AlertArgs = {
    windowHours: 48,
    output: 'sheet',
    runId: `SA-${new Date().toISOString().replace(/[:.]/g, '-')}`,
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
      // Confirmaciones seguras (no habilitan nada): se aceptan tal cual.
      case 'dry-run': case 'no-send': case 'no-whatsapp': case 'no-email':
      case 'no-correos': case 'no-twilio': case 'no-gmail': case 'no-smtp':
        break;
    }
  }
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
  };
}

function aFilaSheet(c: CandidatoAlertaSombra, runId: string, fecha: string): OutRow {
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
    notas: 'modo=shadow; sin_envios_reales; sin_whatsapp; sin_email; sin_twilio; sin_gmail_smtp',
  };
}

/** Lee llaves ya presentes en 10 (run_id::dedupe_key) para no duplicar en reintentos. */
async function leerLlavesExistentes(): Promise<Set<string>> {
  const set = new Set<string>();
  try {
    const tab = await getOutputTab(ALERTAS_TAB);
    await withSheetsRetry(() => tab.loadHeaderRow(), `loadHeaderRow ${ALERTAS_TAB}`);
    const rows = await withSheetsRetry(() => tab.getRows(), `getRows ${ALERTAS_TAB}`);
    for (const r of rows) {
      set.add(`${txt(r.get('run_id'))}::${txt(r.get('dedupe_key'))}`);
    }
  } catch {
    // La pestaña aún no existe: no hay llaves previas.
  }
  return set;
}

async function main(): Promise<void> {
  const rawArgv = process.argv.slice(2);

  // ── Guarda dura anti-envío ───────────────────────────────────────────────
  const guarda = verificarFlagsAlertasSombra(rawArgv);
  if (!guarda.ok) {
    logger.error({ violacion: guarda.violacion }, guarda.mensaje ?? 'Shadow alerts forbid real sending.');
    process.exit(2);
  }

  const args = parseArgs(rawArgv);
  const { desde, hasta } = ventanaMovil(args.windowHours);

  logger.info(
    {
      modo: 'shadow',
      submodo: 'alertas_sombra',
      windowHours: args.windowHours,
      fechaDesde: desde,
      fechaHasta: hasta,
      output: args.output,
      runId: args.runId,
      envio: false,
      whatsapp: false,
      email: false,
      twilio: false,
      gmail_smtp: false,
    },
    '=== Iniciando ALERTAS SOMBRA (simulación, sin envíos) ===',
  );

  const sb: SupabaseClient = createClient(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!,
  );

  const [keywords, crudas] = await Promise.all([
    cargarKeywords(sb),
    cargarMencionesRecientes(sb, desde),
  ]);

  const inputs = crudas.map((m) => aInput(m, keywords));
  const { candidatos, resumen } = evaluarLote(inputs);

  logger.info(
    {
      menciones_evaluadas: inputs.length,
      alertas_sombra_candidatas: resumen.candidatas,
      alertas_sombra_inmediatas: resumen.inmediatas,
      alertas_sombra_resumen: resumen.resumen,
      alertas_sombra_bloqueadas: resumen.bloqueadas,
      alertas_sombra_duplicadas: resumen.duplicadas,
      alertas_sombra_baja_prioridad: resumen.baja_prioridad,
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
    const existentes = await leerLlavesExistentes();
    const filas: OutRow[] = [];
    for (const c of candidatos) {
      const llave = `${args.runId}::${c.dedupe_key}`;
      if (existentes.has(llave)) continue; // ya escrita en un reintento del mismo run
      existentes.add(llave);
      filas.push(aFilaSheet(c, args.runId, fecha));
    }
    const escritas = await appendHistoryRows(ALERTAS_TAB, [...ALERTAS_SOMBRA_HEADERS], filas);
    logger.info(
      { tab: ALERTAS_TAB, escritas, candidatos_total: candidatos.length },
      'Alertas sombra registradas (append histórico, sin envíos).',
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
