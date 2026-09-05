# Media Validation & Certification — Arquitectura y Roadmap

_Fase 0 (2026-09-05): incorporación formal de una nueva capacidad estructural
permanente al Plan Maestro. Este documento es **solo arquitectura +
documentación + roadmap**. No implementa código operativo, no crea tablas,
no ejecuta health checks ni promoción automática — ver §16._

> **Componentes de esta capacidad:**
> 1. **Shadow Validator V1** (primer componente, Fase 1 — no implementado aún).
> 2. **Media Health Monitor** (evolución futura, Fase 5 — no implementado aún).

---

## 1. Problema que resuelve

El News Lake (`docs/NEWS_LAKE_V0.md`) ya separa **captura general** (medio-
agnóstica a keywords) de **detección por cliente**. Eso resolvió el problema
de "las keywords no deben decidir qué se captura". Pero al escalar el
catálogo (203 medios hoy, objetivo 120–150 útiles en producción según
`docs/PRODUCTION_NEWS_LAKE_RUNBOOK.md` en la rama `juan/production-tier-runbook`,
aún no mergeada) apareció un problema distinto: **nadie certifica, por medio,
si una fuente es confiable, de forma reproducible y sin depender de que Juan
lea logs manualmente cada vez.**

Evidencia concreta de este problema, verificada en esta misma fase (run real
de GitHub Actions, `gh run view 33924994423 --log`):

```
chunks_totales:2, chunks_ok:2, chunks_con_error:0   ← el workflow global fue "success"
```

pero dentro del log del mismo run, línea a línea:

```
{"medio_id":"MED-0114","fuente":"rss","err":"Invalid character in entity name\nLine: 249\nColumn: 13","msg":"Fallo en fuente, probando siguiente"}
{"medio_id":"MED-0114","estado":"error","insertadas":0,"duplicados":0,"msg":"Medio procesado: Radio Universidad de Guadalajara"}
```

**`MED-0114` falló con XML inválido y el workflow reportó éxito igual.** Esto
no es un bug de `news-lake-capture.ts` — es una consecuencia intencional de
que un medio roto no debe tumbar todo el chunk (buen diseño de resiliencia).
Pero significa que **hoy no existe ninguna capa que traduzca "el chunk no
truena" en "cada medio, individualmente, sigue siendo confiable"**.

**Principio formal:**

> **WORKFLOW SUCCESS ≠ MEDIA PASS.**
>
> Media Validation & Certification NO es un crawler adicional. Es la capa de
> control, evidencia y certificación que utiliza el pipeline existente de
> captura y enriquecimiento para determinar, por medio y de manera
> reproducible, si una fuente puede considerarse operativamente confiable,
> requiere revisión o necesita reparación.

## 2. Objetivo estratégico

**Escalar el catálogo de medios sin escalar proporcionalmente el QA humano.**

Hoy ese QA humano existe y es manual: `docs/README_PARALELO_MEDIOS_PRESSCLIPPING.md`
documenta exactamente un proceso humano (Juan corre oleadas, pega logs a
ChatGPT, un programador clasifica medios A/B/C/D/E a mano). Eso funciona a 70
medios en cron. No escala a 300–500 sin una capa que preclasifique y solo
escale a humano las excepciones reales.

## 3. Qué NO es esta capacidad

- No es otro crawler ni otro enrich. **Reutiliza y orquesta** `scripts/crawl.ts`,
  `scripts/enrich-news.ts`, `scripts/news-lake-capture.ts` y
  `scripts/audit-all-media-clean-capture-readiness.ts` — no los duplica.
- No decide sola cuándo un medio entra a producción (V1 es *report-only*,
  ver §Roadmap Fase 1).
- No repara nada automáticamente (`scripts/repair-failed-sources-batch.ts`
  seguirá siendo una herramienta con `--apply` manual, revisada por humano).
- No toca clientes, keywords, alertas, ni sistemas de envío.

---

## 4. Data Plane vs Control Plane

La arquitectura **no** es lineal (`CATÁLOGO → VALIDATOR → NEWS LAKE`) porque
el Validator necesita observar la ejecución real de crawl/enrich, y el News
Lake recibe datos durante shadow independientemente de que exista o no
certificación formal todavía. La distinción correcta es:

