# Production News Lake Runbook — Producción Controlada (Ethos vs PressClipping)

_Fase "News Lake Production Control Design" (2026-09-01). Diseño de producción
controlada para operar 120–150 medios útiles sin perder notas, como paso
previo a sustituir el PressClipping externo. Este documento es la fuente de
verdad operativa: cómo funciona el News Lake como memoria, cómo correr
capturas por tier, cómo exportar por cliente, y qué NO hacer._

## 0. Resumen ejecutivo

| Pregunta | Respuesta corta |
|---|---|
| ¿Se borra algo con `window_days`? | **No.** Es un filtro de consulta/enrich, no un borrado físico. |
| ¿Hay algún cleanup/retención automática? | **No existe ningún proceso de borrado** en el repo (verificado). |
| ¿Cuántos medios activos hay hoy? | 203 en catálogo, 196 `activo=true`, **70 ya en cron sombra**. |
| ¿Cuántos son útiles hoy (A+B)? | ~60 de los 70 en cron (40 `LISTO_LEYENDO`, 20 con cuerpo parcial). |
| ¿Cómo llegamos a 120–150? | Formalizando Tier 1/Tier 2 (= tiers ya validados, 70 medios) + vetting incremental de Tier 3 sobre los 72 candidatos `CATALOGO_NO_CRON` viables (no bloqueados, no paywall) según el programador vaya reparando los 51 medios rotos. |
| ¿Se activó algún schedule real? | **No.** Todos los workflows nuevos son `workflow_dispatch` únicamente. |
| ¿Se hizo commit? | **No**, pendiente de tu revisión. |

---

## A) Estado real de retención del News Lake

**Búsqueda realizada:** `.delete(`, `DELETE FROM`, `TRUNCATE`, `purge`, `cleanup`
en todo el repo (scripts, workflows, SQL) y en las 13 migraciones de
`supabase/migrations/`. **Ningún resultado relevante**: no existe ningún
script, workflow, cron ni sentencia SQL que borre filas de `noticias` o
`menciones`. Los únicos matches de "cleanup"/"retención" en el repo son texto
de documentación describiendo exactamente esta misma política (ver
`docs/NEWS_LAKE_V0.md` §"Retención de 30 días", ya escrito en la fase
anterior).

**Conclusión:** las notas capturadas por `crawl.ts`/`enrich-news.ts` se
guardan **indefinidamente** en la tabla `noticias` de Supabase. No hay TTL, no
hay partición por antigüedad, no hay job de purga.

## B) Qué hace `window_days` exactamente

`window_days` (o `--window-days`) aparece en dos lugares:

1. **`scripts/enrich-news.ts`** (`--window-days=N --recent-first`): limita
   **qué notas se intentan enriquecer primero** en una corrida (las más
   recientes dentro de N días). No afecta qué se guarda ni borra nada — solo
   prioriza el orden/alcance de una corrida de enrich.
2. **`scripts/search-news-lake.ts`** (`--window-days=N`, default 30): limita
   la ventana de fechas de la **búsqueda de lectura**. Las notas más viejas
   que N días simplemente no aparecen en esa consulta puntual, pero siguen
   existiendo en la base y son accesibles ampliando `--window-days` o
   consultando Supabase directamente.

**Ninguno de los dos borra ni archiva nada.** Es puramente un filtro de
consulta/priorización.

**Recomendación de retención:** dado que no hay borrado físico, la
"retención" hoy es de facto indefinida (mejor que el mínimo pedido de 180
días). Se recomienda:
- **No implementar borrado físico todavía.**
- Formalizar una política de *archivado* (no borrado) más adelante si el
  volumen de `noticias` se vuelve un problema de performance/costo — por
  ejemplo particionado por mes en Postgres — pero **no es urgente hoy** (80k
  noticias/30d en 70 medios; ver tabla de estado abajo).
- Si en el futuro se requiere borrar duplicados exactos o basura confirmada,
  hacerlo en un script explícito, read-only por default (`--dry-run`),
  revisado y ejecutado manualmente — nunca automático.

---

## C) Estado real del catálogo (auditoría fresca 2026-09-01)

Corrido: `npm run audit-all-media-clean-capture-readiness -- --json`
(snapshot generado en `data/all-media-clean-capture-readiness.json`, no
commiteado). Pagina completo por `medio_id` sobre `noticias`/`menciones` de
los últimos 30 días, sin truncamiento.

