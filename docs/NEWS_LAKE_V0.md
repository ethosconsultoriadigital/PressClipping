# News Lake v0 — Núcleo PressClipping v0 (captura general + búsqueda ad-hoc)

## Objetivo

Separar la **captura general de noticias** (el "lake": ~200+ medios, memoria
rolling de ~30 días) de la **detección por cliente/keyword**. Antes de esta
fase, `crawl.ts` y `enrich-news.ts` ya eran genéricos (no dependen de
clientes/keywords), pero no existía:

1. Un **orquestador** que recorriera el catálogo completo en bloques
   ("chunks") y encadenara `crawl → enrich` de forma sistemática (hoy eso
   solo pasaba de forma ad-hoc, por cliente: p.ej. `mery-priority-media-capture.ts`).
2. Un **buscador de solo lectura** sobre ese lake, para responder preguntas
   puntuales ("¿salió algo de X persona/empresa/marca en 30 días?") sin dar
   de alta un cliente/keyword nuevo.

Esta fase agrega ambas piezas, reutilizando el 100% de la lógica existente
de crawl/enrich/matching. **No se rediseñó nada de crawl, enrich ni
detect-mentions.**

## Arquitectura

```
                 ┌────────────────────────┐
 medios activos  │  news-lake-capture.ts  │   (orquestador delgado)
 (Supabase)  ───▶│  selección + chunking  │
                 └───────────┬────────────┘
                              │ por cada chunk (subprocesos)
                 ┌────────────▼────────────┐
                 │ npx tsx scripts/crawl.ts │  (ya existente, sin cambios)
                 │ --medio-ids=<chunk>      │
                 └────────────┬────────────┘
                              │
                 ┌────────────▼─────────────────┐
                 │ npx tsx scripts/enrich-news.ts│  (ya existente, sin cambios)
                 │ --medio-ids=<chunk>           │
                 │ --recent-first                │
                 │ --only-missing-clean-text     │
                 └────────────┬──────────────────┘
                              │
                       tabla `noticias`
                       (texto completo, sin cliente/keyword)
                              │
                 ┌────────────▼────────────┐
                 │ search-news-lake.ts     │   (solo lectura, ad-hoc)
                 │ fts → fallback ILIKE    │
                 │ o matchKeyword en memoria│
                 └─────────────────────────┘
                              │
              (por separado, sin tocar este flujo)
                 ┌────────────▼────────────┐
                 │ detect-mentions.ts       │  (ya existente, sin cambios)
                 │ --client=CLI-XXXX        │  → tabla `menciones`
                 └──────────────────────────┘
```

Las keywords/clientes **no deciden qué se captura**; solo deciden, más
adelante y por separado, qué se convierte en "mención" vía
`detect-mentions.ts --client=...`.

## `scripts/news-lake-capture.ts`

Orquestador delgado: **no reimplementa** `crawl.ts` ni `enrich-news.ts`, los
invoca como subprocesos (mismo patrón que ya usa
`scripts/mery-priority-media-capture.ts`).

Selección de medios: reutiliza `getMediosActivos()` +
`seleccionarMedios()` (la política conservadora de `src/crawlers/selection.ts`,
la MISMA que usa `crawl.ts`) — excluye por defecto medios inactivos,
`requiere_javascript`, `requiere_proxy`, duplicados, y los diagnosticados
como `error`/`sin_fuente`/`especial` en `08_Validacion_Medios` (si esa
pestaña está disponible; si no, sigue solo con los filtros duros).

### Flags

| Flag | Default | Descripción |
|---|---|---|
| `--dry-run` / `--no-dry-run` | `true` | Modo seguro: imprime el plan (medios + chunks) y **no** descarga, enriquece ni escribe nada. |
| `--max-medios` | `20` | Tope de medios a incluir (ignorado si viene `--medio-ids`). |
| `--medio-ids` | — | Lista `MED-0001,MED-0002` dirigida; ignora `--max-medios`. |
| `--max-notas` | `5` | Tope de notas a crawlear por medio, por chunk. |
| `--enrich-limit` | `20` | Tope de notas a enriquecer por chunk. |
| `--window-days` | `30` | Ventana de `enrich-news.ts --window-days` (con `--recent-first`, prioriza notas recientes). |
| `--chunk-size` | `5` | Medios por chunk (crawl→enrich se ejecuta chunk por chunk). |

### Comportamiento

- **Dry-run** (default): calcula el plan completo (medios incluidos,
  excluidos por motivo, chunks) e imprime cada chunk. No invoca `crawl.ts`
  ni `enrich-news.ts`. No escribe nada.
- **Modo real**: procesa **chunk por chunk**, en orden:
  1. `npx tsx scripts/crawl.ts --medio-ids=<chunk> --max-notas=<N>`
  2. `npx tsx scripts/enrich-news.ts --medio-ids=<chunk> --limit=<N> --window-days=<N> --recent-first --only-missing-clean-text`
  - Si el `crawl` de un chunk falla (código de salida ≠ 0), se **omite el
    enrich de ese chunk** y se **continúa con el siguiente chunk** (no
    aborta la corrida completa).
  - Si el `enrich` falla, se registra un warning y se continúa igual.
  - Al final imprime un resumen: chunks OK, chunks con error y cuáles.
- **Nunca**: detecta menciones, escribe en Google Sheets, envía
  alertas/email/WhatsApp/Twilio/SMTP, corre `export-results`,
  `generate-xml` ni `classify-ia`.

## `scripts/search-news-lake.ts`

Buscador **de solo lectura** sobre el lake de noticias (cualquier tema,
persona, empresa o marca), en una ventana móvil de N días (default 30).
Nunca inserta menciones ni marca noticias como procesadas.

### Flags

