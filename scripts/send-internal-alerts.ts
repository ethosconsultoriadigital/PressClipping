/**
 * Piloto INTERNO de alertas (CLI-0002) — SEGURO POR DEFECTO.
 *
 * Lee las últimas P1 de 10_Alertas_Sombra, filtra por cliente/severidad, arma
 * mensajes internos y los pasa por las guardas del módulo de notificaciones.
 *
 * DRY-RUN por defecto: NO envía nada. El envío real exige `--send-real` Y que el
 * entorno autorice (SEND_ALERTS + ALLOW_REAL_ALERTS + token + allowlist + canal +
 * destinatarios + sin_envio=false). En condiciones normales TODO queda `blocked`
 * con reason=real_alerts_disabled.
 *
 * Uso:
 *   npm run send-internal-alerts -- --dry-run --client=CLI-0002 --severity=P1 --limit=5
 */
import { pathToFileURL } from 'node:url';
import { logger } from '../src/utils/logger.js';
import { getOutputTab } from '../src/sheets/client.js';
import { normalizeHeader } from '../src/utils/parse.js';
import { loadNotificationConfig } from '../src/notifications/guards.js';
import { NotificationService } from '../src/notifications/notificationService.js';
import { renderEmailSubject, renderWhatsappMessage } from '../src/notifications/templates.js';
import type { InternalAlert, Severidad } from '../src/notifications/types.js';

const ALERTAS_TAB = '10_Alertas_Sombra';

interface Args {
  dryRun: boolean;
  sendReal: boolean;
  client: string;
  severity: Severidad;
  limit: number;
  token: string;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: true, sendReal: false, client: 'CLI-0002', severity: 'P1', limit: 5, token: '' };
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    const key = eq === -1 ? body : body.slice(0, eq);
    const val = eq === -1 ? '' : body.slice(eq + 1);
    switch (key) {
      case 'dry-run': out.dryRun = true; break;
      case 'send-real': out.sendReal = true; break;
      case 'client': out.client = val || out.client; break;
      case 'severity': out.severity = (val as Severidad) || out.severity; break;
      case 'limit': out.limit = Number(val) || out.limit; break;
      case 'token': out.token = val; break;
    }
  }
  return out;
}

async function readOutputTab(title: string): Promise<Record<string, string | undefined>[]> {
  const sheet = await getOutputTab(title);
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();
  const headers = sheet.headerValues.map((h) => ({ raw: h, norm: normalizeHeader(h) }));
  return rows.map((row) => {
    const rec: Record<string, string | undefined> = {};
    for (const { raw, norm } of headers) { const v = row.get(raw); rec[norm] = v == null ? undefined : String(v); }
    return rec;
  });
}

function toInternalAlert(r: Record<string, string | undefined>): InternalAlert {
  const noticia = r['noticia_id'] ?? '';
  const keyword = r['keyword'] ?? '';
  return {
    alert_id: (r['mencion_id'] && r['mencion_id']!.trim()) || `${noticia}:${keyword}`,
    cliente_id: r['cliente_id'] ?? '',
    cliente: r['cliente'] ?? '',
    severidad: 'P1',
    medio: r['medio'] ?? '',
    titulo: r['titulo'] ?? '',
    url: r['url'] ?? '',
    fecha_publicacion: r['fecha_publicacion'] ?? '',
    keyword,
    razon: (r['motivo_alerta'] && r['motivo_alerta']!.trim()) || r['regla_disparo'] || '',
    resumen: r['notas'] ?? '',
    dedupe_key: r['dedupe_key'] ?? `${noticia}:${keyword}`,
    // Las filas de 10_Alertas_Sombra son OBSERVACIÓN: siempre sin envío.
    sin_envio: true,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadNotificationConfig(process.env, args.token);

  logger.info(
    {
      modo: args.sendReal ? 'intento_real' : 'dry_run',
      dry_run: args.dryRun,
      send_real_flag: args.sendReal,
      client: args.client,
      severity: args.severity,
      limit: args.limit,
      send_alerts_env: config.sendAlerts,
      allow_real_alerts_env: config.allowRealAlerts,
      email_enabled: config.email.enabled,
      whatsapp_enabled: config.whatsapp.enabled,
      email_recipients: config.email.recipientsCount,
      whatsapp_recipients: config.whatsapp.recipientsCount,
      smtp_host_domain: config.email.smtpHostDomain || null,
      twilio_configured: config.whatsapp.twilioConfigured,
    },
    '=== send-internal-alerts (DISABLED BY DEFAULT) ===',
  );

  // Leer y filtrar P1 del cliente objetivo desde 10_Alertas_Sombra.
  const rows = await readOutputTab(ALERTAS_TAB);
  const filtradas = rows.filter(
    (r) => (r['cliente_id'] ?? '') === args.client && (r['estado_shadow'] ?? '').toUpperCase() === 'P1_INMEDIATA',
  );
  // Dedupe por dedupe_key, quedarnos con las últimas (orden de aparición) y tope.
  const vistos = new Set<string>();
  const dedupe: Record<string, string | undefined>[] = [];
  for (const r of filtradas.reverse()) {
    const k = r['dedupe_key'] ?? `${r['noticia_id']}:${r['keyword']}`;
    if (vistos.has(k)) continue;
    vistos.add(k);
    dedupe.push(r);
    if (dedupe.length >= args.limit) break;
  }
  const alertas = dedupe.map(toInternalAlert);

  logger.info({ leidas: rows.length, cliente: args.client, p1_filtradas: filtradas.length, seleccionadas: alertas.length }, 'Alertas P1 seleccionadas');

  // PREVIEW de plantillas (contenido que se generaría). No implica envío.
  for (const a of alertas) {
    logger.info(
      { alert_id: a.alert_id, medio: a.medio, subject: renderEmailSubject(a), whatsapp_preview: renderWhatsappMessage(a).replace(/\n/g, ' | ') },
      '[preview] alerta interna (NO enviada)',
    );
  }

  // Rechazo temprano de envío real sin flag explícito.
  if (args.sendReal) {
    logger.warn({}, '--send-real presente: el envío real depende ENTERAMENTE de las guardas de entorno.');
  }

  const service = new NotificationService(config);
  const report = await service.run(alertas, { dryRun: args.dryRun || !args.sendReal, sendReal: args.sendReal });

  for (const r of report.resultados) {
    logger.info(
      { alert_id: r.alert_id, cliente_id: r.cliente_id, severidad: r.severidad, canal: r.canal, recipient_hash: r.recipient_hash, status: r.status, reason: r.reason, would_send: r.would_send, provider_message_id: r.provider_message_id },
      'resultado_notificacion',
    );
  }

  logger.info(
    {
      total_alertas: report.total_alertas,
      procesadas: report.procesadas,
      omitidas_por_tope: report.omitidas_por_tope,
      would_send: report.would_send,
      bloqueadas: report.bloqueadas,
      enviadas: report.enviadas,
      envio_real_confirmado: report.enviadas > 0,
    },
    '=== Resumen send-internal-alerts ===',
  );

  if (report.enviadas > 0) {
    logger.warn({ enviadas: report.enviadas }, 'ATENCIÓN: se registraron envíos reales.');
  } else {
    logger.info({}, 'Sin envíos reales (esperado en esta fase).');
  }
  process.exit(0);
}

function esEntrypointCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (esEntrypointCli()) {
  main().catch((err) => {
    logger.error({ error: err instanceof Error ? err.message : String(err) }, 'Error fatal en send-internal-alerts');
    process.exit(1);
  });
}

export { parseArgs, toInternalAlert };
