# Reporte de Readiness de Sustitución — Ethos vs PressClipping

> Documento honesto de observabilidad. **Ethos NO está listo para sustituir
> PressClipping globalmente.** Hoy es un **shadow diagnóstico** medible. Este
> reporte hace auditable esa afirmación con datos reales de la última corrida.
>
> Generado por: `npm run audit-replacement-readiness` + `npm run audit-extraction-quality`
> + `npm run debug-live-comparison-zero-match`
> (todos SOLO LECTURA, sin envíos, sin IA, sin tocar producción).

---

## 0. Diagnóstico MATCH=0 (actualización)

**Causa raíz: `REAL_COVERAGE_GAP` (121/121). NO es bug del comparador.**

Se creó `scripts/debug-live-comparison-zero-match.ts` (read-only) que reproduce
la carga exacta de `compare-mentions` (misma ventana `noticias.fecha_publicacion`
con `!inner`, `estado_revision != descartada`, PC por `fecha`) y busca candidatos
de match en **5 niveles**: URL exacta → url_norm → título ≥75% en ventana →
título ≥75% fuera de ventana → dominio + título ≥65%.

Ventana auditada `2026-07-05T23:00-06:00 → 2026-07-07T23:00-06:00`:

| métrica | valor |
|---|---|
| total_pc | 121 |
| total_ethos | **8** |
| posibles_matches_por_url_exacta | 0 |
| posibles_matches_por_url_norm | 0 |
| posibles_matches_por_titulo (≥75%, ±3d) | 0 |
| posibles_matches_fuera_de_ventana | 0 |
| dominio+título (≥65%) | 0 |
| **pc_sin_ningún_candidato** | **121** |

**Evidencia de descarte de bugs:**
- `NORMALIZE_URL_BUG`: descartado — 0 URLs exactas iguales y 0 url_norm iguales
  entre PC y Ethos (no hay match oculto por normalización).
- `WINDOW_MISMATCH` / `TIMEZONE_BUG`: descartado — 0 títulos ≥75% fuera de ventana;
  la ventana `!inner` filtra bien (verificado). La única "fecha 2026-07-08" en
  Ethos es artefacto UTC↔MX de display, dentro de ventana real.
- `CLIENT_MAPPING_BUG` / `KEYWORD_MAPPING_BUG`: descartado como causa del 0-match
  (no había candidatos que fallaran por cliente/keyword; simplemente no hay
  artículos comunes).
- `TITLE_SIMILARITY_TOO_STRICT`: descartado — ni siquiera con umbral 0.65 y mismo
  dominio aparece un candidato.

**Por qué Ethos solo tiene 8 menciones (raíz del gap):**
- **Ethos cubrió 3 medios** (Publimetro 5, Uno TV 2, Revista Espejo 1); **PC cubrió
  ~40 medios** (lado.mx, La Crónica, MSN, Milenio, Momento Diario, Marca, El Heraldo,
  Xeu, Talajalisco, NTR Guadalajara, El Sol de México, El Economista…). Casi sin
  solape de medios y **cero solape de artículos**.
- **Extracción vacía (83.8%)**: medios que SÍ están en el cron (La Crónica, El
  Economista, El Heraldo, El Sol de México) tienen 100% cuerpo vacío → la keyword
  no puede dispararse → no generan mención.
- **Keyword amplia vs precisión**: `Tequila` es el 47% de PC (57/121), pero en Ethos
  `tequila` está en el set de precisión endurecida (anti-FP) → bloqueo por diseño.

**Conclusión:** el `MATCH=0` es **brecha real de cobertura + extracción + trade-off
de precisión**, no un defecto del cruce. **No se modificó el comparador** (regla:
no fixes especulativos). Se agregaron tests de regresión (`test/zero-match-diagnosis.test.ts`)
para que ningún cambio futuro "invente" matches y oculte la brecha real.

**Antes/después:** sin fix de código, no hay re-run de comparativo (FASE 7 omitida
por regla). El porcentaje real de gap se recategoriza abajo (§4): el "112 accionable"
previo era cota superior; con el diagnóstico, buena parte es **extracción** (medios
en cron sin cuerpo) y **fuente no cubierta**, no puro descubrimiento.

---

## 0.1 Reparación de extracción en cron críticos (2026-07-08)

Fase ejecutada tras el diagnóstico MATCH=0. Objetivo: recuperar el cuerpo de los
4 medios que ya estaban en cron pero aparecían con ~100% cuerpo vacío en la ventana
del comparativo.

**Hallazgo de causa raíz (revisa la hipótesis previa de "extractor roto"):**
el extractor **no está roto**. Al descargar el HTML público en vivo de muestras de
los 4 medios, el extractor recupera el cuerpo completo por las rutas ya existentes:

| medio | id | fuente | método que funciona | cuerpo recuperado (muestra) |
|---|---|---|---|---|
| El Economista | MED-0001 | RSS | `html_article` (+ JSON-LD disponible) | 2.1k–5.3k chars |
| La Crónica de Hoy | MED-0154 | SITEMAP | `html_article` | 1.3k–4.6k chars |
| El Heraldo de México | MED-0157 | SITEMAP | `html_article` | 1.8k–3.8k chars |
| El Sol de México | MED-0158 | RSS | `oem_storyline` (RSC) | 1.4k–2.5k chars |

La verdadera causa: esas notas fueron **crawleadas desde RSS/sitemap pero nunca
enriquecidas** (`texto_extraido=NULL`, `fuente_extraccion=rss/sitemap`,
`estado_extraccion=ok`). El cuerpo estaba disponible en el HTML estático; solo
faltó correr `enrich-news` sobre ellas. **No se tocó código de extractor** (regla:
no modificar extractores que ya funcionan). Clasificación por medio:
`EXTRACTOR_FIXABLE_STATIC` (los 4) → reparables por re-enrich, sin JS/Playwright/bypass.

**Re-enrich acotado por medio (`--only-missing-clean-text`):**

| medio | leídas | recuperadas | fallidas (404) | cuerpo vacío antes→después | mediana chars antes→después |
|---|---|---|---|---|---|
| El Economista | 420 | 419 | 1 | 42% → **0%** | 1550 → **2969** |
| La Crónica | 368 | 365 | 2 | 37% → **0%** | 1691 → **2331** |
| El Heraldo | 628 | 627 | 1 | 68% → **0%** | 0 → **3180** |
| El Sol de México | 221 | 221 | 0 | 25% → **0%** | 2304 → **2876** |
| **Total** | **1637** | **1632** | **4** | — | — |

> Nota: se usó `--only-missing-clean-text` (no `--force-refresh-clean-text`), porque
> las notas vacías tienen `texto_nota_limpia IS NULL` y force-refresh solo re-limpia
> notas que ya tienen texto.

**Detección (dry-run → gate → real):** todas las notas re-enriquecidas estaban
`menciones_procesado=false`, así que se detectaron sin reset. Todos los medios
pasaron el gate (`potenciales ≤ 50`, `FP ≤ 25%`, sin tequila/turismo como crisis,
sin listings como cuerpo).

| medio | analizadas | potenciales | FP est. | menciones reales | duplicadas |
|---|---|---|---|---|---|
| El Economista | 419 | 29 | ~18% | 29 | 0 |
| La Crónica | 365 | 12 | ~20% | 12 | 0 |
| El Heraldo | 627 | 4 | ~25% | 4 | 0 |
| El Sol de México | 221 | 12 | ~10% | 12 | 0 |
| **Total** | **1632** | **57** | — | **57** | **0** |

Ejemplos reales recuperados: *"Sindicatos agilizan organización por vías digitales"*
(El Economista, `MATCH_REAL` score 1.00), *"Huelga en el Monte de Piedad"* (La Crónica),
*"STPS concluye investigaciones en el marco del MLRR del T-MEC"* (El Sol).

**Impacto en el comparativo (backtest ventana MATCH=0, 2026-07-05→07):**

