# Plan de Producción — Ethos PR Intelligence

_Creado 2026-07-08 (fase "Paridad de Medios + Ruta Rápida a Producción")._
_Ruta escalonada y reversible desde shadow medible hasta sustitución global. Cada fase
tiene criterio de entrada/salida, riesgos, rollback y qué se activa / qué NO._

> Principio rector: **nada se activa hacia afuera sin evidencia medible y sin un
> rollback trivial**. El módulo de envío permanece _disabled by default_ hasta la Fase 1.

---

## Fase 0 — Shadow medible (ACTUAL)

- **Qué es:** crons shadow (base/nacional B/crisis/daily) que crawlean, extraen,
  detectan y comparan contra PressClipping, **sin enviar nada**.
- **Criterio de entrada:** ✅ ya cumplido (crons activos, comparativo en Sheets).
- **Criterio de salida:**
  - Paridad de medios medida (✅ ver `MEDIA_PARITY_MATRIX.md`).
  - Precisión validada en ≥1 cliente (✅ CLI-0002 tequila, FP bajo).
  - Alertas shadow trazables (✅ `10_Alertas_Sombra` con prioridad/estado).
- **Qué se activa:** solo observación (Sheets, shadow-alerts).
- **Qué NO:** envíos, IA, export-results, generate-xml.
- **Riesgos:** falsa sensación de cobertura; **mitigación:** matriz de paridad + readiness report.
- **Rollback:** desactivar `activo_shadow` en `shadowMedia.ts` (config-only).

## Fase 1 — Piloto interno CLI-0002 email (credenciales apagadas primero)

- **Qué es:** envío de alertas P1/P2 de CLI-0002 a un buzón **interno** (equipo Ethos),
  no al cliente.
- **Criterio de entrada:**
  - CLI-0002 en `SHADOW_ESTABLE` con FP ≤15% sostenido 7 días.
  - GO_CREDENCIALES_INTERNAS cerrado (checklist `docs/CREDENCIALES_INTERNAS_CHECKLIST.md`).
  - Digest de P1 repetidos funcionando (anti-fatiga).
- **Criterio de salida:**
  - ≥1 semana de envíos internos sin falsos P1 relevantes.
  - Latencia y formato validados por el equipo.
- **Qué se activa:** `notificationService` con `email` interno, `send_enabled=true`
  **solo** para allowlist interna; primero **dry-run con credenciales vacías**.
- **Qué NO:** WhatsApp, envío a cliente externo, Twilio/SMTP hacia fuera del equipo.
- **Riesgos:** fuga de alerta a destino equivocado; **mitigación:** allowlist interna
  + `shadow_client_allowlist` + arranque con credenciales apagadas.
- **Rollback:** `send_enabled=false` (flag), revocar credenciales.

## Fase 2 — Reporte diario interno por cliente

- **Qué es:** digest diario interno (no alertas en tiempo real) por cliente, con
  menciones, P1/P2, gaps vs PressClipping.
- **Criterio de entrada:** Fase 1 estable ≥2 semanas; ≥2 clientes en `SHADOW_ESTABLE`.
- **Criterio de salida:** reporte reproducible, revisado por analista, sin ruido dominante.
- **Qué se activa:** generación de digest interno (email interno).
- **Qué NO:** entrega a cliente externo.
- **Riesgos:** ruido/promo en el digest; **mitigación:** puertas contextuales por cliente
  (tequila CLI-0002, Jumex CLI-0001) + clasificación de gaps.
- **Rollback:** desactivar el job de digest.

## Fase 3 — Cliente externo acotado (1 cliente, opt-in)

- **Qué es:** un cliente real recibe alertas/reporte, con SLA acotado y revisión humana previa.
- **Criterio de entrada:** Fase 2 estable; cliente piloto acepta condiciones; revisión
  humana en el loop; cobertura de medios del cliente ≥ PressClipping en su vertical.