```
┌─────────────────────────── DATA PLANE ────────────────────────────────┐
│                                                                        │
│  MEDIA CATALOG (tabla `medios`, Supabase)                             │
│        │                                                              │
│        ▼                                                              │
│  SHADOW / CONTROLLED EXECUTION                                        │
│    ├── CRAWL           (scripts/crawl.ts)                             │
│    ├── ENRICH          (scripts/enrich-news.ts)                       │
│    └── NEWS LAKE / SUPABASE   (tabla `noticias`)                      │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ observa ejecución real (logs, DB, resultados)
                              │ NO bloquea físicamente la escritura al lake
┌─────────────────────────── CONTROL PLANE ──────────────────────────────┐
│                                                                        │
│  MEDIA VALIDATION & CERTIFICATION                                     │
│    ├── AUDIT BEFORE      (estado readiness pre-corrida)               │
│    ├── RUN EVIDENCE      (logs/resultados de la corrida real)         │
│    ├── PER-MEDIA METRICS (agregación por medio_id)                    │
│    ├── ERROR TAXONOMY    (clasificación de fallas)                    │
│    ├── QUALITY RATES     (ratios técnicos por medio)                  │
│    ├── AUDIT AFTER       (estado readiness post-corrida)              │
│    ├── BEFORE/AFTER COMPARISON                                        │
│    └── VALIDATION RESULT (PASS / REVIEW / FAIL + recomendación)       │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

**Después de certificación aprobada:**

```
LISTO_LEYENDO
  ↓
OPERATIONAL CAPTURE (Tier 1/2/3, ver PRODUCTION_NEWS_LAKE_RUNBOOK.md)
  ↓
NEWS LAKE
  ↓
CLIENT DETECTION (detect-mentions.ts, por cliente/keyword)
  ↓
EDITORIAL / REVIEW (src/editorial/consolidation.ts y criterios por cliente)
  ↓
