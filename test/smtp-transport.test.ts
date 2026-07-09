/**
 * Tests del FACTORY de transporte SMTP (Fase 1 piloto interno — disabled by default).
 *
 * Verifican que el transporte real NUNCA se construye salvo autorización completa:
 *   - SEND_ALERTS=false bloquea
 *   - ALLOW_REAL_ALERTS=false bloquea
 *   - EMAIL_ALERTS_ENABLED=false bloquea
 *   - SMTP sin configurar bloquea
 *   - sin destinatarios internos bloquea
 *   - con TODO habilitado se construye transporte (no abre conexión)
 *   - ni el resultado ni la razón exponen password/credenciales
 */
import { describe, it, expect } from 'vitest';
import { loadNotificationConfig } from '../src/notifications/guards.js';
import { createSmtpTransport, emailChannelAuthorized } from '../src/notifications/smtpTransport.js';

const SECRET = 'super-secret-password';

function envFull(): Record<string, string | undefined> {
  return {
    SEND_ALERTS: 'true',
    ALLOW_REAL_ALERTS: 'true',
    ALERTS_INTERNAL_ONLY: 'true',
    ALERTS_ALLOWED_CLIENTS: 'CLI-0002',
    ALERTS_ALLOWED_SEVERITIES: 'P1',
    EMAIL_ALERTS_ENABLED: 'true',
    SMTP_HOST: 'smtp.internal.example.com',
    SMTP_PORT: '587',
    SMTP_USER: 'bot@example.com',
    SMTP_PASS: SECRET,
    SMTP_FROM: 'alertas@example.com',
    INTERNAL_ALERT_EMAILS: 'equipo@example.com',
  };
}

describe('createSmtpTransport — disabled by default', () => {
  it('entorno vacío => transport null', async () => {
    const cfg = loadNotificationConfig({}, '');
    const { transport, reason } = await createSmtpTransport(cfg, {});
    expect(transport).toBeNull();
    expect(reason).toBe('send_alerts_disabled');
  });

  it('SEND_ALERTS=false => null', async () => {
    const env = { ...envFull(), SEND_ALERTS: 'false' };
    const { transport, reason } = await createSmtpTransport(loadNotificationConfig(env), env);
    expect(transport).toBeNull();
    expect(reason).toBe('send_alerts_disabled');
  });

  it('ALLOW_REAL_ALERTS=false => null', async () => {
    const env = { ...envFull(), ALLOW_REAL_ALERTS: 'false' };
    const { transport, reason } = await createSmtpTransport(loadNotificationConfig(env), env);
    expect(transport).toBeNull();
    expect(reason).toBe('allow_real_alerts_disabled');
  });

  it('EMAIL_ALERTS_ENABLED=false => null', async () => {
    const env = { ...envFull(), EMAIL_ALERTS_ENABLED: 'false' };
    const { transport, reason } = await createSmtpTransport(loadNotificationConfig(env), env);
    expect(transport).toBeNull();
    expect(reason).toBe('email_channel_disabled');
  });

  it('SMTP sin host => null (smtp_not_configured)', async () => {
    const env = { ...envFull(), SMTP_HOST: '' };
    const { transport, reason } = await createSmtpTransport(loadNotificationConfig(env), env);
    expect(transport).toBeNull();
    expect(reason).toBe('smtp_not_configured');
  });

  it('sin destinatarios internos => null', async () => {
    const env = { ...envFull(), INTERNAL_ALERT_EMAILS: '' };
    const { transport, reason } = await createSmtpTransport(loadNotificationConfig(env), env);
    expect(transport).toBeNull();
    expect(reason).toBe('no_internal_recipients');
  });

  it('con TODO habilitado construye transporte (sin abrir conexión)', async () => {
    const env = envFull();
    const { transport, reason } = await createSmtpTransport(loadNotificationConfig(env), env);
    expect(reason).toBe('ok');
    expect(transport).not.toBeNull();
    expect(typeof transport?.sendMail).toBe('function');
  });

  it('la razón/resultado no exponen password', async () => {
    const env = envFull();
    const res = await createSmtpTransport(loadNotificationConfig(env), env);
    expect(JSON.stringify(res.reason)).not.toContain(SECRET);
    expect(emailChannelAuthorized(loadNotificationConfig(env))).toBe('ok');
  });
});