| métrica | antes (MATCH=0) | después | Δ |
|---|---|---|---|
| menciones_ethos | 8 | **99** | +91 |
| menciones_pressclipping | 121 | 121 | 0 |
| **match** | **0** | **6** | **+6** |
| cobertura_bruta | ~0.00 | 0.05 | +0.05 |
| cobertura_ajustada | ~0.00 | 0.06 | +0.06 |
| clusters_matched | 0 | 2 | +2 |
| filas_05 / readback | — | 218 / 6 | mismatch=false |

Ventana 48h actual (2026-07-06→08): Ethos 71 menciones, match=1
(`MATCH_REAL` El Economista "Inspección de jornada laboral…", score 1.00),
sheets_write_mismatch=false.

**Medios reparados:** los 4 (`EXTRACCION_REPARADA`). **Medios no reparables:** ninguno
en este lote (las ~4 fallas son URLs viejas con HTTP 404, no bloqueo estructural).

**Siguiente brecha (post-reparación):** el gap remanente contra PC ya **no es de estos
4 medios**, sino (a) `FUENTE_NO_CUBIERTA` (lado.mx, Momento Diario, Marca, etc. — medios
regionales fuera del cron), (b) `Tequila` como keyword amplia que PC cuenta y Ethos
filtra por precisión (trade-off por diseño), y (c) sindicación de bajo valor en PC
(`Se acabó el Mundial…`/Jumex replicado) que son PC_FALSE_POSITIVE.

### Top gaps accionables (post-diagnóstico)

| # | medio | en cron | keyword/cliente | causa | acción exacta |
|---|---|---|---|---|---|
| 1 | La Crónica de Hoy | **sí** (MED-0154) | Tequila/Reforma (CLI-0002/3) | EXTRACCION_FALLIDA (100% cuerpo vacío) | reparar extractor de cuerpo del medio |
| 2 | El Economista | **sí** (MED-0001) | Bebidas/Empresas | EXTRACCION_FALLIDA (100% vacío) | reparar extractor de cuerpo |
| 3 | El Heraldo de México | **sí** (MED-0157) | Bebidas/Jumex | EXTRACCION_FALLIDA (100% vacío) | reparar extractor de cuerpo |
| 4 | El Sol de México | **sí** (MED-0158) | Bebidas | EXTRACCION_FALLIDA (100% vacío) | reparar extractor de cuerpo |
| 5 | Uno TV | **sí** (MED-0025) | intoxicación/bebidas | DISCOVERY_GAP (extrae bien, otro artículo) | ampliar descubrimiento/ventana del medio |
| 6 | lado.mx | no | Tequila (CLI-0002) | FUENTE_NO_CUBIERTA (5 notas) | evaluar alta de fuente |
| 7 | Momento Diario | no | Tequila | FUENTE_NO_CUBIERTA (3) | evaluar alta de fuente |
| 8 | Marca México | no | Tequila | FUENTE_NO_CUBIERTA (3) | evaluar alta de fuente |
| 9 | Talajalisco | no | Tequila | FUENTE_NO_CUBIERTA (2) | evaluar alta de fuente |
| 10 | NTR Guadalajara | no | mezcal/tequila | FUENTE_NO_CUBIERTA (2) | evaluar alta de fuente |
| 11 | Telediario | no | Bebidas | FUENTE_NO_CUBIERTA (2) | evaluar alta de fuente |
| 12 | Xeu | no | Bebidas | FUENTE_NO_CUBIERTA (2) | evaluar alta de fuente |
| 13 | Hoy Tamaulipas | no | Reforma laboral | FUENTE_NO_CUBIERTA (2) | evaluar alta de fuente |
| 14 | AM | no | Bebidas/GTO | FUENTE_NO_CUBIERTA (2) | evaluar alta de fuente |
| 15 | Tráfico ZMG | no | Bebidas | FUENTE_NO_CUBIERTA (2) | evaluar alta de fuente |
| 16 | MSN México | no | Bebidas | SINDICADA (agregador, bajo valor) | descartar / no accionable |
| 17 | Promodescuentos | no | IEPS/Refrescos | SINDICADA / no editorial | descartar |
| 18 | (keyword) Tequila×57 | — | CLI-0002 | PRECISION_TRADEOFF | afinar regla `tequila` (contexto crisis) sin abrir FP |
| 19 | (keyword) Reforma laboral×21 | — | CLI-0003 | KEYWORD/COBERTURA | verificar keywords activas + fuentes laborales |
| 20 | (keyword) Jumex×16 | — | CLI-0001 | COBERTURA/EXTRACCION | auditar fuentes Jumex + extracción |

---

## 0.2 Afinación Tequila CLI-0002 (2026-07-08)

Objetivo: recuperar cobertura útil de PressClipping asociada a `tequila` (≈47% del
volumen PC del cliente) **sin** abrir falsos positivos turísticos, culturales, de
entretenimiento o de bajo valor.

**Auditoría del gap (universo PC `keyword ~ tequila`, ~2 semanas, 277 registros):**

| categoría | cant | % | destino en la política |
|---|---|---|---|
| SALUD_ADULTERACION_METANOL | 73 | 26% | Nivel A — permitir (crisis) |
| REVISAR_HUMANO (columnas/primeras planas) | 90 | 32% | ruido / no accionable |
| EVENTO_ENTRETENIMIENTO | 35 | 13% | Nivel C — bloquear |
| COMERCIO_TEQUILA_REAL | 15 | 5% | Nivel B — permitir (industria) |
| PC_FALSE_POSITIVE | 15 | 5% | bloquear |
| HOMONIMO_RUIDO (municipio Tequila) | 13 | 5% | Nivel C — bloquear |
| GASTRONOMIA_PROMOCION | 11 | 4% | Nivel C — bloquear |
| TURISMO / CULTURA / DECOMISO / REPUT / CRISIS | ~25 | ~10% | mixto (A/C) |

Conclusión: el gap accionable real de tequila es la **crisis de salud/adulteración**
(≈26–36%), no el turismo/entretenimiento (≈30–35%, ruido por diseño). La config
previa de `KEY-0003 tequila` era **rígida al revés**: exigía contexto industrial
(`Jalisco`, `tequilero`, `industria tequilera`) y por eso **perdía** la crisis de
salud fuera de Jalisco (Guanajuato/Centenario), a la vez que dejaba pasar ruido.

**Política contextual de 3 niveles** (código puro, `src/matching/contextualKeywordRules.ts`):

- **Nivel A (crisis/salud → permite, posible P1 vía keywords de alerta dedicadas):**
  `adulterado, falsificado, contaminado, metanol, intoxicación, muerte/fallece,
  hospitalizado, alerta/riesgo sanitario, COFEPRIS, decomiso, cateo, vinatería,
  clandestino, ilícito` cerca de un término de tequila (ventana ±250, el título
  ancla el tema para alta recall).
- **Nivel B (industria/comercio/regulación → permite, P2):** `exportación,
  aranceles, T-MEC, CRT, Consejo Regulador del Tequila, industria tequilera,
  denominación de origen, IEPS, NOM-006/070, COMERCAM, agave azul` en proximidad
  **estrecha** (±120) con tequila. Se descartan exportaciones/producción genéricas.
- **Nivel C (bloquea):** pueblo mágico, turismo, festival, concierto, evento,
  gastronomía, receta, coctel, promoción, ranking, cultura, deporte, mundial,
  bar/cantina, homónimo del municipio (robo/detenido/homicidio). Además, un
  **override de título**: si el titular está dominado por evento/turismo/fonatur
  y no hay crisis, se bloquea aunque el cuerpo tenga industria suelta.

La keyword amplia `tequila` (CLI-0002) pasa a regirse **exclusivamente** por esta
puerta de código (se omiten sus `contexto_incluir/excluir` rígidos de la BD). El
resto de keywords/clientes no cambia. Cobertura de tests: `test/tequila-context-rules.test.ts`
(bloqueo, crisis, industria, homónimo, override de título, no-regresión).

