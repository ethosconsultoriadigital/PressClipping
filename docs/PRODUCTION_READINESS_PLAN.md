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

### CLI-MERY-TEST — 200-media backtest (2026-07-22)

Fase "MERY POZOS STAGING ALERT — 200 MEDIA BACKTEST" completada sobre el lago de 200 medios.

| ventana | menciones |
|---|---|
| 24h | 2 |
| 7d | 26 |
| 30d | **29** |
| 90d | 29 (toda actividad en 30d) |

**Tema dominante:** crisis del agua en Jalisco/Guadalajara (plomo y mercurio, SIAPA,
privatización, Consejo Consultivo). Mery Pozos actúa como vocera federal de Morena.

**Medios:** El Informador (~17 menciones), Milenio (~7), Telediario Monterrey (~4),
El Heraldo de México (2), Político MX (2).

**Clasificación:** ~60–80% MENCION_DIRECTA (nombre en título), ~20–30% CONTEXTO_POLITICO
(cuerpo político), ~10% POSIBLE_FP a verificar ("La Tremenda Corte" Milenio).

**FP confirmados de "Pozos" genérico:** 0 — exclusiones funcionando.

**Veredicto: GO CONDICIONADO** (29 menciones / 30d, 5 medios, FP bajo, signal sostenida).
Pendiente: verificar "La Tremenda Corte" manualmente + autorización para `alertas_activas=true`.

Ver detalle completo: `docs/MERY_POZOS_STAGING_READINESS.md`.

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

---

## CONSOLIDACIÓN EDITORIAL — tab 12, Patrón GO condicionado / Jumex cleanup (2026-07-13)

Auditoría externa GPT dictaminó: tab 11 técnicamente sana pero no apta cruda para hoja final
(duplicados editoriales por URL, campos grupo_tema/sentimiento/valoración vacíos, ruido de
keywords amplias en Patrón, contaminación de Museo Jumex en Jumex). Respuesta:

- **`src/editorial/consolidation.ts`** — módulo puro determinístico (mismo patrón que
  `mergePlan.ts`/`tabPlan.ts`): agrupa por `cliente_id+url_norm`, fusiona keywords, deriva
  relevancia_editorial / grupo_tema / sentimiento / valoración / fp_flags con reglas (NO IA),
  y decodifica HTML entities en la salida. 33 tests.
- **Tab `12_Operacion_Consolidada_Sin_PressClipping`** creada (30 columnas, readback ok).
- **Exportador** `export-operational-news-consolidated-no-pc.ts`: 66 raw → 43 consolidadas,
  dedupe por `cliente_id::url_norm` verificado.

| decisión | cliente | detalle |
|---|---|---|
| **GO CONDICIONADO** | CLI-0002 Patrón | 36 filas; filtrar `estado_editorial ∈ {GO_ALTA,GO_MEDIA}` antes de hoja final |
| **NO-GO** | CLI-0001 Jumex | 7 filas, 3 Museo Jumex excluidas; requiere más fuentes regulatorias |

Museo Jumex → `MUSEO_JUMEX_EXCLUIR` (no alimenta Jumex bebidas salvo autorización explícita).
Hallazgo detección pendiente: alias "CRT" (`contiene`) genera FP en notas tech (afinación de
keyword, fuera de alcance editorial).

**Prohibido sin autorización:** conectar tab 12 a hojas finales. Cambiar la exclusión de
Museo Jumex. Clasificar con IA. Activar `alertas_activas=true`.

---

## PATRÓN FINAL REPORT BRIDGE — tab 13 preview + fix CRT (2026-07-13)

- **Fix keyword CRT (KEY-0063):** de `contiene` a `exacta_contextual` con contexto tequilero
  (`scripts/tune-crt-keyword.ts`, idempotente, solo KEY-0063, no toca alertas_activas). "CRT"
  ya solo matchea con contexto de tequila/agave/bebida. Validado 0 FP; 9 tests
  (`test/crt-keyword-gate.test.ts`). Guard editorial defensivo `crt_sin_contexto_titulo`.
