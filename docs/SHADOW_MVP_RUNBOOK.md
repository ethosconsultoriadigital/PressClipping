# Runbook Operativo — Shadow MVP (PressClipping / Ethos PR Intelligence)

> Estado: **SHADOW / OBSERVACIÓN**. Sin envíos reales, sin producción.
> Última actualización: 2026-07-07 (post-commit `e2fc9ea`).

Este runbook describe qué corre hoy en modo sombra, cómo operarlo día a día y
cómo responder a incidentes. **Nada aquí envía alertas reales.** La activación de
alertas se rige por `docs/ALERTAS_REALES_ACTIVACION.md`.

---

## 1. Qué está corriendo

Cuatro tiers de comparación en modo sombra (GitHub Actions, sobre la rama por
defecto). Todos escriben a Google Sheets de salida y **nunca** envían WhatsApp/
correo ni llaman Twilio/Gmail/SMTP.

| Tier | Workflow | Medios | Frecuencia (cron) |
|---|---|---|---|
| Base shadow | `live-comparison-shadow.yml` | 25 | ~cada 4h |
| Nacional B | (tier nacional) | 2 (Uno TV, Publimetro) | `0 */6` (6h) |
| Crisis shadow | `live-comparison-shadow-crisis.yml` | 3 | `15 */6` (6h, minuto 15) |
| Daily validated | `live-comparison-shadow-daily-validated.yml` | 4 | `45 12 * * *` (diario 12:45 UTC) |

Todos comparten `concurrency: group: live-comparison-shadow` con
`cancel-in-progress: false` (no se pisan entre sí).

---

## 2. Frecuencia

- **Base**: ~cada 4 horas.
- **Nacional B**: cada 6 horas.
- **Crisis**: cada 6 horas (minuto 15, desfasado del base).
- **Daily validated**: 1 vez al día (12:45 UTC).

---

## 3. Medios por tier

### Crisis shadow (fuente por medio, loop aislado)

| medio_id | medio | fuente | frecuencia | estado |
|---|---|---|---|---|
| MED-0170 | UNO MAS UNO | sitemap | 6h | estable (RSS rota crisis) |
| MED-0169 | El Sol de Irapuato | rss | 6h | ESTABLE (5+ schedules limpios) |
| MED-0171 | El Otro Enfoque | rss | 6h | 1er schedule automático limpio (run `28915825440`) |

### Daily validated (fuente `auto` = cascada del medio)

| medio_id | medio | fuente | frecuencia | estado |
|---|---|---|---|---|
| MED-0083 | Zeta Tijuana | auto | diario | estable |
| MED-0066 | Revista Espejo | auto | diario | estable |
| MED-0006 | marcomares.com.mx | auto (sitemap) | diario | nuevo (solo evidencia manual) |
| MED-0012 | Paralelo 19 | auto (sitemap) | diario | nuevo (solo evidencia manual) |

### Nacional B

| medio_id | medio | frecuencia | notas |
|---|---|---|---|
| MED-0025 | Uno TV Noticias | 6h | sin prefiltro |
| MED-0053 | Publimetro | 6h | prefiltro de título (anti deportes/espectáculos) |

### Base shadow (25 medios)

Lista curada en `src/config/shadowMedia.ts` → `SHADOW_MEDIOS` (El Economista, El
Informador, Forbes México, El Financiero, Expansión, Proceso, La Razón, etc.).
Fuente de verdad: el archivo de config, no este runbook.

---

## 4. Clientes cubiertos (keywords activas en detección)

| cliente_id | cliente | señal shadow |
|---|---|---|
| CLI-0001 | Jumex | débil / mayormente PC false positives |
| CLI-0002 | Bebidas alcohólicas | fuerte (crisis tequila/alcohol adulterado) |
| CLI-0003 | Reforma laboral | media (laboral real + riesgo de keywords amplias) |
| CLI-PRUEBA | Cliente de prueba | solo test — nunca activar real |

Detalle en `docs/CLIENT_READINESS.md`.

---

## 5. Hojas de control (Google Sheets de salida)

| Pestaña | Qué contiene |
|---|---|
| `05_Comparativo_PressClipping` | Comparativo Ethos vs PressClipping por ventana. |
| `07_Metricas_Live` | Histórico de métricas por ciclo (append). |
| `08_Cobertura_Medios` | Estado por medio (162 filas). Writer seguro por merge. |
| `10_Alertas_Sombra` | Alertas simuladas (P1/P2/bloqueadas/duplicadas), sin envío. |

---

## 6. Qué revisar a diario