**Dry-run acotado (read-only, antes → después):**

| ventana | analizadas | potenciales antes | potenciales después | crisis (A) | industria (B) | bloqueadas bajo valor | insuficiente | FP est. |
|---|---|---|---|---|---|---|---|---|
| backtest 07-05→07 | 7 | 1 | 1 | 1 | 0 | 5 | 1 | ~0% |
| 48h 07-06→08 | 5 | 1 | 1 | 1 | 0 | 3 | 1 | ~0% |

- Permitidas: *"Caen ventas de tequila Centenario tras intoxicaciones en Guanajuato"* (crisis A).
- Bloqueadas correctamente: *"Exportaciones de México… récord"* (genérica), *"Paisaje
  Agavero Patrimonio Mundial"* (cultura), *"Fiesta de la Cerveza"* y *"Fonatur en
  Michoacán"* (evento/turismo), *"Muere Lauren Bennett…"* (homónimo/entretenimiento).

**Gate:** PASA (FP ≤ 15%, crisis no bloqueada, turismo/entretenimiento bloqueado,
sin boilerplate, sin flood, potenciales ≤ 80).

**Detect real (condicionado al gate):** se recuperaron **2 menciones reales de
industria/comercio** (Nivel B), insertadas con reset reversible acotado a 2 notas:

| noticia | medio | keyword | nivel | requiere_alerta |
|---|---|---|---|---|
| Tequila y salsas, los productos más exportados de México al Reino Unido (184 mdd) | El Sol de México | tequila | B | no (P2) |
| Exportaciones de alimentos al Reino Unido récord 184 mdp | La Crónica de Hoy | tequila | B | no (P2) |

0 duplicadas, 0 FP. La nota de **crisis** *"Caen ventas de tequila Centenario…"*
(Periódico Correo, MED-0164) quedó recuperable pero **pendiente**: su medio tiene
209 notas crawleadas sin enriquecer y enriquecerlas sería masivo (fuera de esta
fase); hoy aparece como `ETHOS_PRECISION_TRADEOFF`. Se recuperará cuando MED-0164
se enriquezca en una fase autorizada.

**Impacto en el comparativo (backtest 07-05→07):**

| métrica | antes (extracción reparada) | después (tequila tuning) | Δ |
|---|---|---|---|
| menciones_ethos | 99 | **101** | +2 |
| menciones_pressclipping | 121 | 121 | 0 |
| match | 6 | **8** | +2 |
| cobertura_bruta | 0.05 | **0.07** | +0.02 |
| cobertura_ajustada | 0.06 | **0.08** | +0.02 |
| clusters_matched | 2 | **4** | +2 |
| sheets_write_mismatch | false | false | — |

Ventana 48h (07-06→08): sin cambio de match (1) porque las 2 exportaciones son del
07-05 (fuera de ventana); `sheets_write_mismatch=false`.

**Qué se permitió / qué se bloqueó / riesgo remanente:**
- Permitido: crisis de salud de la bebida (recall) + industria/comercio tequila-céntrico.
- Bloqueado: turismo/pueblo mágico, festivales/eventos, gastronomía/promoción,
  cultura, homónimo del municipio, exportaciones genéricas.
- Riesgo remanente: la crisis Centenario en medios no-cron sin enriquecer sigue como
  gap; y el override de título es heurístico (podría bloquear un titular de evento que
  realmente sea crisis si la crisis no está en el título — mitigado porque Nivel A se
  evalúa primero).

---

## 0.3 Re-enrich MED-0164 Periódico Correo / Tequila Crisis (2026-07-08)

Cierre parcial del gap remanente de la fase 0.2: la crisis "Caen ventas de tequila
Centenario tras intoxicaciones en Guanajuato" era recuperable pero estaba en un medio
(**MED-0164 Periódico Correo**, regional, no-cron) con ~216 notas crawleadas sin enriquecer.

### Diagnóstico

| Dato | Valor |
|---|---|
| Medio | MED-0164 Periódico Correo (Regional) |
| Fuente | SITEMAP (`googlenews.xml`), `requiere_javascript=false` |
| En cron | No (crisis ni daily) |
| Notas (7d / 30d / total) | 592 / 1003 / ~1003 |
| Cuerpo vacío antes | 216 / 1000 = **22%** |
| Menciones antes | 28 (CLI-0002=15, tequila=0) |

**Causa raíz: `CRAWLED_BUT_NOT_ENRICHED`.** El HTML público sí contiene el cuerpo; el
extractor `html_article` lo recupera con calidad **alta** (probado en vivo sobre las notas
de crisis, sin Playwright/proxy/paywall: cuerpo 1982–3222 chars). No se tocó el extractor.

### Re-enrich acotado (solo MED-0164, `--limit=250 --only-missing-clean-text`)

| Métrica | Antes | Después |
|---|---|---|
| Leídas / actualizadas / fallidas | — | 216 / 216 / 0 |
| Cuerpo vacío | 22% | **0%** |
| pct ≥600 chars | 76% | **96%** |
| pct ≥1200 chars | 72% | **91%** |
| mediana chars (con texto) | 2479 | 2444 |
| promedio chars | 2751 | 2758 |

Clasificación: **EXTRACCION_REPARADA**.

### Detect (dry-run → real, gate PASA)

Dry-run acotado a MED-0164 `--only-with-text`: 216 analizadas, **9 potenciales**, 0 sin texto,
0 turismo/evento/bajo valor colado, sin flood (≤2/keyword), FP estimado **~0%**. Gate ✅
(FP≤15%, crisis Centenario/Guanajuato no bloqueada, turismo bloqueado, sin boilerplate,
potenciales≤80). Detect real: **9 menciones insertadas, 0 duplicadas**.

Menciones nuevas (MED-0164: 28→**37**, CLI-0002: 15→**23**, tequila: 0→**2**):
- "Caen ventas de tequila Centenario…": tequila (P2, score 1) + bebidas adulteradas (P1) + COFEPRIS.
- "Muertes por alcohol adulterado…": alcohol adulterado (P1, título score 1) + tequila adulterado (P1) + intoxicación por alcohol (P1) + bebidas adulteradas (P1) + tequila (P2).

### Impacto en comparativo

| Ventana | Métrica | Antes | Después | Δ |
|---|---|---|---|---|
| 48h (07-06→08) | menciones_ethos | 71 | **80** | +9 |
| 48h | match | 1 | **4** | +3 |
| 48h | cobertura_ajustada | 0.01 | **0.04** | +0.03 |
| 48h | clusters_matched | 1 | **2** | +1 |
| Backtest (07-05→07) | menciones_ethos | 101 | **112** | +11 |
| Backtest | match | 8 | 8 | 0 |
| Backtest | cobertura_ajustada | 0.08 | 0.08 | 0 |

`sheets_write_mismatch=false` en ambas. La crisis **"Caen ventas de tequila Centenario…"
ahora es `MATCH_REAL`** en la ventana 48h (matcheada contra las réplicas de PressClipping).
En backtest sube el volumen de Ethos (+11) pero el match no cambia porque la nota Centenario
cae en la ventana 48h y "Muertes por alcohol adulterado" queda como `SOLO_ETHOS_BORDERLINE`
(PressClipping no la trae en esa ventana / borde de cluster).

### Qué parte del gap Tequila queda cerrada

- ✅ Crisis tequila Centenario / intoxicaciones Guanajuato: **cubierta y matcheada** (48h).
- ✅ Crisis alcohol/bebidas adulteradas Salamanca/Irapuato: **cubierta** (P1 shadow), aún
  `SOLO_ETHOS` porque falta el equivalente PressClipping en ventana.
- ⚠️ Sigue abierto: la misma crisis publicada por medios **no-cron sin enriquecer**
  (`ETHOS_KEYWORD_GAP` / `ETHOS_SOURCE_WINDOW_LIMITED` observados en el comparativo:
  "Alcohol adulterado en Guanajuato…", "Alcohol adulterado: Guanajuato bajo vigilancia…").