- **Criterio de salida:** satisfacción del cliente; FP ≤10%; cobertura ≥ PC en su tema.
- **Qué se activa:** envío externo a 1 cliente, con `human-in-the-loop`.
- **Qué NO:** múltiples clientes, sustitución de PressClipping.
- **Riesgos:** reputacional si falla una alerta; **mitigación:** revisión humana previa,
  rollback inmediato, se mantiene PressClipping en paralelo.
- **Rollback:** apagar envío del cliente; PressClipping sigue activo.

## Fase 4 — Sustitución parcial de PressClipping

- **Qué es:** para verticales/clientes donde Ethos demuestra cobertura ≥ PC, se deja de
  depender de PressClipping.
- **Criterio de entrada:** ≥3 clientes estables en externo; paridad de medios ≥ PC por
  vertical; backtest 7–14 días con match alto y solo_pc accionable ~0.
- **Criterio de salida:** métricas sostenidas 1 mes; sin gaps accionables recurrentes.
- **Qué se activa:** baja de PressClipping en las verticales cubiertas.
- **Qué NO:** baja global.
- **Riesgos:** perder cobertura de cola larga PC; **mitigación:** mantener PC en verticales
  no cubiertas; monitor de gap continuo.
- **Rollback:** reactivar PressClipping en la vertical.

## Fase 5 — Sustitución global

- **Qué es:** Ethos reemplaza a PressClipping en todos los clientes/verticales.
- **Criterio de entrada:** Fase 4 sostenida ≥2 meses en todas las verticales; paridad
  global ≥ PC; procesos de soporte/rollback probados.
- **Criterio de salida:** N/A (estado objetivo).
- **Qué se activa:** operación completa sobre Ethos.
- **Qué NO:** —
- **Riesgos:** dependencia total; **mitigación:** SLA, redundancia de fuentes, monitor de
  gap y de salud de fuentes (403/paywall).
- **Rollback:** contrato PressClipping en standby reactivable.

---

## Progreso — Aceleración Controlada (2026-07-09)

Fase de "Piloto Interno CLI-0002 + Lote P1 de Medios". Sin producción, sin envíos.

### Carril A — Cron post-`bde7d23`

- **GATE_DAILY_POST_BDE7D23_LIMPIO ✅ CERRADO (2026-07-11).**
- **Run schedule** (primero post-`bde7d23`): `29103114449` — event=schedule,
  headSha=`1623645` (HEAD), 2026-07-10T15:17:41Z, conclusion=success, duración 10m33s.
- **Run manual** (validación explícita): `29139253475` — event=workflow_dispatch,
  headSha=`1623645`, 2026-07-11T04:13:07Z, conclusion=success, duración 9m37s.
- **MED-0005 lado.mx:** `estado=ok`, insertadas=0 (duplicadas del catálogo), duplicados=30,
  errors=0; detect 5 menciones SOLO_ETHOS_BORDERLINE (Tequila×2, Jumex×1, Reforma laboral×2).
- **MED-0049 Telediario Monterrey:** `estado=ok`, insertadas=29 (primera corrida), duplicados=1,
  errors=0; detect 1 mención SOLO_ETHOS_BORDERLINE.
- Gate detect dry-run: `potenciales≤3`, `gate_pasa=true`, `decisionDetect=SHADOW_OK` en ambos runs.
- **Sin flood, sin boilerplate, sin FP severo, sin turismo/deporte dominante.**
- Gate Carril A **cerrado**. Próxima ventana de alta de medios habilitada.

### Carril B — Lote P1 `EN_CATALOGO_NO_CRON` (auditoría read-only)