| Métrica | Valor |
|---|---|
| Total catálogo | 203 |
| `activo=true` | 196 |
| En cron (algún tier) | 70 |
| Catálogo sin cron | 78 |
| Bloqueados (error genérico, "rotos") | 52 |
| Paywall probable (Grupo Reforma) | 3 |
| `LISTO_LEYENDO` (A) | 40 |
| `EN_CRON_TEXTO_MALO` / `NECESITA_REENRICH_RECIENTE` / `BAJO_VALOR` (B) | 20 |
| `EN_CRON_SIN_NOTICIAS` / `NECESITA_REPARAR_FUENTE` (C, roto en cron) | 9 |
| Noticias 30d totales (70 medios en cron) | 80,112 |
| Menciones 30d totales (todos los clientes) | 2,095 |

### Criterios de producción (A–E) usados en esta fase

| Categoría | Definición operativa | Cómo se calcula |
|---|---|---|
| **A** | Captura OK + cuerpo completo | `en_cron=true` y `estado_operativo=LISTO_LEYENDO` (≥70% texto limpio en 7d, ≥3 notas/7d) |
| **B** | Captura OK + cuerpo parcial | `en_cron=true` y `EN_CRON_TEXTO_MALO` / `NECESITA_REENRICH_RECIENTE` / `BAJO_VALOR` |
| **C** | Solo título/snippet/radar o candidato sin capturar aún | `en_cron=true` pero `EN_CRON_SIN_NOTICIAS`/`NECESITA_REPARAR_FUENTE` (roto pese a estar en cron), **o** `en_cron=false` y no bloqueado ni paywall (`CATALOGO_NO_CRON` — candidato nunca probado en producción) |
| **D** | Paywall/API/convenio | `paywall_probable=true` (Grupo Reforma: Reforma, Mural, El Norte) — política: no bypass |
| **E** | Roto/sin fuente/no viable | `ultimo_estado` contiene error/403/404/blocked — **este es exactamente el lote que el programador paralelo está reparando** |

**Nota importante sobre "C":** agrupa dos situaciones distintas por límite del
esquema de 5 categorías pedido: (1) medios en cron cuyo extractor quedó roto
(`Tabasco Hoy`, 0% texto) y (2) medios catalogados pero **nunca puestos en
cron** (72 de los 78 `CATALOGO_NO_CRON`, ni bloqueados ni paywall — son
candidatos "vírgenes", no necesariamente con snippet real todavía). El detalle
completo por medio está en `data/all-media-clean-capture-readiness.json`
(campo `estado_operativo`).

---

## D) Mapa de chunks — cobertura actual vs pendiente

Se cruzó el mapa de 20 chunks (196 medios activos, `chunk-size=10`, del run
`33551992712`) contra la clasificación A–E:

| Categoría | Medios (de los 196) |
|---|---|
| A (listo, cuerpo completo) | 40 |
| B (cuerpo parcial, ya en cron) | 20 |
| C — roto en cron | 10 |
| C — candidato nunca en cron | 72 |
| D (paywall) | 3 |
| E (roto/bloqueado) | 51 |

**Los 70 medios A+B ya en cron son exactamente Tier 1 + Tier 2 propuestos
abajo** (ver sección E) — no hay que "descubrir" nada nuevo ahí, solo
formalizar la operación con workflows y frecuencias explícitas.

**Distribución por chunk** (columna = cuántos medios de cada categoría trae
cada chunk de 10):

| Chunk | A | B | C-roto | C-candidato | D | E |
|---|---|---|---|---|---|---|
| 1 | 2 | 1 | 1 | 3 | 1 | 2 |
| 2 | – | – | – | 8 | – | 2 |
| 3 | – | – | – | 6 | 2 | 2 |
| 4 | 1 | – | 1 | 6 | – | 2 |
| 5 | – | – | – | 5 | – | 5 |
| 6 | 1 | – | – | 6 | – | 3 |
| 7 | – | – | – | 3 | – | 7 |
| 8 | – | – | – | 8 | – | 2 |
| 9 | – | – | – | 4 | – | 6 |
| 10 | – | – | – | 8 | – | 2 |
| 11 | – | – | – | 2 | – | 8 |
| 12 | 2 | 1 | – | 3 | – | 4 |
| 13 | 3 | 2 | – | 4 | – | 1 |
| 14 | 4 | 3 | – | 2 | – | 1 |
| 15 | 6 | 1 | – | 2 | – | 1 |
| 16 | 8 | 2 | – | – | – | – |
| 17 | 4 | 1 | 3 | 1 | – | 1 |
| 18 | 2 | 4 | 3 | 1 | – | – |
| 19 | 5 | 2 | 1 | – | – | 2 |
| 20 | 2 | 3 | 1 | – | – | – |