- **Preview Patrón (tab 13):** `scripts/export-patron-final-preview-no-pc.ts` proyecta la tab 12
  a `13_Patron_Final_Preview` filtrando SOLO CLI-0002 GO_ALTA/GO_MEDIA (excluye
  POSIBLE_FP/EXCLUIR/BAJA y todo Jumex). 9 filas, readback mismatch=false, dedupe
  `cliente_id::url_norm`. **No conecta a hoja externa**: no hay ID final autorizado
  (`--allow-final-sheet=true` aborta con exit 2). Default = preview en el Output Sheet.
- **Modo `--replace`** añadido al consolidado para reconstruir la tab 12 tras cambios de
  reglas/keywords (evita que filas stale con clasificación vieja persistan por append+dedupe).

| decisión | cliente | detalle |
|---|---|---|
| GO CONDICIONADO (preview listo) | CLI-0002 Patrón | tab 13 con 9 filas GO; revisión humana antes de hoja final (algunas crisis vienen de match en cuerpo con título off-topic) |
| NO-GO | CLI-0001 Jumex | sin export final; Museo Jumex excluido; se mantiene en staging tab 12 |

**Prohibido sin autorización:** conectar tab 13 a hoja final externa de Patrón. Exportar Jumex
a hoja final. Clasificar con IA. Activar `alertas_activas=true`.

---

## NO-PC OPERATION ADVANCE — cobertura + re-enrich + 24h (2026-07-15)

### Bloqueo Sheet final Patrón: RESUELTO durante esta fase

El service account (`pressclipping@pressclipping-498822.iam.gserviceaccount.com`) recibió acceso
a `NoticiasPatron` (`1dKWAGa_U6AgNSWU8oFbqvmwaLRLV2JHREIg8_M48RaU`). Al re-correr el dry-run se
detectaron y corrigieron 2 bugs en `scripts/export-patron-final-approved-no-pc.ts`:

1. **Gate mal diseñado:** exigía `human_review_rows === 0` de forma global, pero las 3 filas
   retenidas son correctas por diseño (nunca deben llegar a 0). Corregido: el gate ahora verifica
   que ninguna fila de revisión humana esté en el set a escribir (`nuevas`) — garantía estructural
   + verificación explícita — en vez de exigir que el conteo total sea cero.
2. **Mapeo de columna combinada:** el header real de `NoticiasPatron` es `"titulo / titular"`
   (una sola columna), no dos separadas. `mapaCol()` ahora reconoce headers combinados por
   `/` o `,` que contengan el nombre buscado como palabra completa.

**Resultado tras el fix:** `acceso_target_ok=true`, `ready_to_write=true`. Las 6 filas aprobadas
tienen nota completa real (1440–5152 caracteres). **NO se escribió nada aún** — se reporta el
gate y se espera autorización explícita del usuario antes de ejecutar `--output=sheet` contra
la hoja externa real.

### Segundo lote de re-enrich (2026-07-15)

5 medios (ninguno requiere proxy/JS, todos `ultimo_estado=ok`): La Crónica de Hoy (MED-0154,
impacta ambos clientes), El Economista (MED-0001, Patrón), La Razón de México (MED-0034,
Jumex), EdoMex Al Día (MED-0148, Patrón), Líder Empresarial (MED-0163, Patrón).

```
npm run enrich-news -- --medio-ids=MED-0154,MED-0001,MED-0034,MED-0148,MED-0163 --limit=500 --only-missing-clean-text
leidas: 500 | actualizadas: 489 | fallidas: 11 | conTextoLimpio: 488
```

### Readiness 24h sin PressClipping

| cliente | estado | % ready | menciones 24h/7d | texto_ok | errores |
|---|---|---|---|---|---|
| CLI-0002 Patrón | OPERATIVO_INTERNO | 90% | 15 / 54 | 100% | 0 |
| CLI-0001 Jumex | OPERATIVO_INTERNO | 90% | 2 / 9 | 100% | 0 |

### Jumex: hallazgo concreto de FP (refuerza NO-GO)