| Flag | Default | Descripción |
|---|---|---|
| `--query="texto libre"` | — | Full-text (fts, español) con fallback automático a ILIKE. |
| `--exact="frase exacta"` | — | Match de frase exacta (límite de palabra) en memoria, vía `matchKeyword`. |
| `--contains="término"` | — | Match de substring en memoria, vía `matchKeyword`. |
| `--window-days` | `30` | Ventana móvil sobre `fecha_publicacion`. |
| `--medio-ids` | — | Acota a estos `medio_id`. |
| `--limit` | `20` | Tope de resultados finales. |
| `--format` | `table` | `table` (consola, legible) o `json`. |
| `--full-text` | `true` | Si es `false`, salta directo a ILIKE (no intenta `fts`). |

Si se combina más de un modo de búsqueda, la precedencia es
`--query > --exact > --contains` (se avisa en el log cuál se ignoró).
Sin ninguno de los tres: modo "browse", devuelve lo más reciente de la
ventana.

### Estrategia de `--query`

1. Intenta `.textSearch('fts', query, { type: 'websearch', config: 'spanish' })`
   sobre la columna generada `fts` (ya existente en el schema, con índice
   GIN — ver `supabase/migrations/0001_initial_schema.sql`).
2. Si falla (columna/índice no disponible, error de sintaxis de tsquery,
   etc.), hace **fallback automático** a un `OR` de `ILIKE` sobre
   `titulo`/`resumen`/`texto_nota_limpia`/`texto_cuerpo_nota`/`texto_extraido`.

### Estrategia de `--exact` / `--contains`

Trae la ventana completa (acotada por `medio_ids`, sin filtro de texto en la
query — hasta un tope de escaneo interno entre 200 y 2000 filas según
`--limit`), y aplica `matchKeyword` en memoria (el mismo matcher que usa
`detect-mentions.ts`) con una regla ad-hoc (`cliente_id: null`, sin
contexto incluir/excluir, `tipo: frase_exacta` o `contiene`). Como
`cliente_id` es `null`, ninguna puerta contextual de cliente (Tequila
CLI-0002, Jumex CLI-0001, etc.) aplica — el resultado por defecto de esas
puertas es "pasa" cuando no hay cliente asociado.

### Salida

Cada resultado expone: `titulo`, `resumen`, `url_original`,
`fecha_publicacion`, `medio_id`, `medio_nombre` y `texto` (=
`texto_cuerpo_nota ?? texto_nota_limpia ?? texto_extraido ?? resumen`).

## Retención de 30 días

La ventana de 30 días vive como **default de los scripts**
(`--window-days=30` en `news-lake-capture.ts` y `search-news-lake.ts`), no
como borrado físico. **No se elimina ningún dato histórico**: las notas más
viejas simplemente quedan fuera del filtro por defecto de estos comandos, y
siguen disponibles ampliando `--window-days` o consultando Supabase
directamente. Una política de retención física (partición/archivado) queda
fuera de esta fase.

## Nueva función de lectura en `src/supabase/repositories.ts`

`getNoticiasEnVentana(opts)` — única función nueva agregada. Es de **solo
lectura**, no depende de `keywords` ni `clientes`, y soporta:

- `windowDays` (filtro `gte fecha_publicacion`)
- `medioIds` (filtro `in medio_id`)
- `limit`
- `textFilter`: `{ modo: 'fts', query }` o `{ modo: 'ilike', term }` (opcional)

No se modificó ninguna función existente de `repositories.ts`.

## Workflow: `.github/workflows/news-lake-capture.yml`

Solo `workflow_dispatch` (**sin schedule** todavía). Defaults seguros:
`dry_run=true`, `max_medios=20`, `max_notas=5`, `enrich_limit=20`,
`window_days=30`, `chunk_size=5`. Secrets: únicamente
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (sin credenciales de Google
Sheets ni de envío). Usa el mismo `NODE_OPTIONS` de preload de WebSocket que
el resto de workflows que tocan Supabase en Node 20. `concurrency`
(`group: news-lake-capture`, `cancel-in-progress: false`) para que dos
corridas manuales no se pisen.

## Guardrails respetados

- No toca Patrón ni Jumex ("final") ni "NOTAS ENVIADAS MERYPOZOS".
- No email / WhatsApp / Twilio / SMTP / alertas reales.
- No `export-results`, no `generate-xml`, no `classify-ia`.
- No detecta menciones (eso lo sigue haciendo `detect-mentions.ts`, por
  cliente, en un flujo separado).
- No escribe ni lee Google Sheets.
- No borra noticias ni menciones.
- No usa proxy, Playwright ni bypass de paywall (la selección de medios ya
  los excluye, igual que `crawl.ts`).
- No hay crawl masivo sin límites: todos los flags tienen default seguro y
  el chunking evita corridas descontroladas.
- No se creó ninguna migración de Supabase (`supabase/migrations/0014...`
  queda pendiente para una fase posterior, si hiciera falta).

## Uso

```bash
# Ver el plan sin ejecutar nada (default)
npm run news-lake:capture -- --dry-run

# Captura real acotada
npm run news-lake:capture -- --max-medios=20 --chunk-size=5 --max-notas=5 --enrich-limit=20

# Captura dirigida a medios concretos
npm run news-lake:capture -- --medio-ids=MED-0001,MED-0002 --no-dry-run

# Búsquedas ad-hoc
npm run news-lake:search -- --query="Mery Pozos"
npm run news-lake:search -- --contains="Jumex"
npm run news-lake:search -- --exact="Bacardí México"
npm run news-lake:search -- --query="SIAPA plomo mercurio" --window-days=30 --limit=20
npm run news-lake:search -- --contains="Jumex" --format=json
```