**Lectura:** los chunks 16, 18, 19, 20 (y en buena parte 13–15, 17) son casi
todo Tier 1/2 ya validado — nada nuevo que hacer ahí salvo mantener el cron
corriendo. Los chunks 5, 7, 9, 11 son mayoritariamente `E` (rotos) — **esos
son el foco correcto del programador paralelo**, no hay nada que Ethos pueda
capturar ahí hasta que se reparen las fuentes. Los chunks 2, 8, 10 (y buena
parte de 3, 6) son mayoritariamente candidatos `C` nunca probados, con pocos
rotos — **son el mejor ROI para las primeras oleadas de Tier 3** (ver §H).

---

## E) Propuesta Tier 1 / Tier 2 / Tier 3

**Decisión de diseño clave:** Tier 1 y Tier 2 **no son listas nuevas** — son
la formalización, con frecuencia/límites explícitos y un workflow dedicado,
de los cuatro tiers de `src/config/shadowMedia.ts` que **ya están corriendo
en cron sombra hoy** y ya pasaron un proceso de validación (calidad de texto,
detección limpia, sin flood) documentado en commits anteriores. Esto cumple
la regla "no volver a inventar/duplicar lo que ya existe".

### Tier 1 — Nacionales / alta prioridad (29 medios)

= `SHADOW_MEDIOS` (base, 25) ∪ `SHADOW_MEDIOS_NACIONALES_B` (4 activos: Uno
TV, Publimetro, Milenio, Aristegui, El Universal — 5 configurados). Incluye
El Economista, El Financiero, El Heraldo, El Sol de México, Forbes, Expansión,
Proceso, La Razón, El Universal, Milenio, Aristegui, Uno TV, Publimetro, etc.

| Parámetro | Valor |
|---|---|
| `medio_ids` | `MED-0151,MED-0153,MED-0001,MED-0020,MED-0160,MED-0031,MED-0167,MED-0154,MED-0165,MED-0157,MED-0060,MED-0161,MED-0152,MED-0159,MED-0163,MED-0156,MED-0155,MED-0034,MED-0166,MED-0162,MED-0158,MED-0145,MED-0148,MED-0017,MED-0053,MED-0030,MED-0011,MED-0025,MED-0008` |
| Frecuencia sugerida | cada 2–3h (ya es la cadencia real del cron sombra existente) |
| `max_notas` (por medio, por chunk) | 15 |
| `enrich_limit` (por chunk) | 30 |
| `chunk_size` | 10 (3 chunks) |
| `window_days` | 30 |
| Riesgo | **Bajo** — medios ya validados, 40/70 son `LISTO_LEYENDO`; el resto (`EN_CRON_TEXTO_MALO`) ya tiene re-enrich aplicado y monitoreo activo. |

Comando manual (dry-run primero):

```powershell
npm run news-lake:capture -- --dry-run --medio-ids="MED-0151,MED-0153,MED-0001,MED-0020,MED-0160,MED-0031,MED-0167,MED-0154,MED-0165,MED-0157,MED-0060,MED-0161,MED-0152,MED-0159,MED-0163,MED-0156,MED-0155,MED-0034,MED-0166,MED-0162,MED-0158,MED-0145,MED-0148,MED-0017,MED-0053,MED-0030,MED-0011,MED-0025,MED-0008" --max-notas=15 --enrich-limit=30 --chunk-size=10 --window-days=30
```

```powershell
npm run news-lake:capture -- --dry-run=false --medio-ids="MED-0151,MED-0153,MED-0001,MED-0020,MED-0160,MED-0031,MED-0167,MED-0154,MED-0165,MED-0157,MED-0060,MED-0161,MED-0152,MED-0159,MED-0163,MED-0156,MED-0155,MED-0034,MED-0166,MED-0162,MED-0158,MED-0145,MED-0148,MED-0017,MED-0053,MED-0030,MED-0011,MED-0025,MED-0008" --max-notas=15 --enrich-limit=30 --chunk-size=10 --window-days=30
```

O vía GitHub Actions (recomendado, evita el timeout local de Supabase):

