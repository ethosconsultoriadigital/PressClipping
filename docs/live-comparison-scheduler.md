# Scheduler del ciclo vivo — Comparativo Ethos vs PressClipping

Este documento describe cómo automatizar el **comparativo cada 2 horas** contra el
XML de PressClipping. El scheduler **todavía no está activo**: primero queremos al
menos **2 ciclos manuales exitosos** después de reparar discovery de medios.

## Comando recomendado

Ciclo de solo comparación (import XML + compare + export a Sheet), sin crawl nuevo:

```bash
npm run live-comparison -- \
  --xml-url=https://tabla.ethosconsultoriadigital.workers.dev/read-xml \
  --fecha-desde=<HOY> \
  --fecha-hasta=<MAÑANA> \
  --output=sheet \
  --replace-window
```

Ciclo completo con captura (cuando se reparen/agreguen medios), añade:

```bash
  --crawl-medio-ids=MED-0001,MED-0151 --crawl-limit=50 --enrich-limit=250 --detect-limit=250
```

El orquestador (`scripts/run-live-comparison.ts`):

1. `import-pressclipping` desde XML (dedupe por `hash_registro`).
2. `crawl` dirigido **solo** si se pasan `--crawl-medio-ids`.
3. `enrich` pendientes (solo si hubo crawl).
4. `detect` dry-run (solo si hubo crawl).
5. `detect` real **solo si el dry-run está limpio** (`sinTexto === 0`).
6. `export-results` **solo si** detect real insertó menciones.
7. `compare-mentions --output=sheet --replace-window`.
8. Resumen final.

Si no se pasan medios para crawl: solo **import + compare + resumen** (modo cada-2-horas).

Nunca corre: `generate-xml`, `classify-ia`, alertas, WhatsApp/correos, `export-raw-news`.

## Opción recomendada: GitHub Actions (cron cada 2 horas)

Ventajas: sin infraestructura propia, ya usamos Node 20, secrets nativos.

Archivo propuesto (NO activar todavía) `.github/workflows/live-comparison.yml`:

```yaml
name: live-comparison
on:
  schedule:
    - cron: '0 */2 * * *'   # cada 2 horas (UTC)
  workflow_dispatch: {}       # disparo manual

concurrency:
  group: live-comparison
  cancel-in-progress: false

jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - name: Live comparison
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          GOOGLE_SHEET_ID: ${{ secrets.GOOGLE_SHEET_ID }}
          GOOGLE_OUTPUT_SHEET_ID: ${{ secrets.GOOGLE_OUTPUT_SHEET_ID }}
          GOOGLE_SERVICE_ACCOUNT_EMAIL: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_EMAIL }}
          GOOGLE_PRIVATE_KEY: ${{ secrets.GOOGLE_PRIVATE_KEY }}
          LOG_FORMAT: json
          RUN_BY: github-actions
        run: |
          HOY=$(date -u +%F)
          MANANA=$(date -u -d "+1 day" +%F)
          npm run live-comparison -- \
            --xml-url=https://tabla.ethosconsultoriadigital.workers.dev/read-xml \
            --fecha-desde=$HOY --fecha-hasta=$MANANA \
            --output=sheet --replace-window
```

### Variables de entorno necesarias (secrets)

| Secret | Uso |
|---|---|
| `SUPABASE_URL` | conexión a Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | lectura/escritura de noticias, menciones, comparativo |
| `GOOGLE_SHEET_ID` | hoja de configuración (keywords, medios) |
| `GOOGLE_OUTPUT_SHEET_ID` | hoja de salida (`05_Comparativo_PressClipping`, etc.) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | service account de Google |
| `GOOGLE_PRIVATE_KEY` | clave privada del service account (con `\n` escapados) |
| `LOG_FORMAT=json` | logs parseables por el orquestador |

## Alternativas evaluadas

| Opción | Pros | Contras | Veredicto |
|---|---|---|---|
| **GitHub Actions** | sin infra, secrets nativos, gratis | corre en UTC, cold start | **Recomendada** |
| Cloud Run Job + Scheduler | escala, ideal si luego se agrega proxy/JS | más setup, costo | Futuro (si hace falta proxy) |
| Apps Script trigger | dentro de Google | no corre Node/tsx | Descartada |
| Cron local | simple | requiere máquina encendida 24/7, frágil | Descartada |

## Activación (cuando se confirme)

1. Verificar 2 ciclos manuales exitosos.
2. Crear los secrets en el repositorio.
3. Añadir el workflow y hacer un `workflow_dispatch` de prueba.
4. Recién entonces dejar el `schedule` activo.

## Bitácora de ciclos manuales (gate para activar)

Requisitos para activar: 2 ciclos manuales exitosos, sin duplicados, sin modificar
`01_Noticias_Raw`, sin falsos positivos masivos, Sheet estable.

