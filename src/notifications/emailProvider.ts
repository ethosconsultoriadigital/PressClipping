/**
 * Provider de EMAIL (SMTP) — DISABLED BY DEFAULT.
 *
 * No agrega dependencias (no importa `nodemailer`). El envío real se realiza a
 * través de un "transport" INYECTABLE (`SmtpTransport`). Mientras no se inyecte
 * un transport (fase actual), el provider nunca envía: devuelve `not_configured`
 * o `blocked`. Cuando se autorice el piloto real, se inyecta un transport
 * construido con nodemailer (a instalar en ese momento) sin tocar esta lógica.
 *
 * Seguridad: nunca loggea password. Solo expone el DOMINIO SMTP.
 */
import type { ChannelProvider, InternalAlert, NotificationConfig, SendResult, GuardResult } from './types.js';
import { hashRecipient } from './guards.js';
import { renderEmailSubject, renderEmailBody } from './templates.js';

/** Seam mínimo de envío SMTP (lo implementa nodemailer en el futuro). */
export interface SmtpTransport {
  sendMail(msg: { from: string; to: string; subject: string; text: string }): Promise<{ messageId: string }>;
}

export class EmailProvider implements ChannelProvider {
  readonly canal = 'email' as const;

  constructor(
    private readonly config: NotificationConfig,
    /** Transport real; si es null (fase actual), NUNCA se envía. */
    private readonly transport: SmtpTransport | null = null,
  ) {}

  isConfigured(): boolean {
    return (
      this.config.email.enabled &&
      this.config.email.smtpConfigured &&
      this.config.email.recipientsCount > 0 &&
      Boolean(this.config.email.from)
    );
  }

  async send(alert: InternalAlert, opts: { dryRun: boolean; guard: GuardResult }): Promise<SendResult> {
    const recipient = this.config.email.recipients[0] ?? '';
    const base: Omit<SendResult, 'status' | 'reason' | 'would_send' | 'sent_at' | 'provider_message_id'> = {
      alert_id: alert.alert_id,
      cliente_id: alert.cliente_id,
      severidad: alert.severidad,
      canal: 'email',
      recipient_hash: hashRecipient(recipient),
    };

    // 1. Guardas: si no autorizan, bloqueado (caso normal de esta fase).
    if (!opts.guard.can_send) {
      return { ...base, status: 'blocked', reason: opts.guard.reason, would_send: false, sent_at: null, provider_message_id: null };
    }
    // 2. Canal sin config completa.
    if (!this.isConfigured()) {
      return { ...base, status: 'not_configured', reason: 'email_channel_not_configured', would_send: false, sent_at: null, provider_message_id: null };
    }
    // 3. Dry-run: se habría enviado, pero NO se envía.
    const subject = renderEmailSubject(alert);
    const text = renderEmailBody(alert);
    if (opts.dryRun) {
      return { ...base, status: 'dry_run', reason: `would_email:${subject}`, would_send: true, sent_at: null, provider_message_id: null };
    }
    // 4. Envío real: solo si hay transport inyectado (no en esta fase).
    if (!this.transport) {
      return { ...base, status: 'not_configured', reason: 'smtp_transport_not_wired', would_send: true, sent_at: null, provider_message_id: null };
    }
    try {
      const res = await this.transport.sendMail({ from: this.config.email.from, to: recipient, subject, text });
      return { ...base, status: 'sent', reason: 'ok', would_send: true, sent_at: new Date().toISOString(), provider_message_id: res.messageId };
    } catch (e) {
      return { ...base, status: 'error', reason: e instanceof Error ? e.message : 'smtp_error', would_send: true, sent_at: null, provider_message_id: null };
    }
  }
}
