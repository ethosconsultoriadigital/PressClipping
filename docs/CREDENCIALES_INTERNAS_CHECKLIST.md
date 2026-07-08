# Checklist — Credenciales Internas (Piloto CLI-0002)

> **NO contiene secretos.** Es una guía para preparar/cargar credenciales del
> piloto interno en un entorno seguro **manteniendo el módulo apagado**
> (`SEND_ALERTS=false`, `ALLOW_REAL_ALERTS=false`). Cargar credenciales **no
> envía nada**: las 9 guardas de `assertCanSendRealAlerts` siguen bloqueando.
> Última actualización: 2026-07-08.

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
