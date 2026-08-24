# CLIENT LIVE SHEET SHADOW — Exportador LIVE shadow a Google Sheets

**Versión:** 1.0  
**Estado:** SHADOW (append-only, sin alertas reales, para revisión humana)  
**Script:** `scripts/client-live-sheet-export.ts`  
**Workflow:** `.github/workflows/client-live-sheet-export.yml`

---

## Objetivo

Exportar de forma segura y controlada los resultados del **News Lake v0** a Google Sheets, organizados por cliente o tema, para que el equipo pueda **revisar manualmente la calidad** antes de activar alertas internas o WhatsApp.

El ciclo esperado es:
```
News Lake (crawl + enrich) → client-live-sheet-export → Google Sheets → Revisión Humana → (futuro) Alertas
```

---

## Qué hace

- Busca noticias del news lake en una ventana rolling de N días.
- Las clasifica automáticamente en buckets según el nivel de confianza del match.
- Escribe los resultados en una Google Sheet arbitraria de forma **append-only** (nunca borra ni reemplaza).
- Deduplica por `dedupe_key` antes de escribir: no duplica filas entre corridas.
- Hace readback post-escritura y reporta `mismatch` si el conteo no cuadra.
- Escribe una fila de log resumen por corrida en la pestaña `06_Logs`.
- Soporta dos modos de búsqueda (ver abajo).

### Modos de búsqueda

| Modo | Flag | Descripción |
|------|------|-------------|
| **A — Cliente** | `--client-id` | Carga keywords activas del cliente, deriva términos de búsqueda (frases completas, prioriza las más largas/precisas), busca candidatos en el News Lake por término (fts con fallback ilike) y aplica `matchKeyword` sobre esos candidatos |
| **B — Ad-hoc** | `--query`, `--exact`, `--contains` | Búsqueda libre sin cliente registrado |

Con `--client-id`, los flags `--query/--exact/--contains` se ignoran (gana el cliente).

### Modo A — recuperación de candidatos dirigida por keyword

En vez de escanear las últimas N noticias genéricas de la ventana y filtrarlas en memoria, el Modo A:
1. Carga las keywords activas del cliente (`getKeywordsActivas` filtrado por `client_id`).
2. Extrae términos de búsqueda de cada keyword (`splitTerminos`), priorizando las frases más largas (mayor precisión), hasta `MAX_TERMINOS_BUSQUEDA_CLIENTE` (15) términos.
3. Por cada término, busca en el News Lake (fts, con fallback a ilike si fts falla), hasta `CANDIDATOS_POR_TERMINO_CLIENTE` (50) resultados por término.
4. Deduplica candidatos por `noticia_id` y `url_original`, hasta `MAX_CANDIDATOS_CLIENTE_TOTAL` (300) en total.

Esto evita que `01_LIVE_Notas_Capturadas` se llene con noticias genéricas no relacionadas al cliente, y mejora sensiblemente el recall frente al escaneo genérico anterior.

### Modo A — consolidación por noticia

Una misma noticia puede matchear varias keywords del cliente (p. ej. `"Mery Pozos"`, `"Diputada Mery Pozos"`, `"Merilyn Gomez Pozos"`). El exportador **consolida todos esos matches en una única fila** por noticia antes de escribir a Sheets — nunca una fila por keyword:

- Se evalúan todas las keywords activas contra la noticia.
- El **mejor score** de todos los matches decide el bucket (`Menciones_Detectadas` si score≥0.6, si no `Revision_Humana`) y la `confidence`/`motivo` principal.
- Las columnas `keywords_matched`, `keyword_ids_matched` y `motivos_match` agregan (separadas por ` | `) todas las keywords que matchearon, no solo la mejor.
- `best_score` = score del mejor match; `match_count` = cuántas keywords matchearon.
- Una noticia **nunca** aparece simultáneamente en `Menciones_Detectadas` y `Revision_Humana` (prioridad: Menciones > Revision > Excluidas).
- El `dedupe_key` de la fila consolidada usa un sufijo estable `mention` (no el `keyword_id`), para que la fila no cambie de identidad entre corridas aunque varíe qué keyword específica matcheó primero.

### Buckets de clasificación

