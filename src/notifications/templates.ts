/**
 * Plantillas de alerta interna (piloto CLI-0002). LÓGICA PURA.
 *
 * Todas las plantillas dejan EXPLÍCITO que es PILOTO INTERNO y que NO se envió
 * al cliente. No usan lenguaje definitivo (falta validación humana). No incluyen
 * secretos ni destinatarios.
 */
import type { InternalAlert } from './types.js';

const NA = (v: string | undefined | null): string => {
  const s = String(v ?? '').trim();
  return s || '—';
};

/** Asunto de email: [PILOTO INTERNO][CLI-0002][P1] Crisis bebidas — <medio> */
export function renderEmailSubject(alert: InternalAlert): string {
  return `[PILOTO INTERNO][${alert.cliente_id}][${alert.severidad}] Crisis bebidas — ${NA(alert.medio)}`;
}

/** Cuerpo de email en texto plano (seguro, sin HTML de terceros). */
export function renderEmailBody(alert: InternalAlert): string {
  return [
    '🚨 Alerta crítica shadow / PILOTO INTERNO',
    '',
    `Cliente:   ${NA(alert.cliente)} (${NA(alert.cliente_id)})`,
    `Medio:     ${NA(alert.medio)}`,
    `Título:    ${NA(alert.titulo)}`,
    `URL:       ${NA(alert.url)}`,
    `Fecha:     ${NA(alert.fecha_publicacion)}`,
    `Keyword:   ${NA(alert.keyword)}`,
    `Razón ${alert.severidad}: ${NA(alert.razon)}`,
    '',
    `Resumen breve: ${NA(alert.resumen)}`,
    '',
    'Por qué importa: posible crisis reputacional para el cliente; requiere',
    'revisión humana antes de cualquier acción o contacto con el cliente.',
    '',
    'Estado: PILOTO INTERNO / NO CLIENTE. Este mensaje NO fue enviado al cliente.',
  ].join('\n');
}

/** Mensaje WhatsApp interno (formato Markdown de WhatsApp). */
export function renderWhatsappMessage(alert: InternalAlert): string {
  return [
    `🚨 *PILOTO INTERNO — ${alert.cliente_id}*`,
    `*Medio:* ${NA(alert.medio)}`,
    `*Título:* ${NA(alert.titulo)}`,
    `*Keyword:* ${NA(alert.keyword)}`,
    `*Razón:* ${NA(alert.razon)}`,
    `*URL:* ${NA(alert.url)}`,
    '_No enviado a cliente._',
  ].join('\n');
}
