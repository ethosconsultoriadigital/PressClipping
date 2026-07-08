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