| Tab | Bucket | Criterio |
|-----|--------|----------|
| `01_LIVE_Notas_Capturadas` | Todas las candidatas | Noticias fetched del lake, pre-matching |
| `02_Menciones_Detectadas` | Alta confianza | Match en título/resumen (score≥0.6) o `--exact`/`--contains` |
| `03_Revision_Humana` | Posible match | Score bajo (<0.6) o `--query` broad sin match exacto en título |
| `04_Excluidas` | (headers; v1 manual) | Reservado para descarte explícito por revisor |
| `05_Comparativo_vs_Actual` | (headers; v1 vacío) | Comparativo vs sistema actual — fase siguiente |
| `06_Logs` | Resumen de corrida | Metadatos, conteos, mismatch, duración |

---

## Qué NO hace

- **No** envía alertas (WhatsApp, email, Twilio, SMTP).
- **No** inserta en la tabla `menciones` de Supabase.
- **No** modifica `detect-mentions.ts`.
- **No** toca Patrón final, Jumex final, ni NOTAS ENVIADAS MERYPOZOS.
- **No** borra, limpia ni reemplaza contenido existente en la Sheet.
- **No** genera reportes PDF ni invoca classify-ia.
- **No** tiene schedule (workflow_dispatch únicamente).

---

## Columnas de las tabs de datos (01–04)

| Columna | Descripción |
|---------|-------------|
| `dedupe_key` | Clave única por fila: `identifier//noticia_id//sufijo` |
| `fecha_export` | ISO 8601 del momento de exportación |
| `client_id` | ID del cliente o `null` si es ad-hoc |
| `client_name` | Nombre legible del cliente (para logs) |
| `query` | Término de búsqueda (Modo B) |
| `match_mode` | `cliente_keyword`, `query`, `exact`, `contains` |
| `bucket` | Nombre del bucket de clasificación |
| `confidence` | `high`, `medium`, `low`, `-` |
| `medio_id` | ID del medio fuente |
| `medio_nombre` | Nombre del medio |
| `fecha_publicacion` | Fecha ISO de la nota original |
| `titulo` | Título de la nota |
| `resumen` | Resumen/bajada |
| `url_original` | URL canónica de la nota |
| `texto` | Cuerpo efectivo (cuerpo_nota > nota_limpia > extraido > resumen) |
| `motivo` | Explicación del score/bucket (por qué se clasificó así) |
| `keywords_matched` | (solo Modo A, filas consolidadas) Keywords que matchearon, separadas por ` \| ` |
| `keyword_ids_matched` | (solo Modo A) `keyword_id`s que matchearon, separados por ` \| ` |
| `motivos_match` | (solo Modo A) Motivo de match por keyword, separados por ` \| ` |
| `best_score` | (solo Modo A) Mejor score entre todas las keywords que matchearon |
| `match_count` | (solo Modo A) Cantidad de keywords que matchearon esta noticia |
| `source_script` | `client-live-sheet-export` |
| `run_by` | `local` o `github-actions-client-live-sheet-export` |

---

## Flujo operativo

### 1. Preparación (una sola vez)

Compartir la Google Sheet destino con el email de la cuenta de servicio como **Editor**:
```
GOOGLE_SERVICE_ACCOUNT_EMAIL = (ver secrets del repo)
```

### 2. Corrida dry-run (siempre primero)

```bash
npm run client-live:sheet -- \
  --dry-run=true \
  --sheet-id=<SHEET_ID> \
  --client-id=CLI-0002 \
  --window-days=7 \
  --limit=50
```

El script imprime el plan completo, el preview de las primeras 3 filas por bucket y los nombres de las tabs que se crearían, **sin escribir nada**.

### 3. Corrida real controlada

```bash
npm run client-live:sheet -- \
  --dry-run=false \
  --sheet-id=<SHEET_ID> \
  --client-id=CLI-0002 \
  --client-name="Patrón Tequilero" \
  --window-days=7 \
  --limit=100 \
  --max-rows=100
```

---

## Ejemplos específicos

### Mery Pozos (Modo B — query)

