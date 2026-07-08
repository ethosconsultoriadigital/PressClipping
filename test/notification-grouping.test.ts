/**
 * Tests de AGRUPACIÓN / DIGEST de alertas P1 (anti-fatiga).
 *
 * Verifican que:
 *   - P1 CLI-0002 de la misma crisis GTO se agrupan en un cluster;
 *   - no se agrupan clientes distintos, severidades distintas, crisis distintas
 *     ni regiones distintas;
 *   - templates digest email/WhatsApp contienen lo esperado y WhatsApp es compacto;
 *   - el dry-run digest no envía y send-real sigue bloqueado con SEND_ALERTS=false;
 *   - no se exponen secretos ni destinatarios.
 */
import { describe, it, expect } from 'vitest';
import {
  groupAlertsForDigest,
  esFamiliaCrisisBebidas,
  regionBucket,
  detectZonas,
  FAMILIA_CRISIS_BEBIDAS,
} from '../src/notifications/grouping.js';
import { renderEmailDigestPreview, renderWhatsAppDigestPreview } from '../src/notifications/templates.js';
import { loadNotificationConfig } from '../src/notifications/guards.js';
import { NotificationService } from '../src/notifications/notificationService.js';
import type { InternalAlert, Severidad } from '../src/notifications/types.js';

function alert(over: Partial<InternalAlert> = {}): InternalAlert {
  return {
    alert_id: 'A',
    cliente_id: 'CLI-0002',
    cliente: 'Bebidas alcohólicas',
    severidad: 'P1' as Severidad,
    medio: 'El Sol de Irapuato',
    titulo: 'Alcohol adulterado en Guanajuato deja intoxicados',
    url: 'https://example.com/a',
    fecha_publicacion: '2026-07-07',
    keyword: 'alcohol adulterado',
    razon: 'P1 inmediata: crisis_bebidas.',
    resumen: '',
    dedupe_key: 'A',
    sin_envio: true,
    ...over,
  };
}

describe('helpers de familia y zona', () => {
  it('detecta familia crisis de bebidas', () => {
    expect(esFamiliaCrisisBebidas(alert({ titulo: 'tequila adulterado en Irapuato' }))).toBe(true);
    expect(esFamiliaCrisisBebidas(alert({ titulo: 'muerte por metanol', keyword: 'metanol' }))).toBe(true);
    expect(esFamiliaCrisisBebidas(alert({ titulo: 'Reforma laboral avanza', keyword: 'trabajadores', razon: 'P1: laboral' }))).toBe(false);
  });
  it('mapea zonas a región Guanajuato', () => {
    expect(regionBucket('caso en Irapuato')).toBe('guanajuato');
    expect(regionBucket('caso en Salamanca')).toBe('guanajuato');
    expect(regionBucket('nota nacional sin zona')).toBe('nacional');
    expect(detectZonas('Salamanca e Irapuato')).toEqual(['Irapuato', 'Salamanca']);
  });
});

describe('groupAlertsForDigest', () => {
  it('agrupa P1 CLI-0002 de la misma crisis GTO en un cluster', () => {
    const alerts = [
      alert({ alert_id: '1', titulo: 'Alcohol adulterado en Guanajuato', keyword: 'alcohol adulterado' }),
      alert({ alert_id: '2', titulo: 'Tequila adulterado en Irapuato', keyword: 'tequila adulterado' }),
      alert({ alert_id: '3', titulo: 'Muere hombre por metanol en Salamanca', keyword: 'intoxicación por alcohol' }),
    ];
    const r = groupAlertsForDigest(alerts);
    expect(r.clusters).toHaveLength(1);
    expect(r.clusters[0]!.count).toBe(3);
    expect(r.clusters[0]!.familia).toBe(FAMILIA_CRISIS_BEBIDAS);
    expect(r.reduccion).toEqual({ antes: 3, despues: 1 });
    expect(r.agrupadas).toBe(3);
  });

  it('NO agrupa clientes distintos', () => {
    const r = groupAlertsForDigest([
      alert({ alert_id: '1', cliente_id: 'CLI-0002' }),
      alert({ alert_id: '2', cliente_id: 'CLI-0003' }),
    ]);
    expect(r.clusters).toHaveLength(2);
  });

  it('NO agrupa severidades distintas (P2 no entra con P1)', () => {
    const r = groupAlertsForDigest([
      alert({ alert_id: '1', severidad: 'P1' }),
      alert({ alert_id: '2', severidad: 'P2' }),
    ]);
    expect(r.clusters).toHaveLength(2);
  });

  it('NO agrupa crisis distintas (familia distinta)', () => {
    const r = groupAlertsForDigest([
      alert({ alert_id: '1', titulo: 'Alcohol adulterado en Guanajuato', keyword: 'alcohol adulterado' }),
      alert({ alert_id: '2', titulo: 'Reforma laboral y huelga', keyword: 'huelga', razon: 'P1: laboral' }),
    ]);
    expect(r.clusters).toHaveLength(2);
  });

  it('NO mezcla eventos de regiones distintas', () => {
    const r = groupAlertsForDigest([
      alert({ alert_id: '1', titulo: 'Alcohol adulterado en Guanajuato', keyword: 'alcohol adulterado' }),
      alert({ alert_id: '2', titulo: 'Alcohol adulterado en Guadalajara, Jalisco', keyword: 'alcohol adulterado' }),
    ]);
    expect(r.clusters).toHaveLength(2);
    expect(r.clusters.map((c) => c.region).sort()).toEqual(['Guanajuato', 'Jalisco']);
  });

  it('un cluster de tamaño 1 no se pierde', () => {
    const r = groupAlertsForDigest([alert({ alert_id: '1' })]);
    expect(r.clusters).toHaveLength(1);
    expect(r.singletons).toBe(1);
    expect(r.agrupadas).toBe(0);
  });
});