OUTPUTS (Sheets ETHOS_*, tabs de cliente)
```

El Control Plane **observa** el Data Plane (lee logs, lee `noticias`, corre
el audit antes/después) — no se interpone físicamente entre `crawl.ts` y
`noticias`. Un medio puede seguir escribiendo al lake en modo shadow mientras
su certificación está en `REVIEW` o incluso `FAIL`; lo que cambia con la
certificación es la **recomendación operativa** (promover a Tier 1/2/3,
mantener en observación, o repararlo), no un bloqueo físico de escritura.

---

## 5. Shadow Validator (Fase 1 — no implementado en esta fase)

Nombre del primer componente operativo de esta capacidad. Su trabajo,
conceptual (implementación en Fase 1, *report-only*, sin promoción
automática):

1. Recibe una lista de `medio_id` (10–20 tí­picamente, un lote/oleada real).
2. Lee el `readiness_state` de cada uno **antes** de la corrida (reutiliza
   `scripts/audit-all-media-clean-capture-readiness.ts`, no lo duplica).
3. Ejecuta o referencia una corrida real de `news-lake-capture.ts` (o lee una
   ya ejecutada, vía su `run_id` de GitHub Actions).
4. Reconstruye, **por `medio_id`**, resultado de crawl y de enrich (ver §7 —
   hoy esto tiene un gap real de observabilidad, documentado abajo).
5. Calcula métricas y clasifica error (ver §8/§10).
6. Lee el `readiness_state` **después**.
7. Compara antes/después.
8. Emite `validation_result` (PASS/REVIEW/FAIL) + `recommendation`.
9. Genera un reporte legible (Markdown/JSON) — sin tabla Supabase nueva en V1
   (ver §Histórico).

---

## 6. Modelo de estados — dimensiones separadas (NO reemplaza nada existente)

Este documento **no** introduce un nuevo campo que sustituya a
`estado_operativo` (el que ya calcula
`scripts/audit-all-media-clean-capture-readiness.ts`). Formaliza que son
**dimensiones distintas** que deben coexistir sin redundancia:

### `readiness_state` (ya existe, calculado hoy por el audit script)

```
LISTO_LEYENDO
CATALOGO_NO_CRON
BAJO_VALOR
BLOQUEADO
EN_CRON_SIN_NOTICIAS
PAYWALL_NO_VIABLE
NECESITA_REENRICH_RECIENTE
EN_CRON_TEXTO_MALO
NECESITA_REPARAR_FUENTE
```

Snapshot real más reciente (2026-09-05, post-lote de reparación
`repair-failed-sources-batch` del 2026-09-02, `npm run audit-all-media-clean-capture-readiness`):

| estado | count |
|---|---|
| `LISTO_LEYENDO` | 49 |
| `CATALOGO_NO_CRON` | 84 |
| `BLOQUEADO` | 46 |
| `EN_CRON_SIN_NOTICIAS` | 9 |
| `NECESITA_REENRICH_RECIENTE` | 4 |
| `EN_CRON_TEXTO_MALO` | 6 |
| `PAYWALL_NO_VIABLE` | 3 |
| `NECESITA_REPARAR_FUENTE` | 1 |
| `BAJO_VALOR` | 1 |
| **Total catálogo** | **203** (70 en cron) |

_(`total_bloqueados` bajó de 52 → 46 tras el lote de reparación del
2026-09-02, `total_catalogo_no_cron` subió de 78 → 84: consistente con 6
medios que salieron de "roto" hacia "candidato sin cron todavía", más
`LISTO_LEYENDO` 40 → 49 tras el mismo lote + backlog de re-enrich.)_

### `validation_result` (nuevo — conceptual, Fase 1)

```
PASS
REVIEW
FAIL
```

### `recommendation` (nuevo — conceptual, Fase 1)

```
ELIGIBLE_FOR_PROMOTION   ← de PASS, requiere aprobación humana (approval_required=true en V1)
REVIEW_REQUIRED          ← de REVIEW, revisión humana/asistida + retest
REPAIR_AND_RETEST        ← de FAIL, reparación dirigida + retest
BLOCKED_FAIL             ← de FAIL, sin ruta clara de reparación pública/conservadora
```

### `approval_required`

`true` siempre en V1, para **toda** promoción (incluso `ELIGIBLE_FOR_PROMOTION`).
Ningún medio pasa a Tier 1/2/3 sin aprobación humana explícita en esta fase.

### `error_code` (conceptual — taxonomía, ver §10)

### `health_state` (futuro, Fase 5 — Media Health Monitor, no implementado)

```
HEALTHY
DEGRADED
REGRESSION_DETECTED
UNKNOWN
```

**Relación entre dimensiones:** un medio puede estar en `readiness_state =
LISTO_LEYENDO` (buena foto histórica de 7 días) y aun así el Shadow Validator
emitir `validation_result = REVIEW` en una corrida puntual (p. ej. una
regresión reciente no reflejada todavía en la ventana de 7 días). Son señales
complementarias, no la misma cosa — por eso deben vivir separadas y nunca
colapsarse en un solo campo.

---

## 7. Per-media attribution — gap de observabilidad confirmado

**Requisito:** la unidad primaria de validación es `medio_id`. No se puede
inferir PASS por `workflow success`/`chunks_ok`/`chunks_con_error` (ver
evidencia real §1).

**Estado real verificado en el código (esta fase, solo lectura):**

| Etapa | ¿Tiene atribución por `medio_id`? | Evidencia |
|---|---|---|
| `crawl.ts` (dentro de un chunk multi-medio) | **Sí.** Loguea por medio (`logger.info({medio_id, estado, insertadas, duplicados, promovidas_diagnostico}, 'Medio procesado: ...')`) y persiste una fila en `logs_ingesta` por medio vía `writeIngestaLog()` (`src/logs/ingestaLogger.ts`), con `accion='crawl'`. | `scripts/crawl.ts` líneas ~326–345; confirmado en vivo en el log del run `33924994423` (`medio_id":"MED-0114","estado":"error"`). |
| `enrich-news.ts` (multi-medio, `--medio-ids=<chunk>`) | **No.** El resumen real (`leidas/actualizadas/sinCambios/fallidas/conTextoLimpio`) se calcula **agregado sobre todo el batch**, sin desglose por `medio_id`. Solo existe desglose por nota individual (`noticia_id`) en el modo diagnóstico de una sola URL, no en la corrida real multi-medio. | `scripts/enrich-news.ts` líneas ~196–216 (resumen agregado); no hay `writeIngestaLog` con `accion='enrich'` en ningún punto del archivo. |
| `news-lake-capture.ts` (orquestador de chunks) | **No.** Solo registra `crawlCode`/`enrichCode`/`ok` **por chunk** (`ChunkResult`), nunca por medio individual dentro del chunk — por diseño (un medio roto no debe tumbar el chunk), pero eso es exactamente lo que produce el falso "success" del §1. | `scripts/news-lake-capture.ts`, tipo `ChunkResult` y función `procesarChunk`. |