### Siguiente brecha prioritaria

Los clusters `FUENTE_NO_CUBIERTA` / `ETHOS_SOURCE_WINDOW_LIMITED` siguen dominando el
`solo_pressclipping` (≈42 clusters accionables). Cerrar el top de esas fuentes tiene mayor
retorno que seguir re-enriqueciendo medios ya presentes.

---

## 0.4 Cierre FUENTE_NO_CUBIERTA / Window Limited (2026-07-08)

Auditoría del top de `SOLO_PRESSCLIPPING` accionable para decidir qué fuentes reparar,
enriquecer, agregar a cron o descartar. **Hallazgo central: el "gap accionable" está
inflado por el default conservador del clasificador.** Al leer los títulos reales, la
mayoría del gap `Tequila` (53 filas, la keyword dominante) es contenido que la puerta
contextual **bloquea a propósito**: turismo (Tequila pueblo/Guachimontones), deporte
("futbol tequila", México-Inglaterra), homónimo del municipio (notas de crimen en Tequila,
Jal.) y promos (Soriana/Julio Regalado para Jumex). No es cobertura ausente: es
precision-tradeoff correcto.

### Totales (05 actual, backtest 07-05→07)

| Métrica | Valor |
|---|---|
| solo_pressclipping | 117 |
| accionable (clasificador) | 108 |
| sindicado/bajo valor | 9 |
| PC falso positivo | 0 |
| keyword dominante | Tequila (53) → mayormente turismo/deporte/homónimo |

### Ranking top fuentes (gap accionable) y estado real

| Medio | medio_id | en cron | notasDB | texto_ok | naturaleza del gap | decisión |
|---|---|---|---|---|---|---|
| lado.mx | MED-0005 | no | 101 | 100% | 0 vacías, 0 señal crisis; exports/turismo | NO_TOCAR |
| La Crónica de Hoy | MED-0154 | **sí** | 1487 | 99% | promos Soriana/cultura (Jumex) | NO_TOCAR |
| Momento Diario | (no en DB) | — | — | — | vago/deporte | DESCARTAR_BAJO_VALOR |
| Milenio | MED-0030 | no | 230 | 100% | ya procesado (7 menciones); crimen/FIFA | NO_TOCAR |
| Marca México | (no en DB) | — | — | — | deporte/promo | DESCARTAR_BAJO_VALOR |
| El Heraldo de México | MED-0157 | **sí** | 2663 | 99% | promos/Uber | NO_TOCAR |
| Xeu | (no en DB) | — | — | — | perfume/pensiones | DESCARTAR_BAJO_VALOR |
| Talajalisco | (no en DB) | — | — | — | crimen (homónimo Tequila) | DESCARTAR_BLOQUEADO |
| Telediario | (no en DB) | — | — | — | crimen/promo | DESCARTAR_BAJO_VALOR |
| NTR Guadalajara | MED-0038 | no | 9 | 89% | footprint mínimo; turismo | DESCARTAR_BAJO_VALOR |
| Tráfico ZMG | MED-0116 | no | 75 | 96% | 3 vacías sin señal; nota CRT no crawleada | AUDITAR_MANUAL |
| AM | (no en DB) | — | — | — | **"Alcohol adulterado en Guanajuato" (crisis real)** | AUDITAR_MANUAL (alta futura) |
| Hoy Tamaulipas | (no en DB) | — | — | — | **laboral CLI-0003 real** | AUDITAR_MANUAL (alta futura) |
| Uno TV | MED-0025 | **sí** | 1443 | 100% | festival taco; "Política contra alcohol" (B) | NO_TOCAR |
| Municipios | (no en DB) | — | — | — | exports (B) + deporte | AUDITAR_MANUAL |

### Decisiones

- **MED-0164 Periódico Correo → `AGREGAR_A_CRON_CRISIS_SHADOW`** (única alta de esta fase).
  Gate ✅ (EXTRACCION_REPARADA, FP ~0%, Centenario MATCH_REAL, 9 menciones, no requiere JS).
  Ya estaba en el cron base *daily*; el alta lo sube al **tier crisis (6h, sitemap)** para
  capturar la crisis regional de GTO antes de que rote el sitemap. Cambio **config-only**
  en `src/config/shadowMedia.ts` (`SHADOW_MEDIOS_CRISIS`), **shadow-only, sin envíos, sin
  tocar workflows `.yml`** (el workflow crisis ya lee la config vía `run-shadow-crisis-tier.ts`).
- **Medios ya en cron** (La Crónica, El Heraldo, Uno TV): `NO_TOCAR`. Su gap es
  precision-tradeoff (promos/cultura), no cobertura ausente.
- **Medios in-DB no-cron** (lado.mx, Milenio, NTR): `NO_TOCAR`. **0 brecha de extracción**
  (texto_ok 89–100%, ~0 vacías, o ya procesados). El gap son artículos no crawleados y/o
  contenido bloqueado por política; re-enrich no aplica.
- **Fuera de catálogo bajo valor** (Momento Diario, Marca México, Xeu, Telediario,
  Talajalisco): `DESCARTAR` (deporte/turismo/homónimo/promo).
- **Fuera de catálogo con señal real** (AM, Hoy Tamaulipas, Municipios) y Tráfico ZMG:
  `AUDITAR_MANUAL` — alta futura de fuente, fuera del alcance de esta fase (no altas masivas).

### Reparación / re-enrich / detect

- **FASE 6 re-enrich: N/A.** Ningún candidato in-DB del top gap tiene cuerpo vacío con señal
  (lado.mx 0 vacías, Milenio 0, Tráfico ZMG 3 sin señal crisis, NTR 1). No se justifica.
- **FASE 7/8 detect: N/A** (no hay medios re-enriquecidos nuevos). No se ejecutó detect real.

### Impacto en comparativo

Sin menciones nuevas esta fase (el alta es config, efectiva en la próxima corrida crisis
programada). 48h actual: Ethos 80, PC 121, **match 4**, cobertura_ajustada **0.04**,
`sheets_write_mismatch=false`. El impacto de MED-0164 (48h match 1→4, Centenario MATCH_REAL)
ya fue medido en §0.3 y se re-validará en la próxima corrida 6h.

### Siguiente brecha

El gap accionable "real" restante es pequeño y disperso en fuentes fuera de catálogo con
señal crisis/laboral genuina (**AM**, **Hoy Tamaulipas**). El siguiente lote de mayor
retorno es un **alta acotada de 1–2 de esas fuentes** (con discovery de RSS/sitemap,
crawl-limit bajo y gate), no seguir tocando medios ya cubiertos.

---

## 0.5 Auditoría CLI-0001 Jumex — puerta contextual (2026-07-08)

Objetivo: separar menciones reales de Jumex del ruido promocional/retail para
decidir si CLI-0001 puede pasar de `NO_LISTO`. Se implementó una puerta contextual
de 3 niveles análoga a la de Tequila (CLI-0002).

### Auditoría (05 CLI-0001/Jumex)

| Dato | Valor |
|---|---|
| filas 05 CLI-0001/Jumex | 21 (todas SOLO_PRESSCLIPPING) |
| match / solo_ethos | 0 / 0 |
| keywords Ethos CLI-0001 | KEY-0001 Jumex, KEY-0002 Museo Jumex, KEY-0009 bebidas azucaradas |
| menciones CLI-0001 en DB | 6 (bebidas azucaradas x4, Museo Jumex x2) |
| razones PC | ETHOS_SOURCE_WINDOW_LIMITED (12), PC_FALSE_POSITIVE (9) |

**Clasificación determinística de las 21 filas:**

