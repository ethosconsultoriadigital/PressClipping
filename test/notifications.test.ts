/**
 * Tests del MÓDULO DE ENVÍO INTERNO (disabled by default).
 *
 * Verifican que:
 *   - por defecto NO se envía (real_alerts_disabled);
 *   - cada capa de guarda bloquea (kill-switch, token, allowlist cliente/severidad,
 *     internal-only, destinatarios, canal, sin_envio);
 *   - dry-run nunca envía; --send-real sin token bloquea;
 *   - CLI-0002 P1 con TODO habilitado + sin_envio=false permitiría envío;
 *   - templates contienen los datos esperados y NO exponen secretos.
 */
import { describe, it, expect } from 'vitest';
import { loadNotificationConfig, assertCanSendRealAlerts, hashRecipient } from '../src/notifications/guards.js';
import { renderEmailSubject, renderEmailBody, renderWhatsappMessage } from '../src/notifications/templates.js';
import { NotificationService } from '../src/notifications/notificationService.js';
import { EmailProvider } from '../src/notifications/emailProvider.js';
import type { InternalAlert } from '../src/notifications/types.js';

const TOKEN = 'confirm-123';

/** Entorno con TODO habilitado (para probar que las guardas permitirían). */
function envFull(): Record<string, string | undefined> {
  return {
    SEND_ALERTS: 'true',
    ALLOW_REAL_ALERTS: 'true',
    ALERTS_INTERNAL_ONLY: 'true',
    ALERTS_ALLOWED_CLIENTS: 'CLI-0002',
    ALERTS_ALLOWED_SEVERITIES: 'P1',
    ALERTS_MAX_PER_RUN: '5',
    ALERTS_MAX_PER_DAY: '5',
    REAL_ALERTS_CONFIRMATION_TOKEN: TOKEN,
    EMAIL_ALERTS_ENABLED: 'true',
    SMTP_HOST: 'smtp.internal.example.com',
    SMTP_PORT: '587',
    SMTP_USER: 'bot@example.com',
    SMTP_PASS: 'super-secret-password',
    SMTP_FROM: 'alertas@example.com',
    INTERNAL_ALERT_EMAILS: 'equipo@example.com',
    WHATSAPP_ALERTS_ENABLED: 'false',
  };
}

function alertBase(over: Partial<InternalAlert> = {}): InternalAlert {
  return {
    alert_id: 'MEN-001',
    cliente_id: 'CLI-0002',
    cliente: 'Cliente Bebidas',
    severidad: 'P1',
    medio: 'El Sol de Irapuato',
    titulo: 'Crisis de contaminación en planta de bebidas',
    url: 'https://example.com/nota',
    fecha_publicacion: '2026-07-07',
    keyword: 'contaminación bebida',
    razon: 'crisis_bebidas_p1',
    resumen: 'Reporte de crisis reputacional.',
    dedupe_key: 'NOT-1:contaminación bebida',
    sin_envio: false,
    ...over,
  };
}

