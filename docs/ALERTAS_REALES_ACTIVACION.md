# Protocolo de Activación de Alertas Reales

> Estado actual: **NO ACTIVADO**. Todo el sistema opera en modo sombra
> (observación, sin envíos). Este documento define CÓMO y CUÁNDO se activarían
> alertas reales. Crearlo **no activa nada**.
> Última actualización: 2026-07-09 (Fase 1 piloto email CLI-0002 preparada, disabled).

---

## 0. Estado técnico de canales (bloqueante)

Antes de cualquier fase con envío real, hay un **prerequisito de ingeniería**:

- Existe un **módulo de envío interno preparado pero DISABLED BY DEFAULT**
  (`src/notifications/*`, `scripts/send-internal-alerts.ts`). Ver sección 8. No
  envía nada con la configuración por defecto: las guardas bloquean el envío real.
- Las alertas de producción siguen **simuladas** (`canal_simulado` en
  `10_Alertas_Sombra`). **No hay credenciales** Twilio ni Gmail/SMTP en el repo.
- **Novedad (2026-07-09)**: el transporte **email** ya está cableado con `nodemailer`
  a través de `createSmtpTransport` (`src/notifications/smtpTransport.ts`), pero
  **disabled by default**: el factory devuelve `null` salvo que TODAS las capas de
  habilitación estén activas (`SEND_ALERTS` + `ALLOW_REAL_ALERTS` + `EMAIL_ALERTS_ENABLED`
  + SMTP configurado + destinatarios). Con la config por defecto no se construye
  transporte → `EmailProvider` no envía. El transporte de **WhatsApp** sigue como
  seam inyectable vacío.
- Las guardas anti-envío operan en varias capas y deben permanecer:
  1. CLI shadow: `run-shadow-alerts.ts` aborta con exit 2 ante `--send/--whatsapp/--email`.
  2. Entorno shadow: `verificarEnvObservacion` aborta si `SEND_ALERTS` /
     `WHATSAPP_ENABLED` / `EMAIL_ENABLED` = `true`.
  3. Código: el tier crisis fuerza `send=false whatsapp=false email=false`.
  4. Módulo interno: `assertCanSendRealAlerts` exige 9 condiciones AND (sección 8).

**Conclusión**: el módulo ya está listo en modo apagado y el transporte email ya
está cableado (nodemailer, guardado). La activación real aún requiere (a)
autorización explícita, (b) credenciales SMTP internas, (c) habilitar los
kill-switches y (d) destinatarios internos — todo ausente/apagado hoy. Máxima
madurez alcanzable sin autorización: "piloto INTERNO en dry-run", sin envío real.

---

## 1. Principios

- Las alertas reales se activan **por cliente**, nunca globalmente.
- Activación **gradual** (por fases).
- **Primero CLI-0002 crisis** (señal más fuerte y precisa).
- No activar clientes generales sin validación.
- No activar WhatsApp y email simultáneamente en el primer paso.
- **Siempre conservar shadow-alerts** en paralelo (auditoría continua).

---

## 2. Clientes elegibles

Estados posibles: `NO_LISTO`, `LISTO_SHADOW`, `CANDIDATO_ALERTAS_REALES`, `SOLO_OBSERVACION`.

| cliente | evaluación | estado |
|---|---|---|
| CLI-0002 Bebidas alcohólicas | señal crisis fuerte, FP ~0 en P1 | **CANDIDATO_ALERTAS_REALES** (solo crisis_bebidas P1) |
| CLI-0003 Reforma laboral | señal real pero keywords amplias (incidental) | **LISTO_SHADOW** (aún no real) |
| CLI-0001 Jumex | cobertura débil, mayormente PC false positives | **NO_LISTO** (evaluar después) |
| CLI-PRUEBA | cliente de prueba | **SOLO_OBSERVACION** (nunca real) |

---

## 3. Umbrales de activación

### CLI-0002 crisis (piloto principal)