| Categoría | Cantidad | % | Ejemplo | Decisión |
|---|---|---|---|---|
| RETAIL_PROMO_LOW_VALUE | 9 | 43% | "Julio Regalado en Soriana: ofertas de Jumex 3x2" | bloquear |
| PC_FALSE_POSITIVE / sindicación | ~7 | 33% | "Se acabó el Mundial ¿qué sigue?", "subsidios a combustibles" | bloquear |
| JUMEX_CORPORATIVO/REPUTACION_REAL | 4 | 19% | "Rechaza Jumex mango tabasqueño y productor lo regala" | permitir |
| JUMEX_COMERCIO/BEBIDAS_AZUCARADAS | 1 | 5% | "Boing llama a producir en México (IEPS)" | permitir/sector |

**≈76% del gap CLI-0001 es promo retail + falso positivo.** Confirma la hipótesis:
CLI-0001 necesitaba puerta contextual propia.

### Política contextual implementada (`contextualKeywordRules.ts`)

Aplica a keywords amplias CLI-0001 (`Jumex`, `bebidas azucaradas`, `jugos`,
`néctares`, `IEPS bebidas azucaradas/jugos/refrescos`). `Museo Jumex` NO se gatea.

- **Nivel A (permitir, posible alerta)** — crisis/regulatorio con marca o categoría:
  COFEPRIS, Profeco, retiro de producto, contaminación, sanción, demanda, huelga,
  accidente, etiquetado frontal/sello/octágono, **IEPS/impuesto cerca de
  jugos/néctares/bebidas azucaradas/Jumex**. Proximidad ≤250, título ancla.
- **Nivel B (permitir, sin urgencia)** — corporativo/sectorial: Grupo Jumex,
  inversión, planta, exportación, ventas, lanzamiento, cámaras empresariales,
  industria de jugos. Proximidad estrecha ≤150.
- **Nivel C (bloquear)** — promo retail/supermercado/gastronomía: Soriana, Julio
  Regalado, Temporada Naranja, Walmart/Chedraui/Bodega Aurrera, folleto/catálogo,
  2x1/3x2/4x3, oferta/descuento/promoción, Buen Fin/Hot Sale, receta/lonchera/cóctel.
  Override de título: si el titular está dominado por promo, bloquea aunque el
  cuerpo tenga términos corporativos sueltos.
- Razones nuevas: `jumex_contexto_crisis`, `jumex_contexto_corporativo`,
  `jumex_contexto_promocion_retail`, `jumex_contexto_insuficiente`.
- **Bypass BD**: para las keywords amplias de CLI-0001, el gate de código es
  autoritativo (no los `contexto_incluir/excluir` de la BD), igual que Tequila.

### Tests

+29 tests nuevos (`test/jumex-context-rules.test.ts`): permite COFEPRIS/Profeco/
retiro/huelga/inversión/exportación/IEPS-con-categoría; bloquea Soriana/Julio
Regalado/3x2/receta/lonchera/genérico sin marca. No regresión: CLI-0002 tequila
(crisis pasa, turismo bloquea) y CLI-0003 laboral intactos. **760 tests passing.**

### Dry-run del gate (read-only, sobre las 21 filas reales de 05)

| Métrica | Valor |
|---|---|
| analizadas | 21 |
| permitidas Nivel A / B | 0 / 0 |
| bloqueadas promo retail | 9 |
| bloqueadas insuficiente | 12 |
| FP estimado (entre permitidas) | 0% |

Gate ✅ (FP ≤15%, promos retail bloqueadas, sin flood, potenciales ≤80). El gate
bloquea el 100% del ruido actual. Los corporativos/regulatorios reales pasan cuando
hay cuerpo (validado en tests); en 05 sólo hay título, por eso quedan "insuficiente".

### Detect real / comparativo

- **Detect real: N/A / no ejecutado.** Ethos tiene **cobertura casi nula de Jumex**
  (1 de 1000 notas recientes toca términos Jumex; 0 pendientes), `detect-mentions`
  no tiene flag por-cliente, y el gate permite 0 del contenido actual → 0 inserciones.
- **Comparativo: N/A** (sin menciones nuevas; sin delta).

### Readiness CLI-0001

**`NECESITA_MAS_COBERTURA`** (antes `NO_LISTO`). El bloqueador real **no es precisión**
—la puerta ya evita la inundación de promos Soriana/Julio Regalado— **sino cobertura**:
el contenido corporativo/regulatorio de Jumex vive en medios que Ethos casi no crawlea.

### Siguiente brecha

Para avanzar CLI-0001 hacia piloto se necesita **cobertura de fuentes con contenido
corporativo/regulatorio de Jumex** (no promo retail): p.ej. medios de negocios/economía
y regulatorios (IEPS/etiquetado, COFEPRIS/Profeco). La puerta contextual ya garantiza
que ese contenido entre limpio y que la promo quede fuera.

---

## 0.6 Cobertura corporativo-regulatoria CLI-0001 Jumex (2026-07-08)

Objetivo: alimentar la puerta contextual Jumex (fase 0.5) con fuentes reales de
negocio/regulación, evitando promo retail. Fase de auditoría + reparación acotada
(sin altas masivas, sin producción).

### Brecha CLI-0001 (05, SOLO_PRESSCLIPPING)

| Dato | Valor |
|---|---|
| total SOLO_PC | 23 |
| accionable real | 4 (**un solo evento**: "Jumex rechaza mango tabasqueño / productor lo regala", sindicado x4) |
| retail/promo low-value | 10 (Soriana/Julio Regalado 3x2) |
| PC false positive / off-topic | 7 ("Se acabó el Mundial", subsidios combustibles) |
| revisar humano | 2 |
| top keywords | Jumex (18), IEPS Refrescos (2), IEPS Bebidas Azucaradas (1) |

El gap accionable es **1 evento local de baja severidad**; no hay volumen corporativo/
regulatorio de Jumex en la brecha.

### Ranking de fuentes candidatas (auditoría técnica, `audit-media-sources`)

| Fuente | medio_id | estado audit | cron | señal CLI-0001 | decisión |
|---|---|---|---|---|---|
| La Jornada | MED-0029 | REPAIRABLE_SITEMAP_HIGH_CONFIDENCE (conf 1.0, gap 9) | no | evento mango (baja sev.) | **reparada, pero 403 en crawl → DESCARTAR_BLOQUEADO** |
| Líderes Mexicanos | MED-0149 | READY_KEEP_CURRENT (conf 1.0) | no | 0 (lujo/lifestyle) | **DESCARTAR_BAJO_VALOR** |
| Reporte Índigo | MED-0054 | BLOCKED (conf 0.1) | no | — | descartar |
| Fortuna y Poder | MED-0007 | DO_NOT_TOUCH (conf 0.5) | no | — | descartar |
| El Economista / Forbes / El Financiero / Expansión / Líder Empresarial | MED-0001/0145/0156/0159/0163 | ya en cron (322–1846 notas/30d) | **sí** | **0 menciones Jumex** | ya cubiertos; sin señal |

### Auditoría técnica / re-enrich

- **La Jornada (MED-0029)**: fuente reparada vía `--update-db` (sitemap validado).
  El crawl dirigido acotado (max 40, sitemap) devolvió **HTTP 403** (bloqueo bot).
  Sin proxy/bypass permitido → **no ingerible**. Es la mejor fuente del gap pero
  queda fuera de alcance.
- **Líderes Mexicanos (MED-0149)**: crawl RSS acotado (10 notas) + enrich 10/10
  (cuerpos 1.4k–10k ch, extracción EXCELENTE). Contenido: relojes/autos/lujo/
  negocios-lifestyle. **0 notas con señal CLI-0001**; 3 hits espurios de "néctar"
  (autos) → **bloqueados por el gate (FP 0%)**.

### Detect dry-run / real / comparativo

- **Dry-run gate (MED-0149)**: 3 potenciales espurios, **permitidas 0**, bloqueadas
  3 (2 promo, 1 insuficiente), **FP 0%**. Gate ✅ pero sin señal que capturar.