```bash
# Dry-run
npm run client-live:sheet -- \
  --dry-run \
  --sheet-id=<SHEET_MERY_ID> \
  --query="Mery Pozos" \
  --tab-prefix=MERY_SHADOW \
  --window-days=30

# Real (después de aprobar el dry-run)
npm run client-live:sheet -- \
  --dry-run=false \
  --sheet-id=<SHEET_MERY_ID> \
  --query="Mery Pozos" \
  --tab-prefix=MERY_SHADOW \
  --window-days=30 \
  --limit=50
```

### Bacardí México (Modo B — exact)

```bash
# Dry-run
npm run client-live:sheet -- \
  --dry-run \
  --sheet-id=<SHEET_BACARDI_ID> \
  --exact="Bacardí México" \
  --tab-prefix=BACARDI_SHADOW \
  --window-days=30

# Real
npm run client-live:sheet -- \
  --dry-run=false \
  --sheet-id=<SHEET_BACARDI_ID> \
  --exact="Bacardí México" \
  --tab-prefix=BACARDI_SHADOW \
  --window-days=30
```

### Patrón Tequilero CLI-0002 (Modo A — client_id)

```bash
# Dry-run con ventana de 7 días
npm run client-live:sheet -- \
  --dry-run \
  --sheet-id=<SHEET_PATRON_ID> \
  --client-id=CLI-0002 \
  --client-name="Patrón Tequilero" \
  --tab-prefix=CLI0002_LIVE \
  --window-days=7

# Real
npm run client-live:sheet -- \
  --dry-run=false \
  --sheet-id=<SHEET_PATRON_ID> \
  --client-id=CLI-0002 \
  --client-name="Patrón Tequilero" \
  --tab-prefix=CLI0002_LIVE \
  --window-days=7 \
  --limit=200 \
  --max-rows=200
```

### Query ad-hoc SIAPA / plomo / mercurio

```bash
npm run client-live:sheet -- \
  --dry-run \
  --sheet-id=<SHEET_ID> \
  --query="SIAPA plomo mercurio" \
  --tab-prefix=SIAPA_SHADOW \
  --window-days=30 \
  --limit=30
```

---

## Dedup key design

Formato: `identifier//noticia_id//sufijo`  
Ejemplos:
- Tab 01 (notas raw, Modo A): `cli-0002//n-abc123//raw`
- Tab 02/03 (mención consolidada, Modo A): `cli-0002//n-abc123//mention` — sufijo fijo, **no** depende de qué `keyword_id` matcheó (una noticia con 1 o con 5 keywords matcheadas sigue teniendo la misma `dedupe_key`).
- Tab 02 (ad-hoc exact): `exact-bacardi-m-xico//n-abc123//adhoc`

La misma `dedupe_key` en la misma tab → fila omitida (dedupe).  
La misma nota puede aparecer en Tab 01 y Tab 02 (son dedupe_key distintas, tabs distintas).

---

## Workflow GitHub Actions

El workflow `client-live-sheet-export.yml` expone los mismos flags como inputs:

| Input | Default | Descripción |
|-------|---------|-------------|
| `dry_run` | `true` | Siempre seguro por defecto |
| `sheet_id` | `` | ID de la Google Sheet destino |
| `tab_prefix` | `ETHOS_LIVE` | Prefijo de las pestañas |
| `client_id` | `` | Modo A |
| `client_name` | `` | Nombre legible para logs |
| `query` | `` | Modo B — full-text |
| `exact` | `` | Modo B — frase exacta |
| `contains` | `` | Modo B — substring |
| `window_days` | `30` | Ventana rolling en días |
| `limit` | `100` | Tope de noticias a consultar |
| `max_rows` | `100` | Safety cap de filas a escribir |

Secrets requeridos en el repositorio:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`

---

## Siguiente fase

1. **Comparativo vs sistema actual** (`05_Comparativo_vs_Actual`): comparar resultados Ethos vs PressClipping usando el módulo existente `src/comparators/`.
2. **Alertas internas** (`cli-0002`): activar envío de digest email interno desde `02_Menciones_Detectadas` al cerrar gates de GO/NO-GO.
3. **Schedule semanal**: agregar cron al workflow cuando la calidad sea validada por revisión humana durante 2+ semanas seguidas.
