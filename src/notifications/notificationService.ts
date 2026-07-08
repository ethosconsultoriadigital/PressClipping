/**
 * Servicio de notificaciones internas — orquesta guardas + providers.
 *
 * DISABLED BY DEFAULT. Aplica `assertCanSendRealAlerts` por alerta y delega en
 * los providers (email/whatsapp) que en esta fase devuelven blocked/not_configured/
 * dry_run. Respeta el tope `maxPerRun`. Devuelve resultados AUDITABLES sin
 * secretos ni destinatarios en claro.
 */
import type { ChannelProvider, InternalAlert, NotificationConfig, SendResult } from './types.js';
import { assertCanSendRealAlerts } from './guards.js';
import { EmailProvider } from './emailProvider.js';
import { TwilioWhatsAppProvider } from './whatsappProvider.js';

export interface NotificationRunOptions {
  dryRun: boolean;
  /** Solo con `sendReal=true` (CLI --send-real) se intenta envío real. */
  sendReal: boolean;
}

export interface NotificationRunReport {
  total_alertas: number;
  procesadas: number;
  omitidas_por_tope: number;
  would_send: number;
  bloqueadas: number;
  enviadas: number;
  resultados: SendResult[];
}

export class NotificationService {
  private readonly providers: ChannelProvider[];

  constructor(
    private readonly config: NotificationConfig,
    providers?: ChannelProvider[],
  ) {
    this.providers = providers ?? [new EmailProvider(config), new TwilioWhatsAppProvider(config)];
  }

  /**
   * Procesa alertas. `dryRun` fuerza simulación; incluso con sendReal=true, las
   * guardas deben autorizar (si no, todo queda blocked). Nunca envía en dry-run.
   */
  async run(alerts: InternalAlert[], opts: NotificationRunOptions): Promise<NotificationRunReport> {
    const tope = Math.max(0, this.config.maxPerRun);
    const seleccionadas = alerts.slice(0, tope);
    const omitidas = alerts.length - seleccionadas.length;

    // dryRun efectivo: dry-run explícito, O falta de autorización de envío real.
    const dryRunEfectivo = opts.dryRun || !opts.sendReal;

    const resultados: SendResult[] = [];
    for (const alert of seleccionadas) {
      const guard = assertCanSendRealAlerts(this.config, alert);
      for (const provider of this.providers) {
        resultados.push(await provider.send(alert, { dryRun: dryRunEfectivo, guard }));
      }
    }

    return {
      total_alertas: alerts.length,
      procesadas: seleccionadas.length,
      omitidas_por_tope: omitidas,
      would_send: resultados.filter((r) => r.would_send).length,
      bloqueadas: resultados.filter((r) => r.status === 'blocked').length,
      enviadas: resultados.filter((r) => r.status === 'sent').length,
      resultados,
    };
  }
}