- **Detect real: N/A** (0 señal CLI-0001; no se ejecutó para no insertar menciones
  off-scope de un medio fuera de cron).
- **Comparativo: N/A** (sin menciones nuevas).

### Alta shadow

**No se agregó ninguna fuente a cron.** Ningún candidato cumple los criterios
(señal CLI-0001 real + fuente viable): La Jornada 403, Líderes sin señal, resto
bloqueado/DO_NOT_TOUCH. `shadowMedia.ts` sin cambios.

### 08_Cobertura_Medios

Actualizados **solo los 2 medios tocados** (MED-0029, MED-0149) con
`update-media-coverage-jumex-cov`. Readback: 162→162 filas, mismatch=false.

### Readiness CLI-0001

**`NECESITA_MAS_COBERTURA`** (sin cambio). El bloqueador es **estructural**: el
contenido corporativo/regulatorio de Jumex es escaso en el corpus crawlable, su
mejor fuente de gap (La Jornada) está 403-bloqueada, y los medios de negocios ya
en cron (alto volumen) no producen menciones Jumex por falta de cobertura del tema.
La puerta contextual ya garantiza que, cuando aparezca señal real, entre limpia.

### Siguiente brecha

- Evaluar acceso público/alternativo a La Jornada (RSS por sección, sin proxy) o
  esperar a que el tema Jumex/IEPS gane volumen en los medios ya en cron.
- CLI-0001 no depende de precisión (gate resuelto) sino de aparición de eventos
  reales; conviene monitorear vía las corridas shadow existentes en lugar de forzar
  altas de bajo rendimiento.

---

## 0.7 Paridad de Medios PressClipping vs Ethos + Ruta a Producción (2026-07-08)

Auditoría read-only de paridad de medios y activación acotada de la ruta rápida.
Detalle completo en `docs/MEDIA_PARITY_MATRIX.md` y plan en
`docs/PRODUCTION_READINESS_PLAN.md`.

### Paridad (números)

| Métrica | Valor |
|---|---|
| Medios únicos PressClipping | 302 |
| Medios catálogo Ethos | 171 |
| Medios Ethos en cron shadow | 34 |
| Overlap PC ∩ cron | 27 (8.9%) |
| Overlap PC ∩ catálogo (dominio / fuzzy) | 64 (21%) / ~85 (~28%) |
| Solo PC / Solo Ethos | 238 / 100 |

**Clasificación de los 302 PC:** 27 cubiertos en cron · **58 EN_CATALOGO_NO_CRON
(ruta rápida)** · 32 importantes fuera de catálogo · 182 bajo valor (cola larga) · 3 sindicados.

**Interpretación:** PressClipping es más ancho pero **60% es cola larga de 1–3 notas**.
La brecha accionable se concentra en ~58 medios **ya catalogados** que solo faltaba
activar en cron, no en crear fuentes nuevas.

### Lote rápido ejecutado (alta daily shadow)

| medio_id | medio | gap PC | audit | extracción | acción |
|---|---|---|---|---|---|
| MED-0005 | lado.mx | 28 | READY conf 1.0 (RSS) | 102/102 texto (100%) | **ALTA daily shadow** |
| MED-0049 | Telediario Monterrey | 14 | READY conf 1.0 (sitemap idx) | 70/70 texto (100%) | **ALTA daily shadow** |
| MED-0055 | Noroeste | 4 | READY conf 1.0 | 28/48 texto (58%) | candidato (siguiente lote) |
| MED-0033 / MED-0038 | Eje Central / NTR Gdl | 3 / 3 | DIRECT_EXTRACTION_ONLY | — | auditar manual |

Detect dry-run sobre 41 notas nuevas: **1 potencial (CLI-PRUEBA)**, 0 señal de cliente
real, sin flood, sin FP. Gate de flood/boilerplate ✅. **Detect real NO ejecutado**
(el único potencial era CLI-PRUEBA; el alta es cobertura *forward* vía cron, no inserción
inmediata). Comparativo sin cambios (se reflejará tras las corridas de cron).

`shadowMedia.ts`: +2 medios en `SHADOW_MEDIOS_DAILY_VALIDATED` (config-only, shadow,
sin envíos, sin tocar `.yml`). Tests del tier actualizados (760 passing).

### Readiness

- **Cobertura:** Ethos aún < PC en número bruto, pero cierra el gap accionable por lotes
  activando medios ya catalogados. CLI-0002 (Bebidas alcohólicas) es el cliente con mayor
  gap resoluble y precisión ya validada.
- **Siguiente fase permitida:** preparar **Fase 1** (piloto interno CLI-0002 email, credenciales
  apagadas). **No** hay base para sustitución global.
- **Siguiente brecha:** siguiente lote EN_CATALOGO_NO_CRON (Noroeste, Excelsior reparable)
  + evaluar fuentes nuevas de alto valor (La Silla Rota, Jalisco Hoy — CLI-0002).

---

## 0.8 Aceleración Controlada: Piloto Interno CLI-0002 + Lote P1 (2026-07-09)

Fase sin producción y sin envíos. Detalle en `docs/PRODUCTION_READINESS_PLAN.md`
(sección "Progreso — Aceleración Controlada").

### Cron post-`bde7d23`

- ✅ **GATE_DAILY_POST_BDE7D23_LIMPIO CERRADO (2026-07-11).**
  - Run schedule: `29103114449` — headSha=`1623645` (HEAD), 2026-07-10, success.
  - Run dispatch: `29139253475` — headSha=`1623645`, 2026-07-11, success.
  - MED-0005 lado.mx: estado=ok, insertadas=0 (duplicadas del catálogo), errors=0.
  - MED-0049 Telediario: estado=ok, insertadas=29, errors=0.
  - `decisionDetect=SHADOW_OK`. Sin flood, sin FP severo, sin envíos.
  - Gate de medios cerrado. Próxima alta condicionada a re-enrich (Noroeste) o reparación (Excelsior).

### Fase 1 piloto email CLI-0002 (preparada, disabled)

- **Provider email cableado** con `nodemailer` vía `createSmtpTransport`
  (`src/notifications/smtpTransport.ts`): construye transporte real **solo** con todas
  las capas activas; hoy → `null` (`send_alerts_disabled`). Import dinámico (nodemailer
  no se carga salvo autorización).
- **Kill-switches** (`.env.example`) apagados: `SEND_ALERTS`/`ALLOW_REAL_ALERTS`/
  `EMAIL_ALERTS_ENABLED=false`; `ALERTS_INTERNAL_ONLY=true`; `ALLOWED_CLIENTS=CLI-0002`;
  `ALLOWED_SEVERITIES=P1`; `MAX_PER_RUN/DAY=5`.
- **Dry-run digest CLI-0002**: 196 P1 → 2 clusters (Guanajuato 14 + Nacional 6);
  `blocked=4`, `would_send=0`, `enviadas=0`, `envio_real_confirmado=false`.
- Tests nuevos: `test/smtp-transport.test.ts` (8 casos: cada kill-switch → `null`;
  autorizado → transporte; sin fuga de password).

### Lote P1 auditado (read-only)

| medio | id | catálogo | estado | texto_ok | PC | clasificación |
|---|---|---|---|---|---|---|
| Noroeste | MED-0055 | sí | ok | 58% | 6 | P1_REENRICH_PRIMERO |
| Excelsior | MED-0028 | sí | error | 0% | 11 | P1_REPARAR_FUENTE |
| La Silla Rota / Jalisco Hoy / Noticias México 24 / Hoy Tamaulipas | — | no | — | — | 9–11 | P2_AUDITAR_MANUAL (fuente nueva) |

Ninguno `P1_LISTO_CRON` inmediato → sin alta. Recomendación: re-enrich Noroeste y
reparar fuente de Excelsior antes de considerar cron; evaluar altas de catálogo para
las 4 fuentes nuevas de mayor gap.

---

## 1. Estado general