**Conclusión — GAP confirmado para Fase 1:** el dato crudo de crawl por medio
**sí existe** (consola + `logs_ingesta`), pero (a) el enrich no lo produce
desglosado cuando corre multi-medio, y (b) nada hoy **agrega/lee** ese dato
crudo para construir un veredicto por medio a nivel de corrida completa. El
Shadow Validator V1 deberá:

1. Consumir lo que **ya existe** de `crawl.ts` (logs / `logs_ingesta` por
   `medio_id`, `accion='crawl'`) — no requiere cambios en `crawl.ts`.
2. Documentar como **gap de Fase 1** que `enrich-news.ts` necesitará emitir
   igual granularidad por medio (mínimo: log estructurado por `medio_id`
   dentro del batch, no necesariamente persistencia nueva en DB) — **no se
   implementa en esta Fase 0**.
3. Campos que deberá poder reconstruir, por `medio_id`, una vez cerrado el gap:

   ```
   crawl_result, source_method, items_detected, inserted, duplicates,
   crawl_errors, enrich_processed, enrich_updated, enrich_failed,
   clean_text_count, body_count, quality_rates, error_code, raw_error,
   readiness_before, readiness_after, validation_result, recommendation
   ```

---

## 8. Quality metrics — sin reglas simplistas ni thresholds inventados

**No se documentan reglas del tipo** `conTextoLimpio > 0 = PASS` — eso ya
demostró ser insuficiente (`docs/PRODUCTION_READINESS_PLAN.md`, hallazgo
"tier base sin enrich para noticias no matcheadas": tener texto no matcheado
no implica que el medio esté sano, y viceversa).

**Métricas por medio a calcular (Fase 1, sobre datos ya disponibles vía
`audit-all-media-clean-capture-readiness` + el gap cerrado de §7):**

```
crawl_success_rate       (corridas ok / corridas totales, por medio)
processing_success_rate  (crawl + enrich sin error, por medio)
clean_text_rate          (ya existe: texto_ok_pct_7d/30d)
body_extraction_rate     (con texto_cuerpo_nota o texto_nota_limpia)
enrich_success_rate      (actualizadas / procesadas, por medio — nuevo, requiere §7)
error_rate                (errores / intentos, por medio)
recent_content_rate      (noticias_7d > 0 vs. histórico — ya existe como EN_CRON_SIN_NOTICIAS)
duplicate_behavior        (duplicados / total — señal de fuente sana vs. re-crawl estéril)
```

### Calibración de thresholds (no se fijan hoy)

**No se inventan** umbrales como 80/90/95%. La calibración es trabajo de
Fase 1: correr Shadow Validator V1 sobre el **Live Canary Set** actual (los
49 `LISTO_LEYENDO`, ver §12) para observar qué ratios produce hoy un medio ya
considerado bueno, y derivar el threshold de esa evidencia — no al revés.

### Thresholds globales + por `extraction_method` (capacidad futura)

Taxonomía real observada en el repo (campo `metodo_extraccion`, `string`
libre en `medios`, sin `enum` forzado en `src/types/schemas.ts`):
`RSS`, `SITEMAP`, `HTML`, `DIRECT` (extractor dedicado, p. ej.
`crawl-direct-cnit.ts`, `crawl-direct-lasillarota.ts`), más el campo `fuente`
de los tiers de `shadowMedia.ts` (`'auto' | 'rss' | 'sitemap'`, cascada
configurada por medio). Un medio RSS con cuerpo completo no debería medirse
con el mismo threshold que un DIRECT de solo snippet — la arquitectura debe
dejar espacio para thresholds por método, pero **no se formalizan valores
todavía** (Fase 1 los calibra con evidencia).

---

## 9. Error taxonomy (conceptual)

```
INVALID_XML          ← confirmado real: MED-0114, "Invalid character in entity name"
HTTP_403
HTTP_404
HTTP_415             ← confirmado real: BCS Noticias/Diario Humano antes de reparar (sitemap 415)
FETCH_FAILED
SIN_FUENTE
PAYWALL
EMPTY_TEXT
BAD_TEXT
NO_RECENT_ARTICLES
ENRICH_FAILED
CRAWL_FAILED
UNKNOWN_ERROR
```