- Mínimo **3 schedules limpios consecutivos** del tier crisis.
- P1 FP estimado **<= 10%**.
- P1 duplicadas controladas (dedupe verificado).
- `10_Alertas_Sombra`: readback OK, `mismatch=false`.
- `05/07` sin mismatch.
- `send=false` confirmado en el entorno **antes** del cambio.
- Dedupe OK (`unique(noticia_id, keyword_id)`).
- Sin boilerplate; sin aranceles/T-MEC off-topic como P1.

> Estado hoy (post-`ab32bcb`): **1 schedule crisis post-commit limpio** (run
> `28915825440`, sha `ab32bcb`, MED-0170/0169/0171, 0 errores, `mismatch=false`,
> `send=false`). Faltan 2 schedules crisis más y el primer daily post-commit para
> cerrar "3 consecutivos con el tier ampliado". Revisión de P1 CLI-0002 y veredicto
> en `docs/PILOTO_INTERNO_CLI0002_PREVIEW.md` y `docs/PILOTO_INTERNO_CLI0002_GO_NO_GO.md`
> (veredicto actual: **GO_SOLO_DRY_RUN**, FP P1 = 0 %).

### CLI-0003 laboral

- Mínimo **5 schedules limpios**.
- FP P1 **<= 10%**.
- Sin keywords amplias incidentales (revisar `trabajadores`, `contrato`).
- Validación humana adicional.
- **No activar todavía.**

---

## 4. Fases de activación

| Fase | Descripción | Envío |
|---|---|---|
| **Fase 0** | Shadow only (estado actual). | Ninguno. |
| **Fase 1** | Alerta real interna por **email** solo al equipo MDP. | Email interno. |
| **Fase 2** | **WhatsApp** interno solo para crisis P1 CLI-0002. | WhatsApp interno. |
| **Fase 3** | Cliente externo con ventana controlada. | Externo acotado. |
| **Fase 4** | Producción multi-cliente. | Producción. |

Cada salto de fase requiere GO/NO-GO firmado (sección 7) y cumplir umbrales (sección 3).

---

## 5. Primer piloto recomendado

- **Cliente**: CLI-0002.
- **Tipo**: `crisis_bebidas` P1 (alcohol/tequila adulterado).
- **Fuentes**: cron crisis sombra (MED-0169 / MED-0170 / MED-0171).
- **Canal inicial**: email interno **o** WhatsApp interno (equipo MDP), **no** cliente externo.
- **Duración piloto**: 48–72h.
- **Límite**: máximo **5 alertas reales/día**.
- **Horario**: ventana laboral (p.ej. 08:00–20:00 CDMX) — definir con el equipo.
- **Prerequisito**: implementar módulo de envío + credenciales + plantilla (sección 0).

---

## 6. Condiciones de rollback

Revertir a Fase 0 (shadow only) de inmediato ante cualquiera de:

- Cualquier envío erróneo.
- FP P1 **> 10%**.
- Duplicados enviados.
- Mismatch en `10_Alertas_Sombra`.
- Fallo en `05/07`.
- Error de Twilio/Gmail.
- Queja de un receptor.
- Ruido por una fuente concreta.

**Rollback técnico**: poner `SEND_ALERTS=false` (y `WHATSAPP_ENABLED`/`EMAIL_ENABLED=false`)
en el entorno → las 3 guardas vuelven a bloquear envío. No requiere revertir código.

---

## 7. Checklist GO / NO-GO

Marcar TODO antes de subir de fase:

- [ ] N schedules limpios consecutivos (según cliente/umbral).
- [ ] P1 auditadas (FP <= umbral).
- [ ] Dedupe validado.
- [ ] Canales validados (config + módulo de envío implementado).
- [ ] Destinatarios internos confirmados.
- [ ] Mensaje/plantilla aprobado.
- [ ] Rollback documentado y probado.
- [ ] Log de envío disponible (auditable).