| medio | id | en catálogo | estado_08 | texto_ok | PC | clasificación |
|---|---|---|---|---|---|---|
| Noroeste | MED-0055 | sí | ok | 58% (20/48 vacías) | 6 | **P1_REENRICH_PRIMERO** |
| Excelsior | MED-0028 | sí | error | 0% (0 notas) | 11 | **P1_REPARAR_FUENTE** |
| La Silla Rota | — | no | — | — | 11 | **P2_AUDITAR_MANUAL** (fuente nueva) |
| Jalisco Hoy | — | no | — | — | 9 | **P2_AUDITAR_MANUAL** (fuente nueva) |
| Noticias México 24 | — | no | — | — | 10 | **P2_AUDITAR_MANUAL** (fuente nueva) |
| Hoy Tamaulipas | — | no | — | — | 9 | **P2_AUDITAR_MANUAL** (fuente nueva) |
| AM (Guanajuato) | ambiguo | — | — | — | ~7 | **P2_AUDITAR_MANUAL** (no hay match claro) |

- **Ninguno es `P1_LISTO_CRON` inmediato.** Noroeste necesita re-enrich (texto 58%);
  Excelsior necesita reparar fuente (estado error, 0 notas); el resto no está en el
  catálogo Ethos (serían altas de fuente nueva, fuera del alcance `EN_CATALOGO_NO_CRON`).
- **Riesgos:** los 4 candidatos "fuente nueva" concentran señal PC de cola media
  (Bebidas alcohólicas / Empresas / Reforma laboral); requieren alta de catálogo +
  auditoría técnica (RSS/sitemap, bloqueo, FP) antes de considerar cron.

### Carril C — Fase 1 piloto email CLI-0002 (preparado, disabled)

- **Provider email cableado**: `nodemailer` instalado; `createSmtpTransport`
  (`src/notifications/smtpTransport.ts`) construye transporte real **solo** con todas
  las capas activas; hoy devuelve `null` (`send_alerts_disabled`).
- **Kill-switches** (`.env.example`) apagados/acotados: `SEND_ALERTS=false`,
  `ALLOW_REAL_ALERTS=false`, `EMAIL_ALERTS_ENABLED=false`, `ALERTS_INTERNAL_ONLY=true`,
  `ALERTS_ALLOWED_CLIENTS=CLI-0002`, `ALERTS_ALLOWED_SEVERITIES=P1`, `MAX_PER_RUN/DAY=5`.
- **Dry-run digest CLI-0002**: 196 P1 → 2 clusters (Guanajuato 14 + Nacional 6);
  `blocked=4`, `would_send=0`, `enviadas=0`, `envio_real_confirmado=false`.
- **Falta para cargar credenciales:** GO explícito + destinatarios internos + secrets
  SMTP fuera del repo. Ver `docs/CREDENCIALES_INTERNAS_CHECKLIST.md`.

### Carril D — Decisión de avance

- Gate Carril A **cerrado** (cron post-`bde7d23` limpio, `29103114449` + `29139253475`). ✅
- Próxima ventana de alta habilitada: Noroeste (re-enrich texto 58%) o Excelsior (reparar fuente).
- No se agregan medios sin re-enrich/reparación previa de los P1 pendientes.

### Pre-activación SMTP interna — GO_CREDENCIALES_INTERNAS (2026-07-09)

- **Cron post-`bde7d23`:** ✅ **CERRADO** — runs `29103114449` (schedule 2026-07-10) y
  `29139253475` (dispatch 2026-07-11) sobre `1623645` (HEAD), ambos conclusion=success,
  MED-0005/MED-0049 sin errores, `decisionDetect=SHADOW_OK`.
- **SMTP interno preparado, apagado:** `.env.example` con los 15 placeholders (switches
  off, SMTP vacíos). Validado que con credenciales presentes pero
  `SEND_ALERTS=false`/`EMAIL_ALERTS_ENABLED=false`, `createSmtpTransport` **no** crea
  transporte (`smtp_transport=null`), **sin llamada SMTP externa**; dry-run digest =
  2 clusters, `blocked=4`, `enviadas=0`, `would_send=0`. Sin fuga de secretos.