```powershell
gh workflow run news-lake-tier1.yml --ref claude/ethos-pr-intelligence-design-q9GzX -f dry_run=true
```

### Tier 2 — Regionales importantes + crisis (41 medios)

= `SHADOW_MEDIOS_CRISIS` (4: UNO MAS UNO, El Sol de Irapuato, El Otro Enfoque,
Periódico Correo) ∪ `SHADOW_MEDIOS_DAILY_VALIDATED` (37 activos: lado.mx,
Telediario Monterrey, Zeta Tijuana, Excélsior, Frontera, Noroeste, AM León,
CRT, SDP, ADN40, TV Azteca, MVS, Diario de Yucatán, Contralínea, Político MX,
AF Medios, PorEsto, ZonaDocs, Pie de Página, Chiapas Paralelo, Quadratín
Nacional, Tabasco Hoy*, El Imparcial Oaxaca, 8 Columnas, DesInformémonos,
Conciencia Pública, A Fondo Jalisco, Siker, etc.).

_\*Tabasco Hoy está clasificado `NECESITA_REPARAR_FUENTE` (0% texto pese a
estar en cron) — queda en Tier 2 porque ya está en `shadowMedia.ts`, pero se
marca como candidato prioritario de reparación, no de vetting nuevo._

| Parámetro | Valor |
|---|---|
| `medio_ids` | `MED-0170,MED-0169,MED-0171,MED-0164,MED-0005,MED-0012,MED-0028,MED-0006,MED-0049,MED-0055,MED-0083,MED-0189,MED-0084,MED-0192,MED-0193,MED-0194,MED-0066,MED-0195,MED-0199,MED-0197,MED-0172,MED-0196,MED-0175,MED-0198,MED-0173,MED-0179,MED-0174,MED-0176,MED-0177,MED-0184,MED-0180,MED-0181,MED-0183,MED-0182,MED-0178,MED-0186,MED-0202,MED-0187,MED-0203,MED-0201,MED-0185` |
| Frecuencia sugerida | cada 6h (ya es la cadencia real del cron sombra existente) |
| `max_notas` | 10 |
| `enrich_limit` | 20 |
| `chunk_size` | 10 (5 chunks) |
| `window_days` | 30 |
| Riesgo | **Bajo-medio** — la mayoría ya validada; Tabasco Hoy necesita reparación de extractor (ver F). |

Comandos manuales (mismo patrón que Tier 1, cambiando la lista):

```powershell
npm run news-lake:capture -- --dry-run --medio-ids="MED-0170,MED-0169,MED-0171,MED-0164,MED-0005,MED-0012,MED-0028,MED-0006,MED-0049,MED-0055,MED-0083,MED-0189,MED-0084,MED-0192,MED-0193,MED-0194,MED-0066,MED-0195,MED-0199,MED-0197,MED-0172,MED-0196,MED-0175,MED-0198,MED-0173,MED-0179,MED-0174,MED-0176,MED-0177,MED-0184,MED-0180,MED-0181,MED-0183,MED-0182,MED-0178,MED-0186,MED-0202,MED-0187,MED-0203,MED-0201,MED-0185" --max-notas=10 --enrich-limit=20 --chunk-size=10 --window-days=30
```

```powershell
gh workflow run news-lake-tier2.yml --ref claude/ethos-pr-intelligence-design-q9GzX -f dry_run=true
```

### Tier 3 — Locales / baja frecuencia / candidatos en vetting

A diferencia de Tier 1/2, Tier 3 **no tiene una lista fija hoy**: es el
pipeline de incorporación gradual de los 72 candidatos `CATALOGO_NO_CRON`
viables (no bloqueados, no paywall) que hoy nunca han sido probados en
producción, más los medios que el programador paralelo vaya reparando desde
la lista `E`.

| Parámetro | Valor |
|---|---|
| `medio_ids` | **Sin default amplio** — se pega el lote de la oleada actual (ver §H) |
| Frecuencia sugerida | diario o cada 12h (más conservador hasta confirmar calidad) |
| `max_notas` | 5 |
| `enrich_limit` | 10 |
| `chunk_size` | 5 |
| `window_days` | 30 |
| Riesgo | **Medio-alto** — no vetted; por eso `max_notas`/`enrich_limit` bajos y `chunk_size` pequeño (falla contenida por chunk, igual que el resto del orquestador). |