describe('templates digest', () => {
  const cluster = groupAlertsForDigest([
    alert({ alert_id: '1', medio: 'El Sol de Irapuato', titulo: 'Alcohol adulterado en Guanajuato', url: 'https://ex.com/1' }),
    alert({ alert_id: '2', medio: 'Notus', titulo: 'Tequila adulterado en Salamanca e Irapuato', url: 'https://ex.com/2' }),
    alert({ alert_id: '3', medio: 'Correo', titulo: 'Metanol en Irapuato', url: 'https://ex.com/3' }),
    alert({ alert_id: '4', medio: 'Xataka', titulo: 'Alcohol adulterado, más casos en Irapuato', url: 'https://ex.com/4' }),
  ]).clusters[0]!;

  it('email digest renderiza asunto, conteo y fuentes', () => {
    const { subject, body } = renderEmailDigestPreview(cluster);
    expect(subject).toContain('[PILOTO INTERNO]');
    expect(subject).toContain('[CLI-0002]');
    expect(subject).toContain('(4 notas)');
    expect(body).toContain('Alertas agrupadas: 4');
    expect(body).toContain('El Sol de Irapuato');
    expect(body).toContain('https://ex.com/2');
    expect(body).toContain('NO fue enviado al cliente');
  });

  it('WhatsApp digest es compacto (máx 3 fuentes + resumen)', () => {
    const w = renderWhatsAppDigestPreview(cluster);
    expect(w).toContain('*Notas agrupadas:* 4');
    expect(w).toContain('(+1 notas más)');
    expect(w).toContain('_No enviado a cliente._');
    // Compacto: no más de 3 líneas numeradas de fuente.
    const numeradas = w.split('\n').filter((l) => /^\d+\./.test(l));
    expect(numeradas.length).toBeLessThanOrEqual(3);
  });
});

describe('digest + guardas', () => {
  it('dry-run digest no envía (representantes bloqueados)', async () => {
    const cfg = loadNotificationConfig({}, '');
    const svc = new NotificationService(cfg);
    const reps = groupAlertsForDigest([
      alert({ alert_id: '1' }),
      alert({ alert_id: '2', titulo: 'Tequila adulterado en Irapuato' }),
    ]).clusters.map((c) => ({ ...c.alerts[0]!, alert_id: `digest:${c.cluster_id}` }));
    const report = await svc.run(reps, { dryRun: true, sendReal: false });
    expect(report.enviadas).toBe(0);
    expect(report.would_send).toBe(0);
  });

  it('send-real sigue bloqueado con SEND_ALERTS=false', async () => {
    const cfg = loadNotificationConfig({ SEND_ALERTS: 'false', ALLOW_REAL_ALERTS: 'true' }, 'x');
    const svc = new NotificationService(cfg);
    const report = await svc.run([alert()], { dryRun: false, sendReal: true });
    expect(report.enviadas).toBe(0);
    expect(report.resultados.every((r) => r.status === 'blocked' && r.reason === 'real_alerts_disabled')).toBe(true);
  });

  it('no expone secretos ni destinatarios en el digest', () => {
    const cluster = groupAlertsForDigest([alert({ alert_id: '1' }), alert({ alert_id: '2' })]).clusters[0]!;
    const blob = JSON.stringify(renderEmailDigestPreview(cluster)) + renderWhatsAppDigestPreview(cluster);
    expect(blob).not.toContain('SMTP_PASS');
    expect(blob).not.toContain('TWILIO_AUTH_TOKEN');
    expect(blob).not.toMatch(/@gmail|@example\.com/);
  });
});