De 9 menciones/7d, solo ~2 son útiles. 4 son "Museo Jumex" (2 legítimas del museo — deben
excluirse igual —, **2 falsos positivos totales** en notas del Mundial de fútbol sin relación
alguna). 2 son "Profeco" en notas de **precio de gasolina** — FP porque el contexto de la
keyword incluye "IEPS" y el IEPS también aplica a combustibles, no solo a bebidas azucaradas
(gate demasiado amplio). Acciones recomendadas (no ejecutadas, requieren aprobación):
- Retirar "IEPS" del `contexto_incluir` de KEY-0068 (Profeco) o exigir coocurrencia con
  "bebidas"/"jugos"/"Jumex" específicamente, no solo "IEPS" a secas.
- Investigar por qué "Museo Jumex" (frase_exacta) matchea notas de Mundial — posible
  contaminación de texto por bloques de "relacionadas"/boilerplate en esos 2 medios.

### Siguiente lote de medios críticos — auditado con `audit-media-sources` (read-only)

Selección inicial especulativa (basada solo en `ultimo_estado`/prioridad de catálogo) NO se
tomó como buena — se corrió `audit-media-sources` (que sí prueba la fuente real) sobre los 5
candidatos antes de recomendar nada:

| medio_id | medio | estado real | conf | acción recomendada |
|---|---|---|---|---|
| MED-0007 | Fortuna y Poder | **DO_NOT_TOUCH** | 0.45 | D. Descartar (la auditoría real desaconseja tocar la fuente, contrario a lo que sugería `ultimo_estado=ok` de catálogo) |
| MED-0032 | Animal Político | DIRECT_EXTRACTION_ONLY | 0.4 | C. Necesita revisión manual antes de alta (confianza media-baja) |
| MED-0121 | Vallarta Opina | NO_FEED | 0.1 | D. Descartar (sin feed detectable) |
| MED-0029 | La Jornada | (ver detalle, gap=26 vs PC) | 0.4 | C. Revisión manual — gap real contra PC es el más alto del lote pero confianza no es alta |
| MED-0008 | Aristegui Noticias | READY_KEEP_CURRENT (probable) | — | Único con señal positiva; confirmar antes de alta |

**Resultado: `high_confidence: 0` de 5.** Ninguno califica para alta/reparación inmediata sin
revisión manual adicional. La lección: no recomendar medios por `ultimo_estado`/prioridad de
catálogo sin correr `audit-media-sources` primero (ya se corrigió aquí, pero se documenta el
error para no repetirlo). Quedan 43 medios de prioridad Alta fuera de cron sin auditar — se
recomienda una sesión dedicada para pasarlos por `audit-media-sources` en lotes de 5-10 antes
de elegir el siguiente batch real de alta a cron.

**Prohibido sin autorización:** escribir en `NoticiasPatron` (aunque el gate ya pasa). Agregar
medios al cron sin pasar primero por `audit-media-sources` con confianza alta. Cambiar keywords
de Jumex sin aprobación (solo propuesto, no aplicado).

---

## PATRÓN NO-PC PRODUCTION CAPTURE LOOP (2026-07-16)

### Comando único de producción: `npm run patron:no-pc:capture`

`scripts/run-patron-no-pc-production-capture.ts` orquesta el pipeline completo (reutiliza
scripts ya validados, sin duplicar lógica): detect por cliente → staging raw (tab 11) →
consolidado editorial (tab 12) → preview final (tab 13) → escritura aprobada a
`NoticiasPatron` + revisión humana interna (tab 15, nueva).

**Defaults seguros:** sin `--output=sheet`, siempre dry-run (aunque no se pase `--dry-run`
explícito). Sin `--allow-final-sheet=true`, nunca escribe en la hoja externa real (solo tabs
propias). Fijo: `--clients=CLI-0002` en cada paso — Jumex nunca se toca.

### Fix crítico de repetibilidad: guard de crisis en título

El pipeline anterior dependía de una lista fija de 9 títulos (auditoría GPT puntual) para
decidir aprobado/revisión — **nunca habría aprobado automáticamente notas nuevas**. Se
reemplazó por un criterio 100% determinístico (sin IA) basado en `estado_editorial`
(`GO_ALTA`/`GO_MEDIA` = aprobado), propagado ahora de tab 12 → tab 13 → escritura final.

