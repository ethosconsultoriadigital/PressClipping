/**
 * Tipos del MÓDULO DE ENVÍO INTERNO de alertas (piloto CLI-0002).
 *
 * DISABLED BY DEFAULT. Este módulo NO envía nada en la configuración normal:
 * las guardas (`guards.ts`) bloquean el envío real salvo que TODAS las
 * condiciones de entorno estén explícitamente habilitadas. Diseñado para el
 * piloto INTERNO (equipo MDP), nunca para cliente externo en esta fase.
 *
 * Módulo PURO de tipos: sin red, sin DB, sin efectos colaterales.
 */

/** Canal de notificación soportado por el módulo. */
export type Canal = 'email' | 'whatsapp';

/** Severidad de la alerta (solo P1 es elegible en el piloto). */
export type Severidad = 'P1' | 'P2' | 'P3';

/**
 * Alerta interna normalizada, derivada de una mención ya evaluada como alerta
 * sombra (`CandidatoAlertaSombra`). Solo contiene lo necesario para renderizar
 * y auditar; nunca lleva secretos ni destinatarios en claro.
 */
export interface InternalAlert {
  alert_id: string;
  cliente_id: string;
  cliente: string;
  severidad: Severidad;
  medio: string;
  titulo: string;
  url: string;
  fecha_publicacion: string;
  keyword: string;
  /** Razón P1 (motivo_alerta / regla_disparo de la evaluación sombra). */
  razon: string;
  /** Resumen breve (opcional). */
  resumen: string;
  /** Clave de dedupe (noticia+cliente) para no repetir envíos. */
  dedupe_key: string;
  /**
   * Marca de la fila shadow: `true` significa que NO se envió (estado sombra).
   * El modo real exige `sin_envio=false` explícito para considerar el envío.
   */
  sin_envio: boolean;
}

/**
 * Configuración de notificaciones resuelta desde el entorno. Todos los flags
 * son apagados por defecto. Nunca contiene secretos: solo indicadores de
 * presencia y listas de allowlist.
 */
export interface NotificationConfig {
  /** Kill-switch global. Debe ser true para siquiera considerar envío. */
  sendAlerts: boolean;
  /** Segundo interruptor explícito. Debe ser true además de sendAlerts. */
  allowRealAlerts: boolean;
  /** Fase inicial: exige envío SOLO interno. */
  internalOnly: boolean;
  /** Clientes permitidos para envío real (allowlist). */
  allowedClients: string[];
  /** Severidades permitidas para envío real. */
  allowedSeverities: Severidad[];
  /** Tope de alertas por corrida. */
  maxPerRun: number;
  /** Tope de alertas por día. */
  maxPerDay: number;
  /** Token de confirmación esperado (presencia + match exacto). */
  confirmationToken: string;
  /** Token entregado en runtime (CLI/env) para comparar. */
  providedToken: string;

  email: {
    enabled: boolean;
    /** Presencia de config SMTP (sin exponer valores). */
    smtpConfigured: boolean;
    /** Dominio SMTP (para log seguro, nunca password). */
    smtpHostDomain: string;
    /** Cantidad de destinatarios internos configurados (no los valores). */
    recipientsCount: number;
    recipients: string[];
    from: string;
  };

  whatsapp: {
    enabled: boolean;
    /** Presencia de credenciales Twilio (sin exponer valores). */
    twilioConfigured: boolean;
    recipientsCount: number;
    recipients: string[];
    from: string;
  };
}

/** Estado de un intento de notificación. */
export type SendStatus =
  | 'blocked' // guardas bloquearon (esperado en esta fase)
  | 'not_configured' // canal sin credenciales/destinatarios
  | 'dry_run' // se habría enviado, pero es simulación
  | 'sent' // enviado real (no ocurre en esta fase)
  | 'error'; // fallo del provider

/**
 * Resultado estructurado y AUDITABLE de un intento de notificación.
 * `recipient_hash` es un hash corto — nunca teléfono/email en claro.
 */
export interface SendResult {
  alert_id: string;
  cliente_id: string;
  severidad: Severidad;
  canal: Canal;
  recipient_hash: string;
  status: SendStatus;
  reason: string;
  would_send: boolean;
  sent_at: string | null;
  provider_message_id: string | null;
}

/** Resultado de la guarda central de envío real. */
export interface GuardResult {
  can_send: boolean;
  reason: string;
}

/** Contrato común de un provider de canal. */
export interface ChannelProvider {
  readonly canal: Canal;
  /** ¿Tiene credenciales + destinatarios para operar? (no implica poder enviar). */
  isConfigured(): boolean;
  /**
   * Procesa una alerta. En dry-run o con guardas bloqueando, NO envía y
   * devuelve un `SendResult` con el estado correspondiente.
   */
  send(alert: InternalAlert, opts: { dryRun: boolean; guard: GuardResult }): Promise<SendResult>;
}