Todos estos códigos **ya aparecen como texto libre** en `ultimo_error`/logs
hoy (`docs/README_PARALELO_MEDIOS_PRESSCLIPPING.md` §11 los lista tal cual:
"sitemap 404", "fetch failed", "sitemap 415", "sin_fuente"). El trabajo de
Fase 1 es **normalizar** ese texto libre a un `error_code` cerrado, no
inventar errores nuevos.

---

## 10. Deterministic Regression Fixtures vs Live Canary Media

Dos conceptos que se mantienen **explícitamente separados**:

### A. Deterministic Regression Fixtures

Inputs controlados y guardados, con output esperado exacto. Ya existe la
convención en el repo: `test/fixtures/*.xml` (usados por
`test/import-pressclipping-xml.test.ts`) — **se recomienda que las fixtures
de Media Validation & Certification vivan en el mismo lugar**
(`test/fixtures/`, con sub-carpeta propia si crece, p. ej.
`test/fixtures/media-validation/`), siguiendo la convención real del repo en
vez de crear una nueva.

Ejemplos conceptuales para Fase 2 (no creados en esta fase):
RSS válido, RSS malformado, XML con entidades inválidas (el caso real de
MED-0114 es candidato directo a fixture), sitemap válido, HTML conocido,
HTML parcial, respuesta HTTP simulada, artículo con estructura específica.

Sirven para regresión determinística de: parser, crawler, RSS, XML, sitemap,
extractores, normalización, enrich, dedupe (donde aplique), clasificación de
error.

### B. Live Canary Media (LISTO_LEYENDO como canaries reales)

Los 49 medios `LISTO_LEYENDO` **no son fixtures** — son fuentes externas
variables. No se espera de ellos:

```
mismas URLs, mismo número de noticias, mismo volumen, mismos textos, mismos duplicados
```

Sí se espera comportamiento dentro de parámetros razonables: la fuente
responde, el parser funciona, crawl encuentra contenido, enrich sigue
funcionando, `clean_text_rate`/`body_extraction_rate` no se degradan
significativamente, `error_rate` no se dispara, no aparecen fallos
recurrentes. Esta es la base conceptual futura del **Media Health Monitor**
(Fase 5).

---

## 11. Histórico — sin tablas Supabase nuevas en V1

V1 trabaja con JSON / GitHub artifacts / reports / `tmp/` / logs
estructurados ya existentes (`logger` de pino + `logs_ingesta`). **No se
crean tablas nuevas en esta fase.** Conceptualmente, más adelante (Fase 5+)
podrían aparecer:

```
media_certifications
media_health_checks
```

pero primero Shadow Validator V1 debe enseñar, con evidencia real, qué
campos importan de verdad antes de comprometerse a un esquema persistente.

---

## 12. Media Health Monitor (evolución futura, Fase 5 — no implementado)

```
LISTO_LEYENDO → HEALTH CHECK → HEALTHY
LISTO_LEYENDO → HEALTH CHECK → DEGRADED → REGRESSION_DETECTED → REPAIR → RECERTIFICATION
```

La arquitectura de Fase 0 solo debe **evitar decisiones que impidan esta
evolución** (p. ej., no colapsar `readiness_state` y `validation_result` en
un único campo; no forzar un esquema DB prematuro; mantener el Control Plane
desacoplado del Data Plane).

---

## 13. Seguridad

Media Validation & Certification **no** activa ni modifica, en ninguna fase:

- WhatsApp, Twilio, email, alertas reales, outputs finales.
- `NOTAS ENVIADAS MERYPOZOS`, Patrón final, Jumex final, producción de
  clientes.
- Proxy, Playwright para evasión, paywall bypass.
- Ejecución automática de `repair-failed-sources-batch --apply`.
- Promoción automática de ningún medio (`approval_required=true` siempre en
  V1).

La certificación de medios permanece **separada** de la activación de
clientes y de los envíos — son capas de control distintas.

---

## 14. Criterios futuros de éxito de Shadow Validator V1