| Dimensión | Valor | Lectura |
|---|---|---|
| Cobertura ajustada (último run) | **0%** | match = 0 en la última corrida |
| SOLO_PRESSCLIPPING | 121 | 92.6% clasificado "gap real accionable" (cota superior) |
| SOLO_ETHOS | 8 | señal propia mínima en la ventana |
| Calidad de extracción (global) | 15.3% ≥600 chars | dominado por universo RSS sin cuerpo |
| Alertas sombra (10) | trazables por columna | P1/P2/BLOQUEADA/DUPLICADA + cluster_id explícitos |
| Envío real | **desactivado** | módulo interno disabled by default |

**Dictamen (actualizado tras diagnóstico MATCH=0 — ver §0):** shadow estable y
medible. El `MATCH=0` **quedó diagnosticado**: NO es bug del comparador, es
**brecha real de cobertura + extracción** (Ethos capturó 8 menciones en 3 medios;
PC 121 en ~40 medios, sin solape de artículos). El bloqueador real para sustituir
es doble: (1) **extracción de cuerpo vacía** en medios que sí están en el cron, y
(2) **fuentes no cubiertas** que PC sí monitorea. La cobertura ajustada (0%) es
real para esta ventana, no un artefacto.

---

## 2. Último run auditado

```
run_id                  = RUN-2026-07-08T05-00-22-581Z
pressclipping_registros = 121
ethos_menciones         = 8
match                   = 0
solo_pressclipping      = 121
solo_ethos              = 8
cobertura_bruta         = 0
cobertura_ajustada      = 0
```

`match = 0` **ya reproducido y diagnosticado** (ver §0): con 8 menciones Ethos en
3 medios vs 121 PC en ~40 medios, y **0 candidatos en los 5 niveles de matching**,
la causa es brecha real (cobertura/extracción), no desalineación del cruce. La
cota máxima teórica de cobertura en esta ventana era 8/121 ≈ 6.6%.

---

## 3. Cobertura vs PressClipping

- **Cobertura bruta:** 0% (todos los SOLO_PRESSCLIPPING penalizan).
- **Cobertura ajustada:** 0% (solo penalizan los gaps accionables).
- Ambas iguales porque `match = 0`.

La cobertura ajustada es la métrica ejecutiva (excluye ruido de PC). Se calcula
`match / (match + solo_pc_accionable)`, excluyendo `CLI-PRUEBA`.

---

## 4. SOLO_PRESSCLIPPING por categoría (clasificación determinística fila por fila)

Clasificador: `src/comparators/soloPressclippingClassifier.ts` (sin IA, reglas
sobre `estado_comparativo`, `medio`, `keyword`, `titulo`, `razon_posible`,
`categoria` previa, `score_similitud`, `diferencia_dias`).

| categoria_gap | cantidad | % | acción |
|---|---|---|---|
| GAP_REAL_ACCIONABLE | 112 | 92.6% | priorizar cobertura (alta/reparación de fuente) |
| SINDICADA_DUPLICADA_LOW_VALUE | 9 | 7.4% | descartar (bajo valor) |
| PC_FALSE_POSITIVE | 0 | 0% | — |

> **Advertencia honesta:** el 92.6% "accionable" es una **cota superior**. El
> clasificador es conservador: si una fila no tiene señal de ruido, la marca
> accionable. Con `match = 0`, buena parte de esas 112 son casi seguro artefactos
> de comparación (window/normalización), no descubrimientos reales. Requieren
> revisión humana antes de tratarlas como brecha de cobertura.

**Top keywords con gap accionable:** Tequila (55), Reforma laboral (20), Jumex
(14), Impuesto Bebidas Alcohólicas (11), Consejo regulador del tequila (3),
Bacardí (3), Tequila Patrón (3).

**Top medios con gap accionable:** lado.mx (5), La Crónica de Hoy (4), Momento
Diario (3), Milenio (3), Marca México (3), El Heraldo de México (2), Xeu (2),
Talajalisco (2), Telediario (2), NTR Guadalajara (2).

---

## 5. SOLO_ETHOS por categoría

- SOLO_ETHOS total (ejecutivo): 7–8 en la ventana.
- Sin falsos positivos evidentes por `categoria` en la muestra.
- Volumen bajo: la señal propia de Ethos es escasa en esta ventana concreta,
  coherente con que la mayoría del universo capturado no tiene cuerpo (ver §6).

---

## 6. Calidad de extracción (01_Noticias_Raw / 02_Menciones)

Muestra: **6,000 noticias / 826 menciones** (ventana 120 días).

| Métrica | Valor |
|---|---|
| % título válido | 86.7% |
| % URL válida | 100% |
| % fecha válida | 99.3% |
| % medio válido | 100% |
| % texto ≥ 600 chars | 15.3% |
| % texto ≥ 1200 chars | 13.7% |
| **% cuerpo vacío** | **83.8%** |
| % encoding sospechoso | 0.3% |
| % boilerplate | 0% |
| % listing/sección | 0.4% |
| % duplicados por URL norm | 0.5% |
| % duplicados por título similar | 1.5% |

**Interpretación clave (matiz honesto):** el 83.8% de cuerpos vacíos está
dominado por el **universo de descubrimiento RSS** de los crons base, donde
Ethos guarda el titular pero **no extrae cuerpo** salvo en notas enriquecidas.
No es "extracción rota" en todos lados: donde el enrichment corre, la extracción
es **excelente**.

**Medios EXCELENTE / BUENA (extracción real, mediana alta):**
El Sol de Irapuato (100% ≥600, mediana 3223), El Otro Enfoque (100%, 2029),
Revista Espejo (100%, 3415), Zeta Tijuana (94.9%), Uno TV (98.8%, 2383),
Publimetro (78.3%, 2195), UNO MAS UNO (82.1%), ZonaDocs, Kiosco Informativo,
Diario Humano, Punto Norte, La Orquesta, Siete24, Posta, TV4.

**Medios SIN_CUERPO (100% vacías en la muestra — solo titular RSS):**
El Heraldo de México (511), El Imparcial Sonora (476), El Informador (402),
El Diario de Chihuahua (371), La Crónica de Hoy (346), Zócalo (342),
El Economista (342), La Razón (314), Vanguardia (267), ContraRéplica (204),
El Financiero (203), Periódico Correo (190), El Sol de México (186),
Proceso (154), Los Noticieristas (123), Forbes México (113), Expansión (71),
Xataka, Notus, Amexi, Líder Empresarial, EdoMex Al Día, Hidrocálido.

**Encoding:** único medio con mojibake relevante = **Uniradio Informa (MED-0087),
60% encoding sospechoso** → revisar decodificación del extractor de ese medio.

---

## 7. Alertas sombra (10_Alertas_Sombra)

Nuevas columnas explícitas escritas y validadas (readback ok, `mismatch=false`):
`prioridad_alerta, es_p1, es_p2, estado_alerta, motivo_bloqueo, es_duplicada,
cluster_id, cluster_key, cluster_tema, cluster_region, cluster_count, sin_envio,
canal, workflow, tier, fuente, shadow_client_allowlist, send_enabled,
whatsapp_enabled, email_enabled`.

Corrida de observación (`--observe-only`, sin envío):

```
menciones_evaluadas = 84
P1 inmediata        = 10
P2 resumen          = 35
BLOQUEADA           = 7
DUPLICADA           = 32
filas_10_escritas   = 84   readback = 84   mismatch = false
send = false  whatsapp = false  email = false
```

- **cluster_id** ahora se calcula estable y determinístico
  (`cliente_id | familia_keyword | región | fecha_cluster`) y permite medir
  duplicadas/fatiga. Las filas históricas quedan sin `cluster_id` (migran hacia
  adelante); las nuevas ya lo llevan.
- Histórico acumulado en 10: ~4.9k filas, con fuerte volumen de DUPLICADA
  (fatiga) — justamente lo que `cluster_id` + digest permiten consolidar.

