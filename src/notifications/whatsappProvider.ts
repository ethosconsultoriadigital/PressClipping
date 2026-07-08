/**
 * Provider de WhatsApp (Twilio) — OPCIONAL, DISABLED BY DEFAULT.
 *
 * No instala el SDK de Twilio. El envío real se hace por un seam inyectable
 * (`TwilioSender`). Sin credenciales o sin sender inyectado (fase actual), el
 * provider devuelve `not_configured` / `blocked` y NUNCA llama a Twilio.
 *
 * Seguridad: nunca loggea auth token ni número en claro (solo hash).
 */
import type { ChannelProvider, InternalAlert, NotificationConfig, SendResult, GuardResult } from './types.js';
import { hashRecipient } from './guards.js';
import { renderWhatsappMessage } from './templates.js';

/** Seam mínimo de envío Twilio WhatsApp (lo implementa el SDK en el futuro). */
export interface TwilioSender {
  sendMessage(msg: { from: string; to: string; body: string }): Promise<{ sid: string }>;
}

export class TwilioWhatsAppProvider implements ChannelProvider {
  readonly canal = 'whatsapp' as const;

  constructor(
    private readonly config: NotificationConfig,
    private readonly sender: TwilioSender | null = null,
  ) {}

  isConfigured(): boolean {
    return (
      this.config.whatsapp.enabled &&
      this.config.whatsapp.twilioConfigured &&
      this.config.whatsapp.recipientsCount > 0 &&
      Boolean(this.config.whatsapp.from)
    );
  }

  async send(alert: InternalAlert, opts: { dryRun: boolean; guard: GuardResult }): Promise<SendResult> {
    const recipient = this.config.whatsapp.recipients[0] ?? '';
    const base: Omit<SendResult, 'status' | 'reason' | 'would_send' | 'sent_at' | 'provider_message_id'> = {
      alert_id: alert.alert_id,
      cliente_id: alert.cliente_id,
      severidad: alert.severidad,
      canal: 'whatsapp',
      recipient_hash: hashRecipient(recipient),
    };

    if (!opts.guard.can_send) {
      return { ...base, status: 'blocked', reason: opts.guard.reason, would_send: false, sent_at: null, provider_message_id: null };
    }
    if (!this.config.whatsapp.twilioConfigured) {
      return { ...base, status: 'not_configured', reason: 'missing_twilio_credentials', would_send: false, sent_at: null, provider_message_id: null };
    }
    if (!this.isConfigured()) {
      return { ...base, status: 'not_configured', reason: 'whatsapp_channel_not_configured', would_send: false, sent_at: null, provider_message_id: null };
    }
    const body = renderWhatsappMessage(alert);
    if (opts.dryRun) {
      return { ...base, status: 'dry_run', reason: 'would_whatsapp', would_send: true, sent_at: null, provider_message_id: null };
    }
    if (!this.sender) {
      return { ...base, status: 'not_configured', reason: 'twilio_sender_not_wired', would_send: true, sent_at: null, provider_message_id: null };
    }
    try {
      const res = await this.sender.sendMessage({ from: this.config.whatsapp.from, to: recipient, body });
      return { ...base, status: 'sent', reason: 'ok', would_send: true, sent_at: new Date().toISOString(), provider_message_id: res.sid };
    } catch (e) {
      return { ...base, status: 'error', reason: e instanceof Error ? e.message : 'twilio_error', would_send: true, sent_at: null, provider_message_id: null };
    }
  }
}