V1 deberá poder: recibir 10–20 `medio_id`; identificar correctamente cada
medio; leer el audit inicial; relacionar cada medio con su ejecución real;
parsear crawl por medio (ya disponible, §7); parsear enrich por medio
(requiere cerrar el gap de §7); extraer métricas y errores por medio;
interpretar el post-audit; calcular ratios técnicos básicos; clasificar
PASS/REVIEW/FAIL; recomendar `ELIGIBLE_FOR_PROMOTION`/`REVIEW_REQUIRED`/
`REPAIR_AND_RETEST`/`BLOCKED_FAIL`; **no confundir workflow success con media
success**; generar evidencia reproducible y un reporte legible; no tocar
producción; no reparar automáticamente; tener tests; usar Deterministic
Regression Fixtures; usar Live Canary Media; ser extensible a Media Health
Monitor; reducir claramente el QA manual de Juan.

---

## 15. Roadmap

Integrado al plan existente (`docs/PRODUCTION_READINESS_PLAN.md`) como una
capacidad transversal — no reemplaza ni reordena las fases de sustitución
de PressClipping ya definidas ahí (Fase 0 shadow medible → Fase 5
sustitución global); corre en paralelo, como pre-requisito de calidad para
escalar el catálogo que alimenta esas fases.

| Fase | Contenido | Estado |
|---|---|---|
| **0** | Documentación/arquitectura (este documento) | ✅ Esta entrega |
| **1** | Shadow Validator V1 — *report-only*: per-media attribution, log parser, audit antes/después, métricas, error taxonomy, quality ratios, PASS/REVIEW/FAIL, recommendation, reporte. Sin promoción automática. | Pendiente, no implementado |
| **2** | Deterministic Regression Fixtures: RSS, XML, HTML, sitemap, HTTP, errores conocidos, enrich, normalización, dedupe donde aplique | Pendiente |
| **3** | Live Canary Media / Regression: usar `LISTO_LEYENDO` como canaries reales, medir degradación (no outputs idénticos) | Pendiente |
| **4** | Assisted Repair: clasificar errores, proponer fix, crear issue/tarea eventualmente, retest. **Sin `--apply` automático.** | Pendiente |
| **5** | Media Health Monitor: checks periódicos, histórico, detección de regresiones, recertificación | Pendiente |
| **6** | Promoción semiautomática: PASS → `ELIGIBLE_FOR_PROMOTION` → aprobación humana → `LISTO_LEYENDO` | Pendiente |
| **7** | Escalamiento 300/500+ medios: validación masiva, QA basado en excepciones, mínimo crecimiento proporcional del trabajo humano | Pendiente |

**Nada de lo anterior a Fase 1 se implementa en esta entrega.**

---

## 16. Qué NO se automatiza todavía (resumen de guardrails de esta fase)

- No se crea `scripts/shadow-validator.ts` ni ningún script operativo nuevo.
- No se crean workflows nuevos.
- No se crean tablas Supabase nuevas.
- No se implementan health checks.
- No se implementa promoción (automática ni semiautomática).
- No se implementa reparación automática.
- No se modifica `src/`, `scripts/`, `test/`, `.github/workflows/`, Supabase,
  migraciones, `package.json` ni configuración operativa.
- Esta Fase 0 es exclusivamente documental: no implementó, activó ni
  automatizó ningún cambio operativo.

---

## 17. Referencias cruzadas

- `docs/NEWS_LAKE_V0.md` — arquitectura del News Lake (captura general vs.
  detección por cliente); base del Data Plane descrito aquí.
- `docs/PRODUCTION_READINESS_PLAN.md` — roadmap de sustitución de
  PressClipping (Fase 0–5); esta capacidad es transversal a ese plan.
- `docs/README_PARALELO_MEDIOS_PRESSCLIPPING.md` — proceso humano actual
  (Juan + programador) de clasificación A–E que Shadow Validator V1 busca
  asistir/reducir, no reemplazar de golpe.
- `scripts/audit-all-media-clean-capture-readiness.ts` — fuente de verdad
  actual de `readiness_state`, reutilizada (no duplicada) por el Validator.
- Rama `juan/production-tier-runbook` (no mergeada) —
  `.github/workflows/news-lake-tier1/2/3.yml` +
  `docs/PRODUCTION_NEWS_LAKE_RUNBOOK.md`: define los Tier 1/2/3 operativos a
  los que un medio se "promueve" tras certificación (Fase 6). Se referencia
  solo para contexto arquitectónico; **no se mergeó ni se modificó** en esta
  fase.