- **Estado GO/NO-GO:** máximo alcanzable esta fase = **`GO_CREDENCIALES_INTERNAS`**
  (SMTP cargable fuera del repo, módulo apagado). **No** se avanza a
  `GO_ENVIO_INTERNO_LIMITADO` sin autorización explícita. Detalle en
  `docs/CREDENCIALES_INTERNAS_CHECKLIST.md` §7.

### Cierre de gates pre-piloto — checklist GO_ENVIO_INTERNO_LIMITADO (2026-07-09)

Puerta de salida del piloto apagado (tabla completa en
`docs/CREDENCIALES_INTERNAS_CHECKLIST.md` §8):

- ✅ **Gates de código/infra:** transporte SMTP no se construye con switches off
  (validado), digest CLI-0002 estable (2 clusters), rollback trivial documentado.
- ✅ **Gate operativo #1 cerrado:** cron post-`bde7d23` limpio con MED-0005/MED-0049
  (`29103114449` + `29139253475`, ambos `SHADOW_OK`, 2026-07-10/11).
- ⏳ **Gates operativos pendientes:** (2) SMTP real cargado fuera del repo,
  (3) recipient hashes revisados, (4) **autorización explícita**.
- **Veredicto:** `GO_ENVIO_INTERNO_LIMITADO` **NO** habilitado. Se recomienda **no**
  pedir autorización de envío mientras el cron post-`bde7d23` siga pendiente.

---

## Estado actual y siguiente fase permitida

- **Estado:** Fase 0 (shadow medible) **consolidada**; paridad medida; Fase 1 (piloto
  email interno CLI-0002) **preparada y apagada** (provider cableado, kill-switches off).
- **Siguiente fase permitida (elegir con autorización):**
  1. ~~Observar el primer cron post-`bde7d23` (MED-0005/MED-0049) y validarlo limpio.~~ ✅ Cerrado.
  2. Cargar credenciales SMTP internas con `SEND_ALERTS=false` (checklist).
- **No permitido aún:** envío real, sustitución parcial/global (Fases 3–5) — sin
  evidencia suficiente ni autorización.

---

## Validación manual daily shadow post-`bde7d23` (2026-07-11)

### Resumen de ejecución

| campo | schedule | dispatch |
|---|---|---|
| run_id | `29103114449` | `29139253475` |
| headSha | `1623645` | `1623645` |
| event | schedule | workflow_dispatch |
| fecha | 2026-07-10T15:17:41Z | 2026-07-11T04:13:07Z |
| conclusion | success | success |
| duración | 10m33s | 9m37s |

### Resultados por medio

| medio_id | medio | nuevas | duplicadas | errores | detect_potenciales | decisionDetect | observación |
|---|---|---|---|---|---|---|---|
| MED-0005 | lado.mx | 0 | 30 | 0 | incluido en ≤3 globales | SHADOW_OK | 0 nuevas = esperado (EN_CATALOGO_NO_CRON; cron garantiza cobertura forward) |
| MED-0049 | Telediario Monterrey | 29 (sched) / 28 (disp) | 1/2 | 0 | incluido en ≤3 globales | SHADOW_OK | Limpio; primera corrida real |

Menciones SOLO_ETHOS_BORDERLINE desde los nuevos medios (run schedule):
- lado.mx: Tequila ×2 (CLI-0002), Reforma laboral ×2 (CLI-0003), Jumex ×1 (CLI-0001)
- Telediario: Ayuntamiento de Puebla ×1 (CLI-0003)

### Validación sheets

| tab | escritas | mismatch | estado |
|---|---|---|---|
| 05_Comparativo_PressClipping | 95 / 97 | false | OK |
| 07_Métricas_Live | metrics_history=1 | — | OK |
| 08_Cobertura_Medios | 162 filas, actualizadas=6 | false | OK |

### Sin envíos confirmado

`--no-send --no-whatsapp --no-email` presentes. SMTP no configurado en `.env`.
`sent=0`, `would_send=0`. No SMTP/Twilio/Gmail call en logs.

### Gate