Si algún ítem falla → **NO-GO**, permanecer en la fase actual.

---

## 8. Módulo de envío interno (preparado / disabled by default)

> Estado: **PREPARADO, APAGADO**. El módulo existe pero **no envía nada** con la
> configuración por defecto. No documentar como activo.

### Archivos

- `src/notifications/types.ts` — tipos (`InternalAlert`, `NotificationConfig`, `SendResult`).
- `src/notifications/guards.ts` — `loadNotificationConfig`, `assertCanSendRealAlerts`, `hashRecipient`.
- `src/notifications/templates.ts` — plantillas email/WhatsApp (marcadas PILOTO INTERNO).
- `src/notifications/emailProvider.ts` — SMTP vía transport inyectable (`SmtpTransport`).
- `src/notifications/smtpTransport.ts` — **factory `createSmtpTransport`**: construye
  transporte `nodemailer` real SOLO si el canal está plenamente autorizado; si no,
  devuelve `null` (fase actual). Import dinámico: nodemailer no se carga salvo autorización.
- `src/notifications/whatsappProvider.ts` — Twilio vía sender inyectable (`not_configured`).
- `src/notifications/notificationService.ts` — orquesta guardas + providers.
- `scripts/send-internal-alerts.ts` — CLI dry-run por defecto; cablea el transporte
  vía `createSmtpTransport` (null hoy) y loggea `smtp_transport`/`transport_reason`.

### Fase 1 — piloto interno email CLI-0002 preparado, disabled by default

Estado tras 2026-07-09:

- **Provider email**: cableado (`nodemailer` instalado; `createSmtpTransport` guardado).
- **Kill-switches** (`.env.example`, valores por defecto): `SEND_ALERTS=false`,
  `ALLOW_REAL_ALERTS=false`, `EMAIL_ALERTS_ENABLED=false`, `ALERTS_INTERNAL_ONLY=true`,
  `ALERTS_ALLOWED_CLIENTS=CLI-0002`, `ALERTS_ALLOWED_SEVERITIES=P1`,
  `ALERTS_MAX_PER_RUN=5`, `ALERTS_MAX_PER_DAY=5`. Todos apagados/acotados.
- **Dry-run digest CLI-0002** (`--dry-run --digest --limit=20`): 196 P1 CLI-0002 →
  2 clusters (crisis bebidas adulteradas Guanajuato 14 + Nacional 6). Resultado:
  `smtp_transport=null`, `transport_reason=send_alerts_disabled`, `blocked=4`,
  `would_send=0`, `enviadas=0`, `envio_real_confirmado=false`.
- **Falta para cargar credenciales** (cuando haya GO): definir destinatarios internos
  (`INTERNAL_ALERT_EMAILS`), cargar `SMTP_HOST/PORT/USER/PASS/FROM` y
  `REAL_ALERTS_CONFIRMATION_TOKEN` como secrets (NO en `.env`), y recién entonces
  activar los kill-switches. Ver `docs/CREDENCIALES_INTERNAS_CHECKLIST.md`.

### GO_CREDENCIALES_INTERNAS — SMTP cargado pero apagado (2026-07-09)

Estado objetivo: credenciales SMTP internas **cargables fuera del repo con el módulo
apagado**. Cargar credenciales **no envía nada**.

- **Se cargan** (fuera del repo: GitHub Secrets / `.env` local ignorado / secret manager):
  `SMTP_HOST/PORT/USER/PASS/FROM`, `INTERNAL_ALERT_EMAILS`, `REAL_ALERTS_CONFIRMATION_TOKEN`.
- **Sigue apagado:** `SEND_ALERTS=false`, `ALLOW_REAL_ALERTS=false`, `EMAIL_ALERTS_ENABLED=false`.
- **Comportamiento garantizado:** con switches apagados, `createSmtpTransport` **no**
  construye transporte real (aunque haya credenciales) → **sin llamada SMTP externa**;
  las guardas devuelven `real_alerts_disabled`.