Se corrigió además el bug que originó las 3 filas dudosas de la auditoría GPT: la clasificación
de crisis buscaba la palabra de crisis en `keywords + título` combinados, y como el propio
NOMBRE de la keyword detectada (p.ej. "alcohol adulterado") ya contiene esa palabra, el check
pasaba trivialmente aunque el título no hablara del tema (la keyword había matcheado solo en
el cuerpo). Fix: exigir la palabra de crisis en el TÍTULO específicamente (con lista de
palabras sueltas, no solo frases exactas, para tolerar "tequila **presuntamente** adulterado").
Si la keyword es de crisis pero el título no la confirma → `estado_editorial=REVISAR` (revisión
humana), nunca auto-aprobación. 6 tests nuevos validan exactamente los 3 casos reales.

### Validación end-to-end (2026-07-16)

Corrida real con `--allow-final-sheet=true`: el pipeline detectó y aprobó automáticamente
**1 nota nueva** ("Cofepris alerta por tequila falsificado y adulterado", Publimetro México)
vía el guard de crisis en título — `NoticiasPatron` pasó de 6 a **7 filas**. Una segunda corrida
inmediata confirmó dedupe perfecto: `new_rows=0`, gate abortó sin escribir (comportamiento
correcto, no un error). Tab 15 (`15_Patron_Revision_Humana`) creada con las 3 filas retenidas.

### Fix Jumex: keyword Profeco/IEPS (sin conectar Jumex a hoja final)

`scripts/tune-jumex-profeco-ieps.ts`: KEY-0068 (Profeco) tenía "IEPS" suelto en
`contexto_incluir` — el IEPS también aplica a gasolina/tabaco, no solo bebidas azucaradas.
Causaba 2 FP confirmados en notas de precio de gasolina. Fix: se quitó "IEPS" del contexto
(quedan Jumex/jugos/néctares/bebidas azucaradas) y se agregó `contexto_excluir` para
gasolina/diésel/combustible/tabaco. 13 tests a nivel matcher. **Jumex sigue NO-GO, sin hoja
final, sin cambios en `alertas_activas`.**

### Workflow manual (sin cron)

`.github/workflows/patron-no-pc-capture.yml` — solo `workflow_dispatch`, sin `schedule`.
Defaults: `dry_run=true`, `output_sheet=false`, `allow_final_sheet=false`. Siempre pasa
`--no-send --no-whatsapp --no-email`. 8 tests verifican estas garantías sobre el YAML.

### Medios (sin cambios desde la fase anterior — no se ejecutó otro re-enrich)

171 catálogo, 39 en cron, 27 scrapeados 24h, 5 OPERATIVO_OK, 21 NECESITA_REENRICH, 0 bloqueados
con error, 489/500 notas re-enriquecidas en el segundo lote, 43 medios de prioridad Alta
pendientes de auditar (siguiente lote propuesto, no ejecutado).

**Prohibido sin autorización:** correr `patron:no-pc:capture` con `--allow-final-sheet=true`
sin supervisión (aunque el comando ya es seguro por diseño). Programar el workflow con cron.
Tocar Jumex final. Otro re-enrich masivo.

---

## PATRÓN BRAND + IMPORTANT MEDIA READINESS (2026-07-16)

### Marca directa Patrón reforzada

Auditoría `audit-patron-brand-keywords` confirmó gaps: faltaba "Patrón" solo, el orden invertido
"Patrón Tequila" y "Bacardí México". Backtest `simulate-patron-brand-mentions` (30d): **0
menciones de marca directa** en el corpus (la marca no apareció, no es fallo de captura) y la
regla candidata "Patrón" no genera flood. Fix aplicado (`tune-patron-brand-keywords.ts`, solo
CLI-0002, no toca `alertas_activas`):
- KEY-0060 "Tequila Patrón": +alias "Patrón Tequila"/"Patron Tequila" (orden invertido).
- KEY-0015 "Bacardí": +alias "Bacardí México"/"Bacardi Mexico".
- **KEY-0069 "Patrón" nueva** (exacta_contextual, alerta=true): exige contexto de marca/tequila,
  excluye palabra común (jefe, patrón de conducta/diseño/consumo, santo patrón, etc.). 13 tests
  a nivel matcher validan que captura marca y bloquea palabra común. detect dry-run: 0 flood.

### Readiness de medios importantes (35 auditados)