**`GATE_DAILY_POST_BDE7D23_LIMPIO` ✅ CERRADO** — ambos runs sin errores, sin flood,
sin FP severo, sin envíos. `decisionDetect=SHADOW_OK` en los dos.

Siguiente gate habilitado: cargar SMTP real fuera del repo con switches apagados
(GO_CREDENCIALES_INTERNAS step 2) — requiere autorización explícita.

---

## Validación shadow CLI-MERY-TEST — Mery Pozos (2026-07-10)

### Script de alta

`scripts/tune-mery-pozos-shadow.ts` creado e idempotente.
- Upsert cliente CLI-MERY-TEST (`alertas_activas=false`, `activo=true`).
- Upsert 12 keywords KEY-0040 a KEY-0051 (frase_exacta Tier 1/2 + exacta_contextual Tier 3).
- `npm run tune-mery-pozos-shadow -- --dry` ejecutado limpio el 2026-07-10.
- Typecheck: 0 errores. Tests: 42 archivos / 798 tests todos en verde (30 tests Mery nuevos).

### Estado

- Script ejecutado el 2026-07-10 con autorización. Read-back confirma `alertas_activas=false`.
- Cobertura histórica en PressClipping CSV: 2 notas confirmadas (El Informador + lado.mx,
  2026-02-06, "Operación Enjambre — nadie está por encima de la ley").
- lado.mx (MED-0005, ya en daily shadow) cubrió a Mery Pozos — alta relevancia directa.
- keywords_activas: 49 (12 nuevas Mery + 37 existentes) confirmado en dry-run detección.
- noticias pendientes en dry-run: 0 (históricas ya procesadas). Monitoreo activo desde próximo cron.

### Estado: MERY_SHADOW_DRY_RUN_OK (2026-07-11)

- `npm run tune-mery-pozos-shadow` ✅ ejecutado (2026-07-10)
- Read-back Supabase: CLI-MERY-TEST + 12 keywords ✅
- alertas_activas=false post-upsert assertion ✅
- detect-mentions --dry-run: 0 menciones insertadas ✅
- detect-mentions --client=CLI-MERY-TEST (real, 2026-07-11): filtro funcional, 0 pendientes, 0 insertadas ✅
- simulate-mery-pozos-shadow --window-days=180: 1000 noticias, 0 matches, 0 FP ✅
- shadow-alerts --shadow-client-allowlist=CLI-MERY-TEST: 72 filas 10_Alertas_Sombra, mismatch=false ✅

**Artefactos nuevos (2026-07-11):**
- `scripts/simulate-mery-pozos-shadow.ts` — scan histórico read-only
- `detect-mentions --client=VALUE` — filtro por cliente implementado y validado
- `detect-mentions --max-inserts=N` — safety cap implementado
- `test/detect-mentions-client-filter.test.ts` — 24 tests (822 total, todos verdes)

**Siguiente gate:** aguardar primer crawl con noticias de Mery Pozos.
Verificar con `simulate-mery-pozos-shadow --window-days=7`. Si el match es correcto,
el pipeline está completo — menciones se insertan y aparecen en 10_Alertas_Sombra.

**Prohibido sin autorización:** activar `alertas_activas=true`.

---

## Rolling backtest + auditoría dry-run (2026-07-11)

### Fix crítico: `--dry-run` en shadow-alerts

**Bug corregido:** el flag `--dry-run` en `run-shadow-alerts.ts` era aceptado pero no
tenía efecto — `output` siempre defaulteaba a `'sheet'`. La sesión anterior escribió
72 filas REALES en `10_Alertas_Sombra` creyendo hacer un dry-run.

**Fix aplicado:** `--dry-run` ahora fuerza `output=console`, previniendo escritura en Sheet.
`--observe-only` tiene precedencia (ese modo sí escribe a 10 intencionalmente).

Tests agregados: `test/shadow-alerts-dry-run.test.ts` — 17 tests de invariante de seguridad.

### Rolling readiness backtest (7 días, 2026-07-11)