describe('guards — por defecto no envía', () => {
  it('entorno vacío => can_send=false, reason=real_alerts_disabled', () => {
    const cfg = loadNotificationConfig({}, '');
    const g = assertCanSendRealAlerts(cfg, alertBase());
    expect(g.can_send).toBe(false);
    expect(g.reason).toBe('real_alerts_disabled');
  });

  it('SEND_ALERTS=false bloquea', () => {
    const cfg = loadNotificationConfig({ ...envFull(), SEND_ALERTS: 'false' }, TOKEN);
    expect(assertCanSendRealAlerts(cfg, alertBase()).reason).toBe('real_alerts_disabled');
  });

  it('ALLOW_REAL_ALERTS=false bloquea', () => {
    const cfg = loadNotificationConfig({ ...envFull(), ALLOW_REAL_ALERTS: 'false' }, TOKEN);
    expect(assertCanSendRealAlerts(cfg, alertBase()).reason).toBe('real_alerts_disabled');
  });

  it('token ausente o distinto bloquea', () => {
    const cfg = loadNotificationConfig(envFull(), 'token-incorrecto');
    expect(assertCanSendRealAlerts(cfg, alertBase()).reason).toBe('confirmation_token_mismatch');
    const cfg2 = loadNotificationConfig({ ...envFull(), REAL_ALERTS_CONFIRMATION_TOKEN: '' }, '');
    expect(assertCanSendRealAlerts(cfg2, alertBase()).reason).toBe('confirmation_token_mismatch');
  });

  it('ALERTS_INTERNAL_ONLY!=true bloquea', () => {
    const cfg = loadNotificationConfig({ ...envFull(), ALERTS_INTERNAL_ONLY: 'false' }, TOKEN);
    expect(assertCanSendRealAlerts(cfg, alertBase()).reason).toBe('internal_only_required');
  });

  it('cliente no permitido bloquea', () => {
    const cfg = loadNotificationConfig(envFull(), TOKEN);
    expect(assertCanSendRealAlerts(cfg, alertBase({ cliente_id: 'CLI-0009' })).reason).toBe('client_not_allowed');
  });

  it('severidad no permitida bloquea', () => {
    const cfg = loadNotificationConfig(envFull(), TOKEN);
    expect(assertCanSendRealAlerts(cfg, alertBase({ severidad: 'P2' })).reason).toBe('severity_not_allowed');
  });

  it('sin destinatarios internos bloquea', () => {
    const cfg = loadNotificationConfig({ ...envFull(), INTERNAL_ALERT_EMAILS: '' }, TOKEN);
    expect(assertCanSendRealAlerts(cfg, alertBase()).reason).toBe('no_internal_recipients');
  });

  it('alerta shadow (sin_envio=true) bloquea', () => {
    const cfg = loadNotificationConfig(envFull(), TOKEN);
    expect(assertCanSendRealAlerts(cfg, alertBase({ sin_envio: true })).reason).toBe('shadow_only_mention');
  });

  it('CLI-0002 P1 con TODO habilitado + sin_envio=false PERMITIRÍA envío', () => {
    const cfg = loadNotificationConfig(envFull(), TOKEN);
    const g = assertCanSendRealAlerts(cfg, alertBase({ sin_envio: false }));
    expect(g.can_send).toBe(true);
    expect(g.reason).toBe('ok');
  });
});