`audit-patron-important-media-readiness` + matriz en `docs/PATRON_IMPORTANT_MEDIA_READINESS.md`
(+ export para GPT en `PATRON_IMPORTANT_MEDIA_READINESS_FOR_GPT.md`). 10 P1_CRÍTICO: solo 2
LISTO_LEYENDO (Excélsior, Periódico Correo), 3 CATALOGO_NO_CRON (Reforma/Milenio/Mural — todos
paywall/política, NO candidatos válidos), 3 NECESITA_REENRICH (El Financiero, El Economista, El
Informador), 2 BLOQUEADO (El Universal 404, La Jornada 403). **Caballo de batalla: Periódico
Correo** (95.2% texto, 9 menciones sector/7d).

**Hallazgo estructural:** el cron base crawlea títulos pero NO enriquece → el backlog de cuerpo
vacío regenera más rápido de lo que los lotes de re-enrich (cap 500) lo limpian. Por eso El
Informador/El Economista siguen en 0% texto pese a 2 re-enrich previos. Fix estructural sugerido
(fase separada, requiere autorización): encadenar `enrich-news --only-pending-mentions` en el cron
base como ya hace el tier daily-validated. NO bloquea la captura de Patrón (detección por título
+ re-enrich dirigido de menciones pendientes en el capture loop).

### Producción y cron

`patron:no-pc:capture` dry-run: `NoticiasPatron` ya al día (7 filas), `new_rows=0` — no había nada
nuevo que escribir este ciclo, no se forzó corrida real (habría sido no-op). **Cron NO activado**
a propósito: encender un `schedule` que escribe automáticamente a la hoja externa real del cliente
cada 2h es una automatización recurrente de cara al exterior que requiere autorización explícita e
inequívoca (más allá de que el gate técnico pase). El workflow sigue `workflow_dispatch`-only.

### Lote inmediato de medios (propuesto, NO ejecutado)

Ver `PATRON_IMPORTANT_MEDIA_READINESS.md` §6: reparar El Universal + La Jornada, re-enrich
dirigido El Economista + El Informador, evaluar catalogar AM León. Requiere autorización.

**Prohibido sin autorización:** activar cron. Agregar Reforma/Milenio/Mural al cron (paywall/
política). Tocar Jumex final. Ejecutar el lote de medios sin aprobación.

## PATRON P1 MEDIA GAP CLOSURE (2026-07-17)

Lote ejecutado por autorización explícita: Milenio agregado a `SHADOW_MEDIOS_NACIONALES_B`
(revierte exclusión previa "ruido/volumen"), El Informador + El Economista re-enriquecidos
(100 notas c/u, backlog real >700 notas c/u impide que la métrica 7d se mueva con ese cap),
AM León (MED-0172) y CRT (MED-0173) catalogados y agregados a `SHADOW_MEDIOS_DAILY_VALIDATED`.
Captura Patrón encontró 1 candidato nuevo GO_MEDIA (escrito solo en tab 13 interna, pendiente
confirmación para escribir en `NoticiasPatron` real). Cron de `patron-no-pc-capture.yml`
sigue `workflow_dispatch`-only (no se activó `schedule`). Detalle completo en
`docs/PATRON_IMPORTANT_MEDIA_READINESS.md` §7. Jumex sin cambios (NO-GO). 1067 tests verdes.

## ETHOS NEWS LAKE — ALL MEDIA CLEAN CAPTURE FOUNDATION (2026-07-17)