Script nuevo: `scripts/run-rolling-readiness-backtest.ts`
Comando: `npm run rolling-readiness-backtest -- --window-days=7`
Fuente: Supabase menciones directamente (no depende de Sheets 05/07/08/10).

| cliente_id | menciones_7d | días_activos | alertas | keywords | estado |
|---|---|---|---|---|---|
| CLI-0001 | 5 | 5 | 3 | 3 | ACTIVO_ESTABLE |
| CLI-0002 | 54 | 8 | 26 | 11 | ACTIVO_ESTABLE |
| CLI-0003 | 274 | 8 | 32 | 9 | ACTIVO_ESTABLE |
| CLI-MERY-TEST | 0 | 0 | 0 | 0 | SHADOW_CONFIG_OK_SIN_DATOS |

**Nota CLI-MERY-TEST:** `esClientePrueba('CLI-MERY-TEST', 'CLI-MERY-TEST')` retornaba `true`
porque el regex `/\b(prueba|test)\b/` matcheaba "test" en el ID. Fijado con check explícito.
Tests: `test/rolling-readiness-backtest.test.ts` — 12 tests (851 total, todos verdes).

### Reporte diario interno

Plantilla creada: `docs/REPORTE_DIARIO_INTERNO_SHADOW.md`
Incluye: estado por cliente, P1/P2, gaps PressClipping vs Ethos, Mery Pozos,
reglas de seguridad, comandos para generar y estado actual del sistema.

**Prohibido sin autorización:** activar `alertas_activas=true`. Enviar email real.
Activar `GO_ENVIO_INTERNO_LIMITADO`.

---

## FAST-TRACK 48H — Cobertura P1 + Readiness Piloto Interno (2026-07-11)

### Lote P1 ejecutado (3 medios, dentro del tope de 5)

| medio_id | medio | acción | resultado |
|---|---|---|---|
| MED-0028 | Excelsior | Reparado RSS + alta cron daily-validated | ✅ 30 noticias nuevas, 0 errores |
| MED-0084 | Frontera | Reparado sitemap + alta cron daily-validated | ✅ 1 mención real (CLI-0003) |
| MED-0055 | Noroeste | Ya READY, alta cron daily-validated | ✅ crawleado en el mismo ciclo |

Descartados por baja confianza (conf=0.4, `DIRECT_EXTRACTION_ONLY`): MED-0033 Eje Central,
MED-0038 NTR Guadalajara — requieren revisión manual, no aptos para alta automática.

Detalle completo: `docs/MEDIA_PARITY_MATRIX.md` §9.

### `--window-hours` agregado al rolling backtest

`run-rolling-readiness-backtest.ts` solo soportaba `--window-days`. Agregado `--window-hours`
con precedencia sobre `--window-days` (convierte a días fraccionarios para el filtro de fecha).
Tests: 5 nuevos casos en `test/rolling-readiness-backtest.test.ts`.

### Backtest 48h + 7d (post lote P1)

| cliente_id | menciones_48h | menciones_7d | estado |
|---|---|---|---|
| CLI-0001 | 3 | 5 | ACTIVO_ESTABLE |
| CLI-0002 | 12 | 59 | ACTIVO_ESTABLE |
| CLI-0003 | 62 | 272 | ACTIVO_ESTABLE |
| CLI-MERY-TEST | 2 | 2 | ACTIVO_ESTABLE (48h) / ACTIVO_CON_SENALES (7d) |

**Primer match real de Mery Pozos:** 2 menciones legítimas detectadas ("diputada Mery Pozos"
en nota sobre presentación de libro de Ricardo Monreal), contexto político genuino, sin
homónimos, `requiere_alerta=true`. Confirma que el diseño de keywords Tier 1/2 funciona en
producción real (vía cron de GitHub Actions).

### Bug conocido (no bloqueante): feed XML PressClipping vacío

