/**
 * Factory del transporte SMTP real — SEGURO POR DEFECTO (devuelve `null`).
 *
 * Prepara la integración de la Fase 1 del piloto interno CLI-0002 sin activarla:
 * `nodemailer` solo se importa (dinámicamente) y se construye un transporte real
 * cuando TODAS las capas de habilitación están activas. En condiciones normales
 * (kill-switches apagados) devuelve `null`, con lo que `EmailProvider` nunca envía.
 *
 * Capas exigidas para construir transporte (AND):
 *   1. SEND_ALERTS=true
 *   2. ALLOW_REAL_ALERTS=true
 *   3. EMAIL_ALERTS_ENABLED=true
 *   4. SMTP_HOST configurado
 *   5. SMTP_FROM presente
 *   6. al menos un destinatario interno (INTERNAL_ALERT_EMAILS)
 *
 * Nota: la autorización FINAL por alerta (token, allowlist, sin_envio=false) la
 * aplican las guardas en `assertCanSendRealAlerts`. Este factory solo decide si
 * existe un canal técnico. Nunca loggea password ni credenciales.
 */
import type { NotificationConfig } from './types.js';
import type { SmtpTransport } from './emailProvider.js';

export interface SmtpTransportBuildResult {
  transport: SmtpTransport | null;
  /** Motivo por el que NO se construyó transporte (auditable, sin secretos). */
  reason:
    | 'ok'
    | 'send_alerts_disabled'
    | 'allow_real_alerts_disabled'
    | 'email_channel_disabled'
    | 'smtp_not_configured'
    | 'no_internal_recipients';
}

/** ¿Están todas las capas de habilitación del canal email activas? */
export function emailChannelAuthorized(config: NotificationConfig): SmtpTransportBuildResult['reason'] {
  if (!config.sendAlerts) return 'send_alerts_disabled';
  if (!config.allowRealAlerts) return 'allow_real_alerts_disabled';
  if (!config.email.enabled) return 'email_channel_disabled';
  if (!config.email.smtpConfigured || !config.email.from) return 'smtp_not_configured';
  if (config.email.recipientsCount < 1) return 'no_internal_recipients';
  return 'ok';
}

/**
 * Construye un transporte SMTP real SOLO si el canal está plenamente autorizado.
 * Devuelve `{ transport: null, reason }` en cualquier otro caso (fase actual).
 *
 * `env` provee los datos NO presentes en `config` (puerto/usuario/password), que
 * nunca se exponen. La construcción del transporte no abre conexión (nodemailer
 * conecta al primer `sendMail`), por lo que es segura en dry-run.
 */
export async function createSmtpTransport(
  config: NotificationConfig,
  env: Record<string, string | undefined> = process.env,
): Promise<SmtpTransportBuildResult> {
  const reason = emailChannelAuthorized(config);
  if (reason !== 'ok') return { transport: null, reason };

  const host = String(env['SMTP_HOST'] ?? '').trim();
  const port = Number(String(env['SMTP_PORT'] ?? '').trim()) || 587;
  const user = String(env['SMTP_USER'] ?? '').trim();
  const pass = String(env['SMTP_PASS'] ?? '').trim();

  // Import dinámico: nodemailer no se carga salvo que se autorice el canal.
  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
  });

  const transport: SmtpTransport = {
    async sendMail(msg) {
      const info = await transporter.sendMail(msg);
      return { messageId: String((info as { messageId?: string }).messageId ?? '') };
    },
  };
  return { transport, reason: 'ok' };
}