Confirmado que la arquitectura YA separa captura general (crawl/enrich,
keyword-agnóstica) de detección por cliente (detect-mentions, escribe en
`menciones` sin tocar `noticias`) — no se necesitó rediseño. Nuevo script
`scripts/audit-all-media-clean-capture-readiness.ts` audita los 173 medios
del catálogo (no solo los 35 de Patrón): 42 en cron, 121 catálogo-sin-cron,
14 LISTO_LEYENDO. Re-enrich reciente aplicado a El Heraldo/La Razón/El
Financiero (300 notas, 298 con texto limpio). Jumex: staging confirma NO-GO
reforzado — de 16 menciones/30d, ~0-1 son cobertura de marca real (6 Museo
Jumex correctamente excluidas, 7 son ruido sectorial genérico de "bebidas
azucaradas" sin mención de marca, 2 son residuo pre-fix de Profeco/gasolina).
Detalle completo en `docs/ETHOS_NEWS_LAKE_MEDIA_READINESS.md` y
`docs/JUMEX_STAGING_READINESS.md`. Patrón sin cambios de comportamiento
(cron cada 2h sigue activo, 0 filas nuevas en esta corrida — steady state).

## NATIONAL MEDIA COVERAGE RAMP + JUMEX STAGING CRITERIA (2026-07-20)

Cron Patrón confirmado estable (múltiples corridas automáticas exitosas
durante 2 días vía `gh run list`). Aristegui Noticias agregada a cron
(único viable de 4 candidatos); El Universal reparado (BLOQUEADO→activo,
feed alterno real verificado con crawl). 5 medios más recibieron re-enrich
reciente; el patrón de degradación repetida en medios de alto volumen
(El Heraldo, El Informador) confirma que la fase estructural pendiente
(encadenar enrich al cron base) ya no puede seguir posponiéndose. Criterio
editorial Jumex de 4 categorías implementado y probado
(`src/editorial/jumexCriteria.ts`) — NO-GO reforzado con regla explícita
(<3 MARCA_DIRECTA = NO-GO automático). Se encontró y corrigió un SEGUNDO bug
de paginación (fetch global capado en 50,000 filas). Detalle completo en
`docs/NATIONAL_MEDIA_COVERAGE_MASTER.md`. 1111 tests verdes.

## ETHOS 200 MEDIA NEWS LAKE + AUTO ENRICH CHAIN (2026-07-20)

**Corrección importante:** la afirmación repetida en 3 fases anteriores ("el
cron base no encadena enrich") era imprecisa — SÍ lo encadenaba
(`run-live-comparison.ts` paso 3), pero con `--limit=250` **global** (sin
acotar por medio) y **oldest-first**, compartido entre los ~26 medios de
`SHADOW_MEDIOS`. Los medios de alto volumen (El Heraldo, El Informador, El
Economista, La Razón, El Financiero) nunca alcanzaban su cupo porque su
backlog crecía más rápido que el cupo compartido. **Corregido:** el enrich
encadenado ahora se acota a `--medio-ids=${crawlMedioIds}` (los medios de
ESE ciclo) y usa `--recent-first`, en el scheduler base y los 3 tiers
aislados (nacional B, daily-validated, crisis). Prueba real controlada:
los 5 medios problemáticos pasaron de 27-34% a **49-54% texto limpio en un
solo ciclo** de 500 notas.

**Bug adicional encontrado y corregido durante la prueba:** un timeout de
escritura puntual en `enrich-news.ts` (una sola nota) tiraba todo el proceso
de enrich, perdiendo el resto del cupo del ciclo. Ahora aislado por nota
(try/catch, cuenta como fallida, sigue con la siguiente) — confirmado con
prueba real y test de regresión.

**Expansión de catálogo:** 173 → **185 medios** (+12: SDP Noticias, Bloomberg
Línea México, DPL News, N+, ADN40, TV Azteca Noticias, MVS Noticias, Diario
de Yucatán, Contralínea, Alto Nivel, Merca2.0, El CEO — todos verificados en
vivo con sitemap real antes de catalogar). En cron: 44 → **54** (+10, Merca2.0
y El CEO catalogados sin cron por prioridad baja). Matriz completa de acceso
(A/B/C/D/E) en `docs/NATIONAL_MEDIA_ACCESS_MATRIX.md`. Jumex sin cambios
(NO-GO, 1 MARCA_DIRECTA en 30d). Patrón estable (cron cada 2h, `approved_rows`
creciendo orgánicamente 9→12, 0 Jumex, 0 filas nuevas en esta corrida).

## ETHOS 200 MEDIA NEWS LAKE — segunda expansión (2026-07-20, continuación)

Validado en vivo: las 384 notas del primer crawl del lote 1 quedaron 49.3%
con texto limpio (mediana 1941 chars); 9/10 medios nuevos ok a la primera,
Bloomberg Línea corregido (RSS mal etiquetado como sitemap). Encontrado y
corregido un hallazgo adicional: el cupo de enrich del tier daily-validated
no había escalado con su crecimiento (11→21 medios) — subido de 200 a 500,
verificado (6 medios afectados pasaron a ~100% tras un enrich dirigido).
2 medios más catalogados (Político MX, AF Medios) tras revisar ~30
candidatos — la mayoría ya estaban catalogados o descartados. Catálogo
173→**187**, en cron 44→**56**, LISTO_LEYENDO 14→**22**. Los 5 medios de
alto volumen corregidos la fase pasada (Heraldo/Informador/Economista/
Razón/Financiero) sostienen 50-58% texto limpio, confirmando que el fix es
durable, no un pico puntual. No se llegó a 200 exactos (187) — se documentó
honestamente por qué (candidatos viables agotados, no se agrega basura).
Jumex sin cambios (NO-GO). Patrón estable (cron cada 2h, `approved_rows`=12,
0 Jumex). Commits `f74eadc`, `84d2f01` y este ciclo.

## MERY POZOS CONTROLLED PRODUCTION OUTPUT (2026-07-23)

**Estado: CONTROLLED_PRODUCTION_OUTPUT implementado.** `alertas_activas=false` sin cambio. Sin envíos.

Creados: `src/editorial/meryCriteria.ts` (clasificación editorial en 5 categorías),
`scripts/export-mery-final-preview-no-pc.ts` (exportador menciones → tabs 16/17/18),
`.github/workflows/mery-no-pc-capture.yml` (solo workflow_dispatch, dry_run=true default),
`npm run mery:no-pc:capture`. Tests: 1262/1262 verdes (+43 nuevos).
Detalle: `docs/MERY_POZOS_STAGING_READINESS.md` §10.

---

## NUEVA CAPACIDAD ESTRUCTURAL — MEDIA VALIDATION & CERTIFICATION (2026-09-05)

**Fase 0 (arquitectura + documentación, sin código operativo).** Se incorpora
formalmente al plan maestro una capacidad transversal permanente: certificar,
por `medio_id` y de forma reproducible, si una fuente del catálogo es
confiable — sin escalar proporcionalmente el QA manual de Juan al crecer el
catálogo (203 medios hoy, objetivo 120–150 útiles en producción vía
`juan/production-tier-runbook`, no mergeada).

**Motivo:** evidencia real confirmó `WORKFLOW SUCCESS ≠ MEDIA PASS` — el run
`33924994423` de `news-lake-capture.yml` reportó `chunks_ok:2,
chunks_con_error:0` (éxito global) mientras `MED-0114` (Radio Universidad de
Guadalajara) falló individualmente con `INVALID_XML` ("Invalid character in
entity name"). Esta capacidad es la respuesta estructural a ese hallazgo, no
un parche puntual sobre `MED-0114`.

**Diseño completo:** `docs/MEDIA_VALIDATION_AND_CERTIFICATION.md` — Data
Plane vs Control Plane, `readiness_state` vs `validation_result` vs
`recommendation`, gap de observabilidad confirmado (enrich no atribuye por
medio en corridas multi-medio; el orquestador de chunks tampoco), error
taxonomy, quality metrics sin thresholds inventados, Deterministic
Regression Fixtures vs Live Canary Media, y roadmap Fase 0→7 (Shadow
Validator V1 report-only → Fixtures → Canary/Regression → Assisted Repair →
Media Health Monitor → Promoción semiautomática → Escalamiento 300/500+).

**Relación con las fases 0–5 de este plan:** transversal, no las reemplaza
ni reordena. Es un prerrequisito de calidad para escalar el catálogo de
medios que alimenta la Fase 0 (shadow medible) y las fases de sustitución
posteriores — más catálogo confiable sin más horas de QA humano por medio.

**Siguiente paso habilitado (requiere autorización, no ejecutado):** Fase 1
— Shadow Validator V1, *report-only*, sin promoción automática, sin nuevas
tablas Supabase, sin tocar producción.

**Prohibido sin autorización:** implementar `scripts/shadow-validator.ts` o
cualquier script/workflow/tabla operativa de esta capacidad. Ejecutar
`repair-failed-sources-batch --apply` automáticamente. Promoción automática
de cualquier medio a Tier 1/2/3.