`import-pressclipping.ts` vía el worker Cloudflare devolvió 0 items en este ciclo — causa
externa preexistente, no relacionada al lote P1. Pospone actualización de 05/07/08 hasta
que se repare el worker. No afecta crawl/enrich/detect (que sí completaron limpio).

### Decisión: ¿CLI-0002 a piloto interno?

**Aún no.** El fast-track de 48h confirma actividad estable y detección funcionando
correctamente (59 menciones/7d, 29 alertas, sin flood, sin FP evidente), pero el gate
`GO_ENVIO_INTERNO_LIMITADO` sigue requiriendo: SMTP interno cargado fuera del repo,
3 corridas limpias adicionales en `10_Alertas_Sombra`, y autorización explícita separada.
El bug del feed XML impide medir `cobertura_vs_pc` real este ciclo — no es bloqueante para
el pipeline de detección, sí lo es para la métrica formal de comparación.

**Tiempo estimado actualizado:** con el lote P1 + backtest corto validado, el camino a
`GO_ENVIO_INTERNO_LIMITADO` para CLI-0002 se estima en días, no en 30 días — sujeto a
reparar el feed XML y correr 2-3 ciclos más de `shadow-alerts` sin mismatch.

---

## EMERGENCIA — PressClipping cancelado: Ethos como servicio principal (2026-07-11)

**Cambio de estrategia:** el servicio externo PressClipping ya no está disponible. El
comparativo Ethos-vs-PressClipping deja de ser el gate — se reemplaza por métricas
operativas propias (`scripts/audit-operational-readiness-no-pc.ts`).

### Estado CLI-0002 (Patrón / Bacardí / Bebidas alcohólicas)

| métrica | valor | estado |
|---|---|---|
| keywords_activas | 27 (22 previas + 5 nuevas: Tequila Patrón, Casa Patrón, Atotonilco el Alto, CRT, IEPS alcohol) | |
| medios_en_cron | 39 | |
| texto_ok_pct (de menciones) | 100% | |
| menciones_24h / 7d | 9 / 59 | |
| errores_medios | 0 | |
| **estado_operativo** | **OPERATIVO_INTERNO (90%)** | ✅ |

### Estado CLI-0001 (Jumex)

| métrica | valor | estado |
|---|---|---|
| keywords_activas | 7 (3 previas + 4 nuevas: IEPS bebidas azucaradas, etiquetado frontal, retiro de producto, Profeco) | |
| medios_en_cron | 39 | |
| texto_ok_pct (de menciones) | 100% | |
| menciones_24h / 7d | 1 / 5 | |
| errores_medios | 0 | |
| **estado_operativo** | **OPERATIVO_INTERNO (90%)** | ✅ |

### Gap crítico corregido: falta de keywords de marca

CLI-0002 no tenía **"Patrón"/"Tequila Patrón"** (la marca que da nombre a la emergencia) ni
"Consejo Regulador del Tequila". CLI-0001 solo tenía 3 keywords, sin cubrir IEPS/regulatorio.
Corregido vía `scripts/tune-patron-jumex-keywords.ts` (idempotente, NO toca `clientes` ni
`alertas_activas`). Validado sin FP/flood contra 1000 noticias históricas
(`scripts/simulate-keywords-shadow.ts`).

### Hallazgo (no bloqueante): tier base sin enrich para noticias no matcheadas

20 de 39 medios en cron (tier `base`, incluye El Financiero, Forbes, Expansión, Proceso)
muestran `SIN_CUERPO` (0% texto limpio) en `audit-extraction-quality`. Causa: `enrich-news.ts`
solo enriquece noticias con `--only-pending-mentions` (ya matcheadas por título). Esto NO
bloquea la detección (los keywords `frase_exacta`/`contiene` matchean sobre título, que
siempre existe) — confirmado por las 59 y 5 menciones reales de CLI-0002/CLI-0001. Es un
área de mejora para detección basada en cuerpo completo, no un bloqueante de esta emergencia.

### Sheets — tab `11_Operacion_Sin_PressClipping` propuesta, no creada