---

## 8. Readiness por cliente (excluye CLI-PRUEBA)

> `readiness_excluye_cli_prueba = true`. CLI-PRUEBA / "Cobertura Local Prueba"
> se marcan `SOLO_TEST` y **no** cuentan en métricas ejecutivas (no se borran).

| cliente | cobertura_vs_pc | gap_real | precisión_est | extracción | alertas | estado | siguiente acción |
|---|---|---|---|---|---|---|---|
| CLI-0001 Jumex | 0% | — | baja | 15 | por poblar | **NO_LISTO** | auditoría dedicada de cobertura |
| CLI-0002 Bebidas alcohólicas (crisis) | 0%* | alto | media | alto en sus medios | P1 real | **SHADOW_ESTABLE / candidato piloto interno** | cerrar el 0-match y afinar precisión |
| CLI-0003 Reforma laboral | 0% | alto | media | mixto | P1 real | **NO_LISTO / shadow** | cerrar el 0-match; no real |
| CLI-PRUEBA | — | — | — | — | — | **SOLO_TEST** | excluir de readiness |

\* El 0% es efecto del `match=0` global (problema de comparación), no evidencia
de que CLI-0002 carezca de cobertura: sus medios de crisis (El Sol de Irapuato,
El Otro Enfoque, UNO MAS UNO) extraen excelente y generaron P1 shadow reales.

**Nota lista para `07.notas`** (emitida por el script; ver §11 sobre por qué no
se escribió automáticamente):

```
readiness_excluye_cli_prueba=true; readiness_global=0;
readiness_cli0001=NO_LISTO; readiness_cli0002=NO_LISTO; readiness_cli0003=NO_LISTO;
solo_pc_accionable_pct=92.6; alertas_con_cluster_id=<n filas nuevas>
```

---

## 9. Top 20 gaps accionables (para revisión humana primero)

Dominados por dos familias (a validar contra el 0-match antes de accionar):

1–14. **Tequila / bebidas** (CLI-0002): tequila adulterado, impuesto bebidas
alcohólicas, consejo regulador, Bacardí, Tequila Patrón — medios lado.mx,
Momento Diario, Marca México, Talajalisco, NTR Guadalajara.
15–18. **Reforma laboral** (CLI-0003): huelga/sindicato — La Crónica, El
Informador, Periódico Correo, Milenio.
19–20. **Jumex** (CLI-0001): bebidas azucaradas / programa escolar — La Crónica,
El Heraldo.

Exportable completo a `data/audit-replacement-readiness.json` con `--json`.

---

## 10. Medios prioritarios

- **Reparar extracción (alto impacto, alto volumen):** El Heraldo, El Imparcial,
  El Informador, El Economista, La Razón, El Financiero, Forbes, Proceso,
  Periódico Correo, La Crónica de Hoy — todos con cuerpo vacío en RSS. Evaluar si
  merece extraer cuerpo del universo base o solo de matches (decisión de costo).
- **Corregir encoding:** Uniradio Informa (MED-0087, 60% mojibake).
- **Mantener (ya excelentes):** El Sol de Irapuato, El Otro Enfoque, Revista
  Espejo, Zeta Tijuana, Uno TV, Publimetro, UNO MAS UNO.

Conteo de cobertura de medios (08): en_cron = 34, ready_no_cron = 27,
repairable = 25, blocked = 5.

---

## 11. Umbrales para sustituir (propuestos)

Por cliente, para pasar de shadow a **piloto interno** (nunca cliente externo aún):

- cobertura_ajustada ≥ 70%
- precisión estimada ≥ 85%
- extracción score ≥ 70% (texto ≥600 en medios del cliente)
- alertas con cluster_id ≥ 70% y duplicadas controladas
- 0-match resuelto (comparación reproducible)

Estados: `LISTO_PARA_PILOTO_INTERNO`, `SHADOW_ESTABLE_NO_REAL`,
`NECESITA_MAS_COBERTURA`, `NO_LISTO`, `SOLO_TEST`
(`src/comparators/replacementReadiness.ts`).

---

## 12. Plan 24–48h

1. **Diagnosticar el 0-match** (bloqueador #1): reproducir la comparación con la
   misma ventana de import PC vs menciones Ethos; revisar `normalizeUrl` y
   `diferencia_dias`. Sin esto, todo % de cobertura es ruido.
2. Reclasificar los 121 SOLO_PC ya con datos correctos (esperado: FP/sindicado
   suba, GAP_REAL baje muy por debajo de 112).
3. Revisar encoding de Uniradio Informa.

## 13. Plan 1 semana

1. Decidir política de extracción de cuerpo para medios base (universo vs match).
2. Afinar keywords CLI-0002 (tequila/alcohol adulterado) y CLI-0003 (huelga).
3. Consolidar fatiga de alertas usando `cluster_id` + digest (reducir DUPLICADA).
4. Volver a correr readiness y comparar contra estos umbrales.

## 14. Qué falta antes de sustituir

- Resolver 0-match y tener cobertura ajustada real (no artefacto).
- Subir extracción de cuerpo donde se necesita full-text.
- Validar precisión por cliente con muestra humana.
- **No hay envío real habilitado**; sustitución global sigue descartada.
  CLI-0002 es el único candidato a **piloto interno** (no externo) tras cerrar
  el 0-match.

---

## Monitoreo persona pública — CLI-MERY-TEST (2026-07-10)

Ethos ahora tiene capacidad de monitorear personas públicas además de marcas/industrias.

| campo | valor |
|---|---|
| cliente_id | CLI-MERY-TEST |
| nombre | Mery Pozos / Merilyn Gómez Pozos |
| tipo | persona_publica |
| alertas_activas | false (shadow only) |
| keywords | 12 (KEY-0040 a KEY-0051) |
| tier 1/2 | frase_exacta — 8 keywords, alerta=true |
| tier 3 | exacta_contextual — 4 keywords, alerta=false, contexto político requerido |
| cobertura histórica | 2 notas en PressClipping CSV (El Informador + lado.mx, feb 2026) |
| medio clave | MED-0005 lado.mx — ya en daily shadow tier |
| estado | MERY_SHADOW_DRY_RUN_OK — end-to-end validado (2026-07-11) |

**End-to-end shadow validado 2026-07-11:**
- `simulate-mery-pozos-shadow --window-days=180`: 1000 noticias, 0 matches, 0 FP ✅
- `detect-mentions --client=CLI-MERY-TEST --only-with-text --max-inserts=50`: 0 pendientes, 0 insertadas ✅
- `shadow-alerts --shadow-client-allowlist=CLI-MERY-TEST --no-send`: 72 filas en 10_Alertas_Sombra, mismatch=false ✅
- Filtro `--client` y `--max-inserts` implementados en detect-mentions ✅

Script: `scripts/tune-mery-pozos-shadow.ts` — idempotente, `--dry` validado limpio.
Script: `scripts/simulate-mery-pozos-shadow.ts` — scan histórico read-only.
Tests: `test/matcher-mery-pozos.test.ts` + `test/detect-mentions-client-filter.test.ts` — 822 total, todos verdes.
Docs: `docs/PERSONA_PUBLICA_MERY_POZOS_SHADOW.md`.

---

### Anexos técnicos

- `10_Alertas_Sombra`: 25 columnas originales preservadas + 19 nuevas de
  observabilidad (append, sin reordenar). Writer: `ensureOutputHeaders` +
  `appendHistoryRows` en `run-shadow-alerts.ts`.
- Clasificador SOLO_PC: `src/comparators/soloPressclippingClassifier.ts`.
- Readiness: `src/comparators/replacementReadiness.ts` +
  `scripts/audit-replacement-readiness.ts`.
- Calidad extracción: `src/comparators/extractionQuality.ts` +
  `scripts/audit-extraction-quality.ts`.
- cluster_id: `computeClusterFields` en `src/notifications/grouping.ts`.
