# GO / NO-GO — Piloto Interno CLI-0002

> Decisión de madurez del piloto interno de alertas para CLI-0002 (crisis_bebidas
> P1). Este documento **no activa nada**. Estado del módulo: **disabled by default**.
> Última actualización: 2026-07-08 (post-commit `ab32bcb`).

---

## 1. Checklist

| # | Ítem | Estado | Evidencia |
|---|---|---|---|
| 1 | Schedule **crisis** post-`e2fc9ea` limpio | ✅ | run `28915825440` (sha `ab32bcb`), `success`, MED-0170/0169/0171, 0 errores. |
| 2 | Schedule **daily** post-`e2fc9ea` limpio | ⏳ **PENDIENTE** | último daily `28878547298` es `2026-07-07T15:33Z` (sha `0dcbb9c`, pre-commit). Próximo ~`2026-07-08 12:45Z`. |
| 3 | `10_Alertas_Sombra` sin mismatch | ✅ | `filas_10_escritas=74 = readback=74`, `mismatch=false`. |
| 4 | `05/07` sin mismatch | ✅ | `filas_05_escritas=125`, `sheets_write_mismatch=false`, 07 +1 fila. |
| 5 | P1 FP ≤ 10 % | ✅ | Revisión humana de 10 P1 CLI-0002 → **FP 0 %** (8 REAL_CRISIS, 2 BORDERLINE). |
| 6 | Preview aprobado | ✅ | `PILOTO_INTERNO_CLI0002_PREVIEW.md`, plantillas correctas y marcadas PILOTO INTERNO. |
| 7 | Módulo default `blocked` | ✅ | dry-run: `would_send=0`, `blocked=10`, `reason=real_alerts_disabled`. |
| 8 | Dry-run sin envío | ✅ | `enviadas=0`, `envio_real_confirmado=false`. |
| 9 | Rollback documentado | ✅ | `ALERTAS_REALES_ACTIVACION.md` §8 y §6: `SEND_ALERTS=false` → guardas re-bloquean. |
| 10 | Credenciales **NO** configuradas | ✅ (a propósito) | `.env.example` con placeholders vacíos; `smtp_host_domain=null`, `twilio_configured=false`. |
| 11 | Destinatarios internos | ⏳ **PENDIENTE** | `INTERNAL_ALERT_EMAILS` / `INTERNAL_ALERT_WHATSAPP_NUMBERS` vacíos. |

---

## 2. Clasificación final

Estados posibles: `NO_GO` · `GO_SOLO_DRY_RUN` · `GO_CREDENCIALES_INTERNAS` · `GO_ENVIO_INTERNO_LIMITADO`.

### Veredicto: **GO_SOLO_DRY_RUN**

Justificación:

- La calidad de la señal y el módulo cumplen para **operar el piloto en dry-run**
  (preview + revisión humana), sin riesgo.
- **No** se puede subir a `GO_CREDENCIALES_INTERNAS` de forma completa hasta que:
  1. el **schedule daily post-commit** corra limpio (ítem 2), y
  2. se definan **destinatarios internos** (ítem 11).
- **No** se marca `GO_ENVIO_INTERNO_LIMITADO`: falta autorización explícita,
  credenciales, agrupación por cluster y transport cableado.

> Nota: en cuanto el daily post-commit corra limpio, el veredicto puede subir a
> **GO_CREDENCIALES_INTERNAS** (paso: configurar SMTP interno + destinatarios,
> aún sin enviar), previa autorización.

---

## 3. Bloqueantes

1. **Daily post-commit sin auditar** (correrá ~12:45Z del 2026-07-08).
2. **Sin destinatarios internos** definidos.
3. **Sin credenciales** SMTP/Twilio (intencional en esta fase).
4. **Transport real no cableado** (seam inyectable vacío; sin `nodemailer`/`twilio`).
5. **Sin agrupación por cluster**: 8/10 P1 son la misma crisis → riesgo de fatiga
   por volumen en envío real.

---

## 4. Siguiente paso seguro

1. **Auditar el daily post-commit** (MED-0083/0066/0006/0012) al correr.
2. Repetir dry-run + revisión humana con la ventana nueva.
3. Solo tras (1)+(2) limpios y autorización: subir a `GO_CREDENCIALES_INTERNAS`
   (configurar SMTP interno + destinatarios), **todavía sin enviar**.
4. `GO_ENVIO_INTERNO_LIMITADO` queda fuera de alcance hasta GO firmado.

---

## 5. Readiness técnico de canales (sin secretos, sin envío)

| canal | variables requeridas | dependencias | estado actual | qué falta para piloto interno | riesgo |
|---|---|---|---|---|---|
| **Email (SMTP)** | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `INTERNAL_ALERT_EMAILS` | `nodemailer` (**no instalada**; seam inyectable la evita hoy) | `EMAIL_ALERTS_ENABLED=false`, `smtp_host_domain=null`, transport no cableado → `not_configured`/`blocked` | (1) instalar `nodemailer`, (2) cablear `SmtpTransport`, (3) credenciales SMTP internas, (4) destinatarios internos, (5) test de transport | Bajo: apagado por defecto; sin credenciales no hay red. Riesgo real = fuga de credenciales si se configuran mal (mitigado: nunca se loggea password, solo dominio). |
| **WhatsApp (Twilio)** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`, `INTERNAL_ALERT_WHATSAPP_NUMBERS` | SDK Twilio (**no instalada**; seam `TwilioSender` la evita) | `WHATSAPP_ALERTS_ENABLED=false`, `twilio_configured=false` → `not_configured` | (1) instalar SDK/cablear `TwilioSender`, (2) credenciales Twilio, (3) número WhatsApp verificado, (4) destinatarios, (5) plantilla aprobada por WhatsApp Business | Medio: costo por mensaje + reglas de plantilla de WhatsApp Business; requiere número aprobado. Apagado por defecto. |

**Nota de dependencias**: no se instaló ninguna librería nueva en esta fase. Los
providers funcionan y se testean con un *transport inyectable* (fake en tests),
de modo que `npm run typecheck`/`npm test` pasan sin `nodemailer`/`twilio`. La
instalación se hará solo cuando exista GO y cobertura de tests del envío real.