No existe un helper seguro/probado para crear pestañas nuevas en el spreadsheet
(`getOutputTab` solo lee existentes). Se documentó el esquema completo en
`docs/PUENTE_REPORTES_JUMEX_PATRON.md` §7 para implementarlo en una fase separada,
con su propio test, en vez de arriesgar código sin probar durante una emergencia.

### Scripts nuevos de esta fase

- `scripts/audit-operational-clients.ts` — inventario de clientes/keywords (solo lectura)
- `scripts/audit-owned-media-coverage.ts` — inventario de medios propios (solo lectura)
- `scripts/audit-operational-readiness-no-pc.ts` — nueva métrica de readiness sin PC
- `scripts/tune-patron-jumex-keywords.ts` — alta idempotente de 9 keywords faltantes
- `scripts/simulate-keywords-shadow.ts` — validador genérico de FP para cualquier keyword_id
- `docs/PUENTE_REPORTES_JUMEX_PATRON.md` — especificación del puente hacia reportes finales

**Prohibido sin autorización:** activar `alertas_activas=true` (ninguno de los 2 clientes
fue modificado — CLI-0001 ya tenía `true` preexistente, CLI-0002 sigue en `false`).
Enviar email/WhatsApp real. Conectar hoja de reportes final.

---

## OPERACIÓN REAL SIN PRESSCLIPPING — Sheet staging Jumex + Patrón (2026-07-11)

### Helper seguro de Sheets: `ensureSheetTabAndHeaders`

Nuevo en `src/sheets/write.ts` (+ lógica pura en `src/sheets/tabPlan.ts`, mismo patrón que
`mergePlan.ts`). Crea la pestaña si no existe, preserva filas si ya existe, y hace
**readback real** (re-lee la cabecera desde la API tras escribir — no confía en la variable
local). 17 tests (12 lógica pura + 5 I/O con mock de GoogleSpreadsheet).

### Tab `11_Operacion_Sin_PressClipping` — creada

Sheet `1izEL0y6mGttGawEvpYScMoxB7CKUseKw00rAVW5vGxM`, 23 columnas, readback `mismatch=false`.

### Exportador: `scripts/export-operational-news-no-pc.ts`

```bash
npm run export-operational-news-no-pc -- --clients=CLI-0001,CLI-0002 --window-days=7 --output=sheet --max-rows=500
```

- 64 filas exportadas (CLI-0002: 59, CLI-0001: 5), `mismatch=false`.
- Dedupe verificado: segunda corrida → 64 duplicados omitidos, 0 filas nuevas, tabla sin cambios.
- `dedupe_key = cliente_id::url_norm::keyword_id`. Estados: EXPORTADO/DUPLICADO_OMITIDO/SIN_TEXTO_LIMPIO/REVISAR.
- `sentimiento`/`valoracion` vacíos (requieren `classify-ia`, prohibido esta fase).

### Re-enrich controlado (top 5 medios que impactan Jumex/Patrón)

El Heraldo de México, Zócalo, El Informador, El Diario de Chihuahua, El Imparcial Sonora —
todos con backlog reciente sin enriquecer. `npm run enrich-news -- --medio-ids=... --limit=500
--only-missing-clean-text`: 487/500 actualizadas. Backlog histórico de estos medios ya era
82-84% bueno; el backlog reciente (7d) es más grande que el cap permitido — requiere más
lotes controlados en días sucesivos para cerrarse del todo (no se hizo re-enrich masivo).

### Estado final CLI-0002 / CLI-0001

Sin cambio de estado tras esta fase (ya eran OPERATIVO_INTERNO 90% antes del export/re-enrich
— el export solo saca datos ya detectados hacia staging, no cambia la detección en sí).

**Prohibido sin autorización:** conectar `11_Operacion_Sin_PressClipping` a hojas finales de
reportes. Activar `alertas_activas=true`. Clasificar con IA (sentimiento/valoración).