| Ciclo | Fecha | Crawl | Detect FP masivos | Duplicados Sheet | 01_Noticias_Raw | Resultado |
|---|---|---|---|---|---|---|
| #1 | 2026-06-26 | El Informador (99) + Xataka (19) | No (0 menciones orgánicas) | No (replace-window) | Intacta | **Estable** (cobertura 0%, precision_ajustada 100%) |
| #2 | 2026-06-26 | 4 medios (31 nuevas, 2 promovidas) | No (2 menciones legítimas) | No (replace-window) | Intacta | **Estable** (cobertura_ajustada_clusters 40%, precision_ajustada 100%) |
| #3 | 2026-06-26 | EdoMex Al Día (10, reparado RSS) + Forbes (33) | No (0 menciones nuevas) | No (replace-window) | Intacta | **Estable** (cobertura_ajustada_clusters 40%, precision_ajustada 100%, + auditoría de 143 medios) |
| #4 | 2026-06-26 | 5 medios reparados (496 nuevas) | No (4 menciones; 1 válida, 3 borderline) | No (replace-window) | Intacta | **Estable** (precision_ajustada 100%; cobertura_ajustada_clusters 22% por crecimiento del XML 15→20) |

**Gate de 2 ciclos manuales estables: CUMPLIDO.** El workflow queda preparado en
`.github/workflows/live-comparison.yml.disabled` (NO activo).

### Gate ampliado antes de activar cron (homologación)

Aunque el gate de 2 ciclos está cumplido, antes de activar el scheduler se exige:

1. ✅ Auditoría de medios activa (`audit-media-sources`).
2. ✅ `08_Cobertura_Medios` funcionando (143 medios homologados, replace A2:AD).
3. ✅ Una corrida con auditoría + live-comparison estable (ciclo #3).
4. ⏳ **Decisión humana de activar cron** (pendiente). Activar solo con
   autorización humana (ver pasos al inicio del `.yml.disabled`).

## Fase de homologación técnica de medios

`audit-media-sources` audita la tabla `medios` SIN crawl masivo: prueba RSS/sitemap
candidatos (con early-exit), `robots.txt` y la página base, y clasifica cada medio en
un **estado técnico estándar** (`READY_RSS`, `REPAIRABLE_SITEMAP`, `DISCOVERY_GAP`,
`JS_REQUIRED`, `PROXY_REQUIRED`, `BLOCKED`, `NO_FEED`, `TIMEOUT`,
`LOW_VALUE_AGGREGATOR`, …). Cruza con la frecuencia de aparición en
`comparativo_pressclipping` para asignar `prioridad_reparacion` (1=alta … 4=ruido).

```bash
# Lote prioritario (dry-run)
npm run audit-media-sources -- --medio-ids=MED-0001,MED-0017,MED-0145,MED-0152 --output=sheet --dry-run
# Todos los activos → 08_Cobertura_Medios (replace A2:AD)
npm run audit-media-sources -- --only-active --output=sheet
# Reparar un medio puntual con fuente validada (REPAIRABLE_*)
npm run audit-media-sources -- --medio-ids=MED-0148 --update-db
```

`--output=sheet` hace **replace** de `08_Cobertura_Medios` (conserva cabeceras, no
toca 01/05/07). Si la pestaña no existe, reporta error claro y **no escribe**.
`--update-db` solo modifica medios `REPAIRABLE_*` **con fuente viable validada**.

**Aviso de falsos REPAIRABLE por timeout:** bajo concurrencia con timeout corto (8 s)
un medio sano puede marcarse `REPAIRABLE` si su feed tardó en responder (caso Forbes:
`news-sitemap.xml` real tiene 152 ítems pero el sondeo lo perdió). Antes de reparar
con `--update-db`, **verificar la fuente configurada** directamente. No cambiar un
news-sitemap correcto por un `sitemap_index` masivo.

### Auditor endurecido (confidence_score)

Para evitar el caso Forbes, el auditor ahora:

1. **Prueba primero la fuente configurada de forma robusta** (timeout 12 s, 1 retry).
   Si entrega ≥10 ítems → `READY_KEEP_CURRENT` (no se toca, no se sondean alternativas).
2. Solo si la configurada NO entrega, sondea alternativas y calcula un
   `confidence_score` (0-1) que penaliza: pocos ítems (<10), baja frescura
   (<3 URLs recientes/30 días), dominio incorrecto e **índices masivos** (≥500 URLs
   o ≥5 sub-sitemaps).
3. Estados resultantes: `REPAIRABLE_RSS_HIGH_CONFIDENCE` / `REPAIRABLE_SITEMAP_HIGH_CONFIDENCE`
   (confidence ≥0.90, aptos para `--update-db`), `REPAIRABLE_NEEDS_REVIEW` (0.70-0.89),
   `DO_NOT_TOUCH` (única opción es un índice masivo), más los técnicos
   (`DIRECT_EXTRACTION_ONLY`, `NO_FEED`, `BLOCKED`, `TIMEOUT`, `JS_REQUIRED`, `PROXY_REQUIRED`).

`--update-db` **solo** repara estados `REPAIRABLE_*_HIGH_CONFIDENCE` con fuente validada.
La limpieza de `08_Cobertura_Medios` usa `clear()` en bloque (no borra fila por fila)
para no exceder la cuota de escritura de Google con cientos de filas.

### Segundo lote de homologación (2026-06-26): 5 medios nacionales

Patrón detectado: muchos medios tenían configurado un `/sitemap.xml` genérico que no
entrega noticias; la homologación encontró su fuente real (news-sitemap o feed de
Google News). Reparados (confidence 1.00) y ahora `READY_KEEP_CURRENT` capturando
orgánicamente:

| medio_id | medio | fuente reparada | nuevas |
|---|---|---|---|
| MED-0030 | Milenio | `sitemap-google-news-index.xml` | 100 |
| MED-0008 | Aristegui Noticias | `editorial…/news-sitemap.xml` | 100 |
| MED-0053 | Publimetro México | `…/google-news-feed` (RSS) | 100 |
| MED-0039 | El Occidental (Jalisco) | `…/rss` | 100 |
| MED-0025 | Uno TV Noticias | `…/news-sitemap.xml` | 96 |

Total: **~496 noticias orgánicas nuevas**. Nota operativa: usar
`--exclude-status=duplicado` en `crawl` para medios con diagnóstico antiguo
(error/sin_fuente) en `08_Validacion_Medios`, o quedan excluidos pese a estar reparados.

### Primera homologación (2026-06-26): 143 medios activos

| Estado | N |
|---|---|
| REPAIRABLE_RSS | 60 |
| REPAIRABLE_SITEMAP | 25 |
| NO_FEED | 18 |
| DIRECT_EXTRACTION_ONLY | 17 |
| READY_SITEMAP | 12 |
| READY_RSS | 6 |
| BLOCKED | 4 |
| TIMEOUT | 1 |

Reparado en esta iteración: **MED-0148 EdoMex Al Día** (`SITEMAP` mal configurado →
`RSS` `https://edomexaldia.com/feed`), que pasó a capturar 10 notas orgánicas.

### Promoción diagnóstico → orgánica

El crawler ahora promueve a `ethos_organico` cualquier nota
`pressclipping_diagnostico` cuyo `hash_url` reaparezca vía fuente orgánica
(rss/sitemap/seccion/buscador). Al promover: reactiva `menciones_procesado=false`
y rellena `fecha_publicacion`/`titulo` faltantes desde el item orgánico (sin pisar
datos existentes). El log de crawl reporta `promovidas_diagnostico: N`. La columna
de auditoría `notas_cobertura` requiere la migración `0013` (degrada sin romper si
no está aplicada).

### Histórico de métricas (07_Metricas_Live)

`live-comparison --append-metrics-history` agrega una fila por corrida a
`07_Metricas_Live` (headers A1:AG1). Esta pestaña es **acumulativa**: NO usa
`--replace-window` (eso solo aplica a `05_Comparativo_PressClipping`). Si la
pestaña no existe, el orquestador la crea con sus cabeceras.

## Notas técnicas pendientes (backlog)

- **Gap Hidrocálido / Tequila**: clasificado `ETHOS_ACTIONABLE_GAP`, pero la nota es un
  **cable EFE** (superávit agroalimentario; tequila/mezcal en contexto exportación).
  Resolver posteriormente vía una fuente de cables o medios nacionales que republican
  EFE, **no** como alta prioritaria individual. No agregar Hidrocálido por sí solo.
- **Notas diagnósticas bloquean recaptura orgánica**: una nota guardada con
  `origen_cobertura=pressclipping_diagnostico` ocupa el `hash_url` de esa URL, por lo
  que el crawl orgánico la omite como duplicada y nunca la convierte en cobertura
  orgánica. Hoy esto es correcto (no inflar cobertura), pero a futuro conviene un job
  que **promueva** una nota diagnóstica a `ethos_organico` solo si esa misma URL
  aparece en el feed orgánico del medio (discovery genuino), sin volver a usar la URL
  de PressClipping como fuente.
- **El Informador**: `sitemap.xml` sigue en 502; la fuente viable es
  `https://www.informador.mx/sitemaps/googlenews.xml` (noticias duras del día). Las
  notas culturales/opinión pueden no aparecer ahí; evaluar `news-daily.xml` como
  complemento si se requieren secciones blandas.
