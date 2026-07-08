/**
 * Plantillas de alerta interna (piloto CLI-0002). LÓGICA PURA.
 *
 * Todas las plantillas dejan EXPLÍCITO que es PILOTO INTERNO y que NO se envió
 * al cliente. No usan lenguaje definitivo (falta validación humana). No incluyen
 * secretos ni destinatarios.
 */
import type { InternalAlert } from './types.js';
import type { DigestCluster } from './grouping.js';

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

/** Etiqueta legible de la crisis a partir de la familia del cluster. */
function etiquetaCrisis(cluster: DigestCluster): string {
  if (cluster.familia.startsWith('otro:')) return cluster.familia.slice('otro:'.length) || 'mención relevante';
  return 'alcohol/tequila adulterado';
}

/** Preview de email DIGEST: agrupa N alertas de una misma crisis en un mensaje. */
export function renderEmailDigestPreview(cluster: DigestCluster): { subject: string; body: string } {
  const zona = cluster.zonas.length ? cluster.zonas.join(' / ') : cluster.region;
  const subject = `[PILOTO INTERNO][${cluster.cliente_id}][${cluster.severidad}] Crisis: ${etiquetaCrisis(cluster)} — ${zona} (${cluster.count} notas)`;
  const fuentes = cluster.alerts.map((a, i) => `  ${i + 1}. ${NA(a.medio)} — ${NA(a.titulo)} — ${NA(a.url)}`);
  const body = [
    '🚨 PILOTO INTERNO — ' + cluster.cliente_id,
    `Crisis: ${etiquetaCrisis(cluster)}`,
    `Ubicación: ${zona}`,
    `Alertas agrupadas: ${cluster.count}`,
    `Nivel: ${cluster.severidad}`,
    cluster.familias_detectadas.length ? `Señales: ${cluster.familias_detectadas.join(', ')}` : '',
    '',
    'Fuentes:',
    ...fuentes,
    '',
    'Por qué importa: múltiples medios reportan la misma crisis; concentra el',
    'seguimiento en un solo aviso para evitar fatiga por volumen. Requiere revisión',
    'humana antes de cualquier acción o contacto con el cliente.',
    '',
    'Estado: PILOTO INTERNO / NO CLIENTE. Este mensaje NO fue enviado al cliente.',
  ]
    .filter((l) => l !== '')
    .join('\n');
  return { subject, body };
}

/** Preview de WhatsApp DIGEST: compacto, máx. 3 fuentes principales. */
export function renderWhatsAppDigestPreview(cluster: DigestCluster): string {
  const zona = cluster.zonas.length ? cluster.zonas.join('/') : cluster.region;
  const top = cluster.alerts.slice(0, 3).map((a, i) => `${i + 1}. ${NA(a.medio)}: ${NA(a.titulo)}`);
  const resto = cluster.count > 3 ? [`_(+${cluster.count - 3} notas más)_`] : [];
  return [
    `🚨 *PILOTO INTERNO — ${cluster.cliente_id}*`,
    `*Crisis:* ${etiquetaCrisis(cluster)}`,
    `*Zona:* ${zona}`,
    `*Notas agrupadas:* ${cluster.count}`,
    '*Fuentes principales:*',
    ...top,
    ...resto,
    '_No enviado a cliente._',
  ].join('\n');
}