**Regla de promoción:** un medio de Tier 3 solo se agrega a `shadowMedia.ts`
(pasa a ser parte de Tier 1 o Tier 2 "oficial") después de:
1. Al menos una corrida real (`--dry-run=false`) sin errores de crawl.
2. Verificar `texto_ok_pct` ≥ 50% en las notas capturadas (revisar en
   Supabase o con `npm run audit-all-media-clean-capture-readiness`).
3. Si aplica a algún cliente activo, un `detect-mentions --dry-run` limpio
   (sin flood, sin FP evidente).

Comando de vetting (dry-run obligatorio primero, lote pequeño):

```powershell
npm run news-lake:capture -- --dry-run --medio-ids="MED-0188,MED-0120,MED-0009,MED-0010,MED-0023,MED-0024,MED-0018,MED-0007" --max-notas=5 --enrich-limit=10 --chunk-size=5 --window-days=30
```

```powershell
gh workflow run news-lake-tier3.yml --ref claude/ethos-pr-intelligence-design-q9GzX -f dry_run=true -f medio_ids="MED-0188,MED-0120,MED-0009,MED-0010,MED-0023,MED-0024,MED-0018,MED-0007"
```

---

## F) Repair backlog (para el programador paralelo) — no forma parte de Tier 1/2/3

51 medios están `E` (error/bloqueado). Esta lista **no se toca en esta fase**;
es exactamente donde debe enfocarse el trabajo paralelo de reparación. Una
vez reparado un medio, mueve a `C_CANDIDATO` y entra al pipeline de vetting de
Tier 3 (§E/§H), **no** directo a Tier 1/2.

Los chunks con mayor concentración de `E` (mejor ROI de reparación primero):
Chunk 11 (8/10), Chunk 7 (7/10), Chunk 9 (6/10), Chunk 5 (5/10).

La lista completa de 51 `medio_id` con su `ultimo_error` está en
`data/all-media-clean-capture-readiness.json` (campo `bloqueado`/
`ultimo_error`), generado por `npm run audit-all-media-clean-capture-readiness -- --json`
(no commiteado — hay que regenerarlo si se necesita, es de solo lectura).

---

## G) Workflows creados (solo `workflow_dispatch`, sin schedule)

| Workflow | Tier | Default `medio_ids` | Uso |
|---|---|---|---|
| `.github/workflows/news-lake-tier1.yml` | 1 | 29 medios nacionales (fijo, override opcional) | Producción nacional recurrente |
| `.github/workflows/news-lake-tier2.yml` | 2 | 41 medios regionales/crisis (fijo, override opcional) | Producción regional recurrente |
| `.github/workflows/news-lake-tier3.yml` | 3 | **Requerido** (sin default) | Vetting incremental de candidatos |