1. **Workflow status**: `gh run list --workflow=<wf> --limit=10` (todos `success`).
2. **05/07 mismatch**: `sheets_write_mismatch=false` en el resumen del ciclo.
3. **10_Alertas_Sombra**: P1/P2, `filas_10_escritas == filas_10_readback`, `mismatch=false`.
4. **P1 FP**: auditar P1 por `run_id` (máx 20). FP severo → no avanzar.
5. **Medios con errores**: `totalErrores` en crawl; medios `estado=error`.
6. **Fuentes con 0 cuerpo**: `enrich ... fallidas > 0` / `conCuerpoNota=0`.
7. **Menciones insertadas**: `detect real ... menciones`.
8. **Cobertura vs PressClipping**: `cobertura_ajustada`, `solo_pressclipping_accionables`.

Confirmar **siempre**: `send=false whatsapp=false email=false`.

---

## 7. Incidentes comunes

| Incidente | Síntoma |
|---|---|
| Sheet 429 | `[429] Quota exceeded` (hay backoff automático; suele resolver solo). |
| Fuente 403 | crawl `HTTP 403 ... (no reintentable)`, medio `estado=error`. |
| Boilerplate | potencial de mención sobre página de sección/listing. |
| Feed re-estampado | fuente alterna sirve contenido de OTRO medio. |
| Cuerpo vacío | crawl OK pero enrich `fallidas`, `conCuerpoNota=0`. |
| Duplicados | `duplicados` alto en crawl (esperado si ya cubierto). |
| P1 falso | alerta P1 sobre nota off-topic (aranceles/deportes/clima). |
| Workflow cancelled | run `conclusion=cancelled` (revisar concurrency/timeout). |

---

## 8. Acciones correctivas

- **Sacar medio del tier**: `activo_shadow: false` (o quitarlo) en `src/config/shadowMedia.ts`.
- **Marcar `REVISAR_MANUAL`** en `08_Cobertura_Medios` (writer seguro por merge).
- **Bloquear detect real** para un medio: sacarlo del `--medio-ids` / del tier.
- **Revertir fuente** en Supabase (`medios`) al estado previo si una reparación falla (p.ej. 403 al crawler).
- **Mantener shadow only**: ante cualquier duda, NO activar envíos.

Toda corrección de tier requiere `npm run typecheck && npm test` + commit.

---

## 9. Módulo de envío interno (preparado / disabled by default)

> **PREPARADO, APAGADO.** No envía nada por defecto. No corre en GitHub Actions
> (no hay workflow). El piloto interno se ejecuta **manualmente** tras autorización.
> Protocolo completo: `docs/ALERTAS_REALES_ACTIVACION.md` §8.

- **Archivos**: `src/notifications/*` + `scripts/send-internal-alerts.ts`.
- **Variables**: ver `.env.example` (bloque "Módulo de envío interno"). Todas
  apagadas por defecto (`SEND_ALERTS=false`, `ALLOW_REAL_ALERTS=false`).
- **Guardas**: `assertCanSendRealAlerts` — 9 condiciones AND. Normal:
  `can_send=false, reason=real_alerts_disabled`.
- **Dry-run (seguro, NO envía)**:

```bash
npm run send-internal-alerts -- --dry-run --client=CLI-0002 --severity=P1 --limit=5
```

- **Futuro send-real (requiere GO + credenciales + env habilitado)**:

```bash
npm run send-internal-alerts -- --send-real --client=CLI-0002 --severity=P1 --limit=5 --token=<TOKEN>
```

- **Rollback**: `SEND_ALERTS=false` (o vaciar destinatarios) → guardas bloquean.
- **Seguridad**: nunca loggea password/token/número; destinatarios sólo por hash.
- **Piloto CLI-0002**: revisión y veredicto en `docs/PILOTO_INTERNO_CLI0002_PREVIEW.md`
  y `docs/PILOTO_INTERNO_CLI0002_GO_NO_GO.md` (actual: **GO_SOLO_DRY_RUN**; bloqueante
  único = daily post-`ab32bcb`). Carga de credenciales: `docs/CREDENCIALES_INTERNAS_CHECKLIST.md`.
- **Digest anti-fatiga**: `--digest` agrupa P1 de la misma crisis (20 → 2 clusters).

---

## 10. No hacer

- No `export-results`, `generate-xml`, `classify-ia`, `export-raw-news`.
- No activar clientes (`clientes.alertas_activas`).
- No enviar alertas sin GO formal (ver protocolo de activación).
- No borrar noticias ni menciones.
- No tocar `01_Noticias_Raw`, `02_Menciones`, `04_Logs`.
- No usar proxy / Playwright / bypass de paywall.
- No crawl masivo ni altas masivas.
