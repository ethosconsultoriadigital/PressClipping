/**
 * Guardas del módulo de envío interno. LÓGICA PURA (sin red ni DB) para test.
 *
 * Regla dura (capas AND — todas deben cumplirse para can_send=true):
 *   1. SEND_ALERTS=true
 *   2. ALLOW_REAL_ALERTS=true
 *   3. REAL_ALERTS_CONFIRMATION_TOKEN presente y == token entregado
 *   4. cliente_id ∈ ALERTS_ALLOWED_CLIENTS
 *   5. severidad ∈ ALERTS_ALLOWED_SEVERITIES
 *   6. ALERTS_INTERNAL_ONLY=true (fase inicial)
 *   7. hay destinatarios internos (email o whatsapp)
 *   8. al menos un canal habilitado
 *   9. la alerta trae sin_envio=false explícito (modo real)
 *
 * En ejecución normal (todo apagado) el resultado es
 * { can_send:false, reason:'real_alerts_disabled' }.
 */
import { createHash } from 'node:crypto';
import type { InternalAlert, NotificationConfig, GuardResult, Severidad } from './types.js';

const on = (v: string | undefined): boolean => String(v ?? '').trim().toLowerCase() === 'true';
const num = (v: string | undefined, def: number): number => {
  const raw = String(v ?? '').trim();
  if (!raw) return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : def;
};
const list = (v: string | undefined): string[] =>
  String(v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Dominio de un host SMTP sin exponer credenciales completas. */
function safeDomain(host: string | undefined): string {
  const h = String(host ?? '').trim();
  if (!h) return '';
  // host puede venir como smtp.gmail.com — devolvemos tal cual (no es secreto),
  // pero recortamos cualquier user:pass@ por seguridad.
  const at = h.indexOf('@');
  return at === -1 ? h : h.slice(at + 1);
}

/** Resuelve la configuración desde el entorno. Nunca expone secretos. */
export function loadNotificationConfig(
  env: Record<string, string | undefined>,
  providedToken = '',
): NotificationConfig {
  const allowedSeverities = list(env['ALERTS_ALLOWED_SEVERITIES']).filter(
    (s): s is Severidad => s === 'P1' || s === 'P2' || s === 'P3',
  );
  const emailRecipients = list(env['INTERNAL_ALERT_EMAILS']);
  const waRecipients = list(env['INTERNAL_ALERT_WHATSAPP_NUMBERS']);
  return {
    sendAlerts: on(env['SEND_ALERTS']),
    allowRealAlerts: on(env['ALLOW_REAL_ALERTS']),
    internalOnly: on(env['ALERTS_INTERNAL_ONLY']),
    allowedClients: list(env['ALERTS_ALLOWED_CLIENTS']),
    allowedSeverities,
    maxPerRun: num(env['ALERTS_MAX_PER_RUN'], 5),
    maxPerDay: num(env['ALERTS_MAX_PER_DAY'], 5),
    confirmationToken: String(env['REAL_ALERTS_CONFIRMATION_TOKEN'] ?? '').trim(),
    providedToken: String(providedToken ?? '').trim(),
    email: {
      enabled: on(env['EMAIL_ALERTS_ENABLED']),
      smtpConfigured: Boolean(String(env['SMTP_HOST'] ?? '').trim()),
      smtpHostDomain: safeDomain(env['SMTP_HOST']),
      recipientsCount: emailRecipients.length,
      recipients: emailRecipients,
      from: String(env['SMTP_FROM'] ?? '').trim(),
    },
    whatsapp: {
      enabled: on(env['WHATSAPP_ALERTS_ENABLED']),
      twilioConfigured: Boolean(
        String(env['TWILIO_ACCOUNT_SID'] ?? '').trim() && String(env['TWILIO_AUTH_TOKEN'] ?? '').trim(),
      ),
      recipientsCount: waRecipients.length,
      recipients: waRecipients,
      from: String(env['TWILIO_WHATSAPP_FROM'] ?? '').trim(),
    },
  };
}

/**
 * Guarda central: ¿se puede enviar alerta REAL para esta alerta y config?
 * Devuelve la PRIMERA razón de bloqueo encontrada (orden de capas).
 */
export function assertCanSendRealAlerts(config: NotificationConfig, alert: InternalAlert): GuardResult {
  if (!config.sendAlerts) return { can_send: false, reason: 'real_alerts_disabled' };
  if (!config.allowRealAlerts) return { can_send: false, reason: 'real_alerts_disabled' };
  if (!config.confirmationToken || config.confirmationToken !== config.providedToken) {
    return { can_send: false, reason: 'confirmation_token_mismatch' };
  }
  if (!config.internalOnly) return { can_send: false, reason: 'internal_only_required' };
  if (!config.allowedClients.includes(alert.cliente_id)) {
    return { can_send: false, reason: 'client_not_allowed' };
  }
  if (!config.allowedSeverities.includes(alert.severidad)) {
    return { can_send: false, reason: 'severity_not_allowed' };
  }
  const hayDestinatarios =
    (config.email.enabled && config.email.recipientsCount > 0) ||
    (config.whatsapp.enabled && config.whatsapp.recipientsCount > 0);
  if (!hayDestinatarios) return { can_send: false, reason: 'no_internal_recipients' };
  if (!config.email.enabled && !config.whatsapp.enabled) {
    return { can_send: false, reason: 'no_channel_enabled' };
  }
  if (alert.sin_envio !== false) return { can_send: false, reason: 'shadow_only_mention' };
  return { can_send: true, reason: 'ok' };
}

/** Hash corto y estable de un destinatario (nunca guardar teléfono/email en claro). */
export function hashRecipient(value: string): string {
  return createHash('sha256').update(String(value ?? '').trim().toLowerCase()).digest('hex').slice(0, 12);
}
