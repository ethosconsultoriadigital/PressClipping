# Checklist — Credenciales Internas (Piloto CLI-0002)

> **NO contiene secretos.** Es una guía para preparar/cargar credenciales del
> piloto interno en un entorno seguro **manteniendo el módulo apagado**
> (`SEND_ALERTS=false`, `ALLOW_REAL_ALERTS=false`). Cargar credenciales **no
> envía nada**: las 9 guardas de `assertCanSendRealAlerts` siguen bloqueando.
> Última actualización: 2026-07-09 (transporte email cableado con `nodemailer`, apagado).

---

## 0. Precondición

- [ ] Estado GO/NO-GO ≥ `GO_CREDENCIALES_INTERNAS` (requiere daily post-`ab32bcb`
      auditado limpio). Mientras siga `GO_SOLO_DRY_RUN`, **no cargar credenciales**.

---

## 1. Variables email internas

| variable | valor en esta fase | nota |
|---|---|---|
| `SMTP_HOST` | *(pendiente)* | host del SMTP interno; solo se loggea el dominio. |
| `SMTP_PORT` | *(pendiente)* | típicamente 587 (STARTTLS). |
| `SMTP_USER` | *(pendiente)* | usuario de la cuenta emisora. |
| `SMTP_PASS` | *(pendiente)* | **NUNCA** en repo ni logs. |
| `SMTP_FROM` | *(pendiente)* | remitente visible. |
| `INTERNAL_ALERT_EMAILS` | *(pendiente)* | destinatarios INTERNOS (equipo MDP). |
| `EMAIL_ALERTS_ENABLED` | `false` | mantener en false tras cargar credenciales. |

> **Transporte email ya cableado (2026-07-09).** `createSmtpTransport`
> (`src/notifications/smtpTransport.ts`) construye un transporte `nodemailer` real
> **solo** si `SEND_ALERTS` + `ALLOW_REAL_ALERTS` + `EMAIL_ALERTS_ENABLED` están en
> `true`, SMTP está configurado y hay destinatarios. Mientras estos sigan en `false`
> el factory devuelve `null` y no se abre ninguna conexión SMTP. Cargar `SMTP_*` con
> los kill-switches apagados es seguro: no envía ni conecta.

## 2. Variables WhatsApp internas

| variable | valor en esta fase | nota |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | *(pendiente)* | credencial Twilio. |
| `TWILIO_AUTH_TOKEN` | *(pendiente)* | **NUNCA** en repo ni logs. |
| `TWILIO_WHATSAPP_FROM` | *(pendiente)* | número WhatsApp Business aprobado. |
| `INTERNAL_ALERT_WHATSAPP_NUMBERS` | *(pendiente)* | destinatarios internos. |
| `WHATSAPP_ALERTS_ENABLED` | `false` | mantener en false; WhatsApp va **después** de email. |

## 3. Kill switches obligatorios

| variable | valor obligatorio en esta fase |
|---|---|
| `SEND_ALERTS` | `false` |
| `ALLOW_REAL_ALERTS` | `false` |
| `ALERTS_INTERNAL_ONLY` | `true` |
| `ALERTS_ALLOWED_CLIENTS` | `CLI-0002` |
| `ALERTS_ALLOWED_SEVERITIES` | `P1` |
| `ALERTS_MAX_PER_RUN` | `5` |
| `ALERTS_MAX_PER_DAY` | `5` |
| `REAL_ALERTS_CONFIRMATION_TOKEN` | *(definir fuera del repo; no versionar)* |

## 4. Reglas para cargar secretos

- [ ] **No** cargar secretos en `.env` versionado.
- [ ] **No** commitear `.env`.
- [ ] **No** imprimir secretos.
- [ ] **No** pegar tokens en logs.
- [ ] Primero configurar **solo email interno**, no WhatsApp.
- [ ] Mantener `EMAIL_ALERTS_ENABLED=false` tras cargar credenciales.
- [ ] Mantener `SEND_ALERTS=false` y `ALLOW_REAL_ALERTS=false`.

> El código nunca loggea password/token/número: `guards.ts` solo expone el dominio
> SMTP y hashea destinatarios. Aun así, las credenciales deben vivir fuera del repo
> (variables de entorno del runner o gestor de secretos).

## 5. Orden recomendado