describe('service — dry-run y send-real', () => {
  it('dry-run nunca envía, incluso con todo habilitado', async () => {
    const cfg = loadNotificationConfig(envFull(), TOKEN);
    const svc = new NotificationService(cfg);
    const report = await svc.run([alertBase({ sin_envio: false })], { dryRun: true, sendReal: false });
    expect(report.enviadas).toBe(0);
    expect(report.resultados.every((r) => r.status !== 'sent')).toBe(true);
  });

  it('sin --send-real (sendReal=false) nunca envía aunque config autorice', async () => {
    const cfg = loadNotificationConfig(envFull(), TOKEN);
    const svc = new NotificationService(cfg);
    const report = await svc.run([alertBase({ sin_envio: false })], { dryRun: false, sendReal: false });
    expect(report.enviadas).toBe(0);
    const email = report.resultados.find((r) => r.canal === 'email');
    expect(email?.status).toBe('dry_run');
    expect(email?.would_send).toBe(true);
  });

  it('config apagada => todo blocked (real_alerts_disabled)', async () => {
    const cfg = loadNotificationConfig({}, '');
    const svc = new NotificationService(cfg);
    const report = await svc.run([alertBase()], { dryRun: false, sendReal: true });
    expect(report.enviadas).toBe(0);
    expect(report.bloqueadas).toBeGreaterThan(0);
    expect(report.resultados.every((r) => r.status === 'blocked' && r.reason === 'real_alerts_disabled')).toBe(true);
  });

  it('respeta maxPerRun', async () => {
    const cfg = loadNotificationConfig({ ...envFull(), ALERTS_MAX_PER_RUN: '1' }, TOKEN);
    const svc = new NotificationService(cfg);
    const report = await svc.run(
      [alertBase({ alert_id: 'A' }), alertBase({ alert_id: 'B' }), alertBase({ alert_id: 'C' })],
      { dryRun: true, sendReal: false },
    );
    expect(report.procesadas).toBe(1);
    expect(report.omitidas_por_tope).toBe(2);
  });

  it('send-real con guardas OK + transport inyectado envía (simulado por transport fake)', async () => {
    const cfg = loadNotificationConfig(envFull(), TOKEN);
    let enviados = 0;
    const fakeTransport = {
      async sendMail() { enviados += 1; return { messageId: 'fake-id-1' }; },
    };
    const email = new EmailProvider(cfg, fakeTransport);
    const svc = new NotificationService(cfg, [email]);
    const report = await svc.run([alertBase({ sin_envio: false })], { dryRun: false, sendReal: true });
    expect(enviados).toBe(1);
    expect(report.enviadas).toBe(1);
    expect(report.resultados[0]?.provider_message_id).toBe('fake-id-1');
  });

  it('send-real SIN transport (fase actual) NO envía: not_configured', async () => {
    const cfg = loadNotificationConfig(envFull(), TOKEN);
    const email = new EmailProvider(cfg, null);
    const svc = new NotificationService(cfg, [email]);
    const report = await svc.run([alertBase({ sin_envio: false })], { dryRun: false, sendReal: true });
    expect(report.enviadas).toBe(0);
    expect(report.resultados[0]?.status).toBe('not_configured');
    expect(report.resultados[0]?.reason).toBe('smtp_transport_not_wired');
  });
});

describe('templates — contenido y seguridad', () => {
  const a = alertBase();

  it('asunto email tiene marca PILOTO INTERNO, cliente, severidad y medio', () => {
    const s = renderEmailSubject(a);
    expect(s).toContain('[PILOTO INTERNO]');
    expect(s).toContain('[CLI-0002]');
    expect(s).toContain('[P1]');
    expect(s).toContain(a.medio);
  });

  it('cuerpo email contiene datos clave y aclara NO CLIENTE', () => {
    const b = renderEmailBody(a);
    for (const campo of [a.cliente, a.medio, a.titulo, a.url, a.fecha_publicacion, a.keyword, a.razon]) {
      expect(b).toContain(campo);
    }
    expect(b).toContain('PILOTO INTERNO');
    expect(b).toContain('NO fue enviado al cliente');
  });

  it('mensaje WhatsApp contiene datos clave y "No enviado a cliente"', () => {
    const w = renderWhatsappMessage(a);
    expect(w).toContain('PILOTO INTERNO');
    expect(w).toContain(a.medio);
    expect(w).toContain(a.titulo);
    expect(w).toContain(a.keyword);
    expect(w).toContain(a.url);
    expect(w).toContain('_No enviado a cliente._');
  });

  it('ningún template ni resultado expone secretos (password/token)', async () => {
    const cfg = loadNotificationConfig(envFull(), TOKEN);
    const svc = new NotificationService(cfg);
    const report = await svc.run([alertBase({ sin_envio: false })], { dryRun: true, sendReal: false });
    const blob = JSON.stringify(report) + renderEmailBody(a) + renderEmailSubject(a) + renderWhatsappMessage(a);
    expect(blob).not.toContain('super-secret-password');
    expect(blob).not.toContain(TOKEN);
    expect(blob).not.toContain('bot@example.com');
  });

  it('hashRecipient no devuelve el valor en claro', () => {
    const h = hashRecipient('equipo@example.com');
    expect(h).not.toContain('equipo@example.com');
    expect(h).toMatch(/^[a-f0-9]{12}$/);
  });
});