Los tres son clones del patrón ya probado en `news-lake-capture.yml`: mismos
secrets (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`), mismo `NODE_OPTIONS`
(`--dns-result-order=ipv4first --import=.../preload-ws.mjs`), mismas variables
de seguridad (`NO_SEND`, `NO_EMAIL`, `NO_WHATSAPP`, `NO_TWILIO`), mismo
`concurrency` (uno por tier, para no pisarse entre corridas del mismo tier).
Se usó paso de inputs por variables de entorno + arrays de Bash (`ARGS+=(...)`)
en vez de interpolación directa en el `run:`, siguiendo la lección aprendida
en `client-live-sheet-export.yml` (bug de quoting con espacios) — aquí no hay
inputs con espacios, pero se aplicó el mismo patrón defensivo por consistencia
y para evitar la clase de bug completa.

**Ninguno de los tres tiene `schedule:`.** Activar un cron real requiere
autorización explícita y, en ese momento, agregar un bloque `schedule:` +
decidir la frecuencia final (recomendación: Tier 1 cada 3h, Tier 2 cada 6h,
Tier 3 diario, una vez que el vetting inicial esté maduro).

`news-lake-capture.yml` (el orquestador genérico ya existente) **no se
modificó** — sigue sirviendo para corridas ad-hoc fuera de los tiers (p.ej.
`--medio-ids` puntual o `--max-medios` general).

---

## H) Oleadas Tier 3 recomendadas (siguiente paso, no ejecutado)

Basado en el cruce de chunks (§D), las oleadas con mejor ROI (más candidatos
nunca probados, menos rotos) son:

**Oleada 1 — Chunk 2** (8 candidatos, 2 rotos):
`MED-0188` CNIT, `MED-0120` Jalisco Rojo, `MED-0009` Alcance Diario,
`MED-0010` Puente Libre, `MED-0023` Tiempo, `MED-0024` Revista 360 Grados,
`MED-0018` Reporte18, `MED-0007` Fortuna y Poder.

**Oleada 2 — Chunk 8** (8 candidatos, 2 rotos):
`MED-0114` Radio Universidad de Guadalajara, `MED-0113` Jalisco TV,
`MED-0092` Radar BC, `MED-0106` El Informante BCS, `MED-0118` El Respetable,
`MED-0094` Monitor Económico BC, `MED-0116` Tráfico ZMG, `MED-0093`
Periodismo Negro.

**Oleada 3 — Chunk 10** (8 candidatos, 2 rotos):
`MED-0111` MetrópoliMx BCS, `MED-0119` Conciencia Pública*, `MED-0191` La
Silla Rota (ya tiene extractor DIRECT — verificar), `MED-0142` Tequila
Digital, `MED-0130` Letra Fría, `MED-0136` Kiosco Informativo, `MED-0138` TV4
Lagos/Altos, `MED-0096` Síntesis TV.

_\*`MED-0119` "Conciencia Pública" es distinto de `MED-0201` "Semanario
Conciencia Pública" (ya en Tier 2) — verificar si son el mismo medio antes de
vetear, para no duplicar cobertura._

**No se ejecutó ninguna de estas oleadas en esta fase** — quedan listas para
correr con `--dry-run` primero cuando se autorice.

---

## I) Cómo exportar por cliente (ya implementado, sin cambios en esta fase)

Usa `scripts/client-live-sheet-export.ts` (`npm run client-live:sheet`),
documentado en `docs/CLIENT_LIVE_SHEET_SHADOW.md`. Resumen para agregar un
cliente nuevo:

1. Confirmar que el cliente tiene `client_id` y keywords activas en Supabase
   (tabla `clientes`/`keywords`), **o** usar modo ad-hoc (`--query`/`--exact`/
   `--contains`) si todavía no es cliente formal.
2. Elegir un `sheet_id` de Google Sheets (nuevo o existente) y un
   `tab_prefix` único (convención: `ETHOS_<CLIENTE>_LIVE`).
3. Dry-run primero (obligatorio):

   ```powershell
   npm run client-live:sheet -- --dry-run --client-id=CLI-XXXX --client-name="Nombre Cliente" --sheet-id=<SHEET_ID> --tab-prefix=ETHOS_XXXX_LIVE --window-days=30 --limit=100 --max-rows=100
   ```

4. Revisar el preview (`keywords`, `noticias_encontradas`,
   `menciones_detectadas`, `revision_humana`) — si `noticias_encontradas` es
   sospechosamente alto (cientos) o bajo (0), revisar keywords antes de
   escribir real.
5. Escritura real solo con autorización explícita:

   ```powershell
   npm run client-live:sheet -- --dry-run=false --client-id=CLI-XXXX --client-name="Nombre Cliente" --sheet-id=<SHEET_ID> --tab-prefix=ETHOS_XXXX_LIVE --window-days=30 --limit=100 --max-rows=100
   ```

6. Confirmar en el log: `filas_omitidas_dedupe` en corridas repetidas y
   `mismatch=false` en el readback — si `mismatch=true`, detener y
   diagnosticar antes de repetir.
7. Append-only siempre: nunca se limpia ni reemplaza contenido existente en
   las tabs `ETHOS_*`. No toca `test_pressclipping`, `NOTAS ENVIADAS
   MERYPOZOS`, ni ninguna hoja de Patrón/Jumex.

### Cómo agregar keywords a un cliente existente

Vía la tabla `keywords` de Supabase (columna `activa=true`, `cliente_id`).
**Regla dura (lección Mery Pozos):** las keywords deben ser nombres/marcas
reales del cliente, no temas/contexto (ej. no agregar "SIAPA", "agua",
"IEPC" como keywords — esas son señales de contexto en las notas, no
identificadores del cliente). El gap de cobertura se cierra con **fuentes**
(Tier 3, §H), no con keywords temáticas amplias que generan falsos positivos.

---

## J) Cómo validar que no se perdió información

1. **Nunca comparar solo por `noticias_7d`** entre dos snapshots del cron
   activo — la ventana rodante hace que el % de texto limpio fluctúe sin que
   nada haya empeorado (lección ya documentada en
   `docs/ETHOS_NEWS_LAKE_MEDIA_READINESS.md` §3).
2. Usar `npm run audit-all-media-clean-capture-readiness -- --json` como
   snapshot de referencia antes/después de una oleada — comparar
   `noticias_30d` (no `_7d`) por medio para confirmar que no bajó.
3. Usar `npm run news-lake:search -- --medio-ids=<X> --window-days=30` para
   confirmar que las notas de un medio específico siguen accesibles después
   de cualquier cambio.
4. Para clientes ya en `client-live-sheet-export`, correr `--dry-run`
   periódicamente y comparar `noticias_encontradas`/`menciones_detectadas`
   contra la corrida anterior — una caída fuerte sin cambio de keywords es
   señal de un problema de fuente, no de que "ya no hay noticias".

---

## K) Qué NO hacer

- No activar ningún `schedule:` en `news-lake-tier1/2/3.yml` sin
  autorización explícita.
- No borrar ni truncar `noticias`/`menciones` bajo ninguna circunstancia
  (no existe ese flujo hoy — no crearlo).
- No mover un medio de Tier 3 a Tier 1/2 sin pasar la regla de promoción
  (§E).
- No agregar keywords temáticas a clientes existentes para "cerrar gaps" —
  el gap se cierra con fuentes (Tier 3) o cuerpo completo (re-enrich), nunca
  ampliando el criterio de detección.
- No usar proxy, Playwright, ni bypass de paywall para los 3 medios `D`
  (Grupo Reforma) — quedan `D_PAGO_CONVENIO_API` hasta que exista una fuente
  legal/convenio.
- No tocar Patrón final, Jumex final, `NOTAS ENVIADAS MERYPOZOS`,
  `test_pressclipping`, alertas reales, WhatsApp, email o Twilio desde
  ninguno de los flujos de este runbook.
- No hacer commit de `data/` (snapshots de auditoría) ni de `tmp/`.

---

## L) Comandos PowerShell — referencia rápida

```powershell
# Diagnóstico de retención/estado del catálogo completo (read-only, ~3 min)
npm run audit-all-media-clean-capture-readiness -- --json

# Tier 1 — dry-run
npm run news-lake:capture -- --dry-run --medio-ids="MED-0151,MED-0153,MED-0001,MED-0020,MED-0160,MED-0031,MED-0167,MED-0154,MED-0165,MED-0157,MED-0060,MED-0161,MED-0152,MED-0159,MED-0163,MED-0156,MED-0155,MED-0034,MED-0166,MED-0162,MED-0158,MED-0145,MED-0148,MED-0017,MED-0053,MED-0030,MED-0011,MED-0025,MED-0008" --max-notas=15 --enrich-limit=30 --chunk-size=10

# Tier 2 — dry-run
npm run news-lake:capture -- --dry-run --medio-ids="MED-0170,MED-0169,MED-0171,MED-0164,MED-0005,MED-0012,MED-0028,MED-0006,MED-0049,MED-0055,MED-0083,MED-0189,MED-0084,MED-0192,MED-0193,MED-0194,MED-0066,MED-0195,MED-0199,MED-0197,MED-0172,MED-0196,MED-0175,MED-0198,MED-0173,MED-0179,MED-0174,MED-0176,MED-0177,MED-0184,MED-0180,MED-0181,MED-0183,MED-0182,MED-0178,MED-0186,MED-0202,MED-0187,MED-0203,MED-0201,MED-0185" --max-notas=10 --enrich-limit=20 --chunk-size=10

# Tier 3 — Oleada 1 (dry-run)
npm run news-lake:capture -- --dry-run --medio-ids="MED-0188,MED-0120,MED-0009,MED-0010,MED-0023,MED-0024,MED-0018,MED-0007" --max-notas=5 --enrich-limit=10 --chunk-size=5

# Vía GitHub Actions (evita timeout local de Supabase)
gh workflow run news-lake-tier1.yml --ref claude/ethos-pr-intelligence-design-q9GzX -f dry_run=true
gh workflow run news-lake-tier2.yml --ref claude/ethos-pr-intelligence-design-q9GzX -f dry_run=true
gh workflow run news-lake-tier3.yml --ref claude/ethos-pr-intelligence-design-q9GzX -f dry_run=true -f medio_ids="MED-0188,MED-0120,MED-0009,MED-0010,MED-0023,MED-0024,MED-0018,MED-0007"

# Validación de código
npm run typecheck
npm test
```