1. [ ] Cargar credenciales SMTP internas (entorno seguro).
2. [ ] Cargar destinatarios internos (`INTERNAL_ALERT_EMAILS`).
3. [ ] Mantener `SEND_ALERTS=false`.
4. [ ] Ejecutar dry-run digest:
   ```bash
   npm run send-internal-alerts -- --dry-run --client=CLI-0002 --severity=P1 --limit=20 --digest
   ```
5. [ ] Confirmar que sigue **bloqueado** (`would_send=0`, `enviadas=0`,
       `reason=real_alerts_disabled`). Con credenciales cargadas pero
       `SEND_ALERTS=false`, el resultado esperado sigue siendo `blocked`.
6. [ ] Recién después: pedir **autorización explícita** para piloto real interno
       (subir a `GO_ENVIO_INTERNO_LIMITADO`, fuera de alcance de esta fase).

---

## 6. Rollback

- Poner `SEND_ALERTS=false` (o vaciar destinatarios / `ALLOW_REAL_ALERTS=false`)
  → las guardas vuelven a bloquear. No requiere revertir código.
- Para desmontar por completo: quitar las variables del entorno del runner.

---

## 7. GO_CREDENCIALES_INTERNAS — SMTP cargado pero apagado

> Estado objetivo de esta fase: **credenciales SMTP internas preparadas/cargadas
> fuera del repo, con el módulo APAGADO**. No implica ningún envío. Terminar aquí;
> **no** avanzar a `GO_ENVIO_INTERNO_LIMITADO` sin autorización explícita.

### 7.1 Qué variables se cargan

`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`,
`INTERNAL_ALERT_EMAILS` (destinatarios internos del equipo) y, opcionalmente,
`REAL_ALERTS_CONFIRMATION_TOKEN`.

### 7.2 Dónde se cargan (nunca en el repo)

- **GitHub Secrets** del repo/entorno (para runs en Actions), **o**
- **archivo `.env` local ignorado por git** (ya está en `.gitignore`), **o**
- un **secret manager** / variables de entorno del runner seguro.

**Prohibido:** escribir valores reales en `.env.example`, commitear `.env`, imprimir
password o destinatarios completos.

### 7.3 Qué sigue apagado (obligatorio en esta fase)

`SEND_ALERTS=false`, `ALLOW_REAL_ALERTS=false`, `EMAIL_ALERTS_ENABLED=false`.
Con esto, `createSmtpTransport` devuelve `null` (no construye transporte) y las
guardas bloquean con `real_alerts_disabled`.

### 7.4 Cómo validar (dry-run, no envía)

```bash
npm run send-internal-alerts -- --dry-run --client=CLI-0002 --severity=P1 --limit=20 --digest
```

### 7.5 Cómo confirmar que NO hubo envío

En el log del dry-run debe verse:

- `smtp_host_domain` = dominio del SMTP (config **detectada**), `email_recipients` ≥ 1.
- `smtp_transport: "null"`, `transport_reason: "send_alerts_disabled"` (o
  `email_channel_disabled`) → **transporte no creado**, **sin llamada SMTP externa**.
- `bloqueadas > 0`, `reason=real_alerts_disabled`, `would_send=0`, `enviadas=0`,
  `envio_real_confirmado=false`.
- El password y los destinatarios completos **no aparecen** en ningún log.

> Validado 2026-07-09 con credenciales ficticias en entorno local: config detectada
> (`smtp_host_domain` presente, `email_recipients=1`) pero `smtp_transport=null`,
> `blocked=4`, `enviadas=0`. Sin fuga de `SMTP_PASS` ni de destinatarios.

### 7.6 Rollback

- `SEND_ALERTS=false`, `ALLOW_REAL_ALERTS=false`, `EMAIL_ALERTS_ENABLED=false`.
- Vaciar `INTERNAL_ALERT_EMAILS`.
- Si `SMTP_PASS` se expuso por accidente: **rotar la credencial** de inmediato.
- Quitar las variables del entorno del runner para desmontar por completo.

### 7.7 Qué falta para `GO_ENVIO_INTERNO_LIMITADO` (fuera de alcance)

- **Autorización explícita** del usuario para enviar interno.
- Activar kill-switches (`SEND_ALERTS`/`ALLOW_REAL_ALERTS`/`EMAIL_ALERTS_ENABLED=true`)
  con `REAL_ALERTS_CONFIRMATION_TOKEN` definido y pasado por `--token`.
- Ejecutar con `--send-real` (rechazado por las guardas hasta cumplir las 9 capas).
- Ventana horaria, tope diario y destinatarios internos confirmados.