- **Validación (2026-07-09)** con credenciales ficticias locales: `smtp_host_domain`
  detectado, `email_recipients=1`, pero `smtp_transport=null`
  (`transport_reason=send_alerts_disabled`), `blocked=4`, `enviadas=0`,
  `envio_real_confirmado=false`, sin fuga de `SMTP_PASS`/destinatarios.
- **Rollback:** switches en `false` + vaciar `INTERNAL_ALERT_EMAILS` + rotar `SMTP_PASS`
  si se expuso. Detalle y transición a `GO_ENVIO_INTERNO_LIMITADO` (requiere autorización
  explícita) en `docs/CREDENCIALES_INTERNAS_CHECKLIST.md` §7.

### Checklist previo a GO_ENVIO_INTERNO_LIMITADO (2026-07-09)

Puerta de salida del piloto apagado. Ver tabla completa en
`docs/CREDENCIALES_INTERNAS_CHECKLIST.md` §8. Estado resumido:

- ✅ Listos (código/infra): dry-run con SMTP real sigue `blocked` (lógica validada),
  digest CLI-0002 estable (2 clusters), rollback documentado.
- ⏳ Pendientes (operativos): cron post-`bde7d23` limpio con MED-0005/MED-0049, SMTP
  real cargado fuera del repo, recipient hashes revisados, y **autorización explícita**.
- `GO_ENVIO_INTERNO_LIMITADO` **no** habilitado; esta fase **no envía nada**.

### Variables requeridas (todas apagadas por defecto)

`SEND_ALERTS`, `ALLOW_REAL_ALERTS`, `ALERTS_INTERNAL_ONLY`, `ALERTS_ALLOWED_CLIENTS`,
`ALERTS_ALLOWED_SEVERITIES`, `ALERTS_MAX_PER_RUN`, `ALERTS_MAX_PER_DAY`,
`REAL_ALERTS_CONFIRMATION_TOKEN`, `EMAIL_ALERTS_ENABLED`, `SMTP_*`,
`INTERNAL_ALERT_EMAILS`, `WHATSAPP_ALERTS_ENABLED`, `TWILIO_*`,
`INTERNAL_ALERT_WHATSAPP_NUMBERS`. Ver `.env.example`.

### Guardas (`assertCanSendRealAlerts`) — 9 capas AND

1. `SEND_ALERTS=true` · 2. `ALLOW_REAL_ALERTS=true` · 3. token presente y coincide ·
4. `ALERTS_INTERNAL_ONLY=true` · 5. cliente ∈ allowlist · 6. severidad ∈ allowlist ·
7. hay destinatarios internos · 8. canal habilitado · 9. `sin_envio=false` explícito.
En ejecución normal: `can_send=false`, `reason=real_alerts_disabled`.

### Comando dry-run (seguro, NO envía)

```bash
npm run send-internal-alerts -- --dry-run --client=CLI-0002 --severity=P1 --limit=5
```

Muestra preview de plantillas y resultados `blocked`/`dry_run`; nunca envía.

### Comando futuro send-real (requiere autorización)

```bash
# Solo tras GO firmado, credenciales cableadas y env habilitado:
npm run send-internal-alerts -- --send-real --client=CLI-0002 --severity=P1 --limit=5 --token=<TOKEN>
```

Aun con `--send-real`, si el entorno no autoriza (9 capas) NO envía.

### Rollback

Poner `SEND_ALERTS=false` (o `ALLOW_REAL_ALERTS=false`, o vaciar destinatarios) →
todas las guardas vuelven a bloquear. No requiere revertir código.

### Carga de credenciales internas

El procedimiento para preparar/cargar credenciales internas **sin enviar** (con
`SEND_ALERTS=false`) está en `docs/CREDENCIALES_INTERNAS_CHECKLIST.md`. Solo aplica
cuando el GO/NO-GO llegue a `GO_CREDENCIALES_INTERNAS`.
