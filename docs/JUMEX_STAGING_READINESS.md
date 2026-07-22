# Jumex (CLI-0001) — Staging readiness sobre base de captura general

_Fase "ETHOS NEWS LAKE" (2026-07-17). Solo staging (tab 12, `--clients=CLI-0001`).
**NO se tocó ninguna hoja final de Jumex.** Datos reales de la tabla `menciones`,
ventana 30 días, snapshot 2026-07-17T21:1X UTC._

## 1. Keywords activas (7, ya alineadas con lo pedido en esta fase)

| keyword_id | keyword | contexto_incluir | contexto_excluir |
|---|---|---|---|
| KEY-0001 | Jumex (alias Jugos Jumex, Grupo Jumex) | bebidas\|jugos\|empresa | — |
| KEY-0002 | Museo Jumex (alias Fundación Jumex) | arte\|museo\|exposicion | — |
| KEY-0009 | bebidas azucaradas | impuesto\|IEPS\|salud\|industria\|regulación | — |
| KEY-0065 | IEPS bebidas azucaradas (alias IEPS refrescos/jugos/néctares) | — | — |
| KEY-0066 | etiquetado frontal | Jumex\|jugos\|néctares\|bebidas azucaradas\|IEPS | — |
| KEY-0067 | retiro de producto (alias recall de producto) | Jumex\|jugos\|néctares\|bebidas azucaradas\|IEPS | — |
| KEY-0068 | Profeco | Jumex\|jugos\|néctares\|bebidas azucaradas | gasolina/diésel/combustible/magna/premium/tabaco/… |

No se necesitó tunear nada — el set ya cubre exactamente lo pedido en esta
fase (bebidas azucaradas, IEPS variantes, etiquetado frontal, retiro de
producto, Profeco con exclusión de gasolina) y bloquea el ruido pedido (Museo
Jumex vía contexto arte, Profeco-gasolina vía exclusión).

## 2. Menciones reales, ventana 30 días (16 total)

| ventana | menciones |
|---|---|
| 24h | 1 |
| 7d | 8 |
| 30d | 16 |

**Por keyword:** bebidas azucaradas (7), Museo Jumex (6), Profeco (2), Jumex (1).

## 3. Clasificación honesta de las 16

- **Museo Jumex — 6 (37.5%):** correctamente clasificadas `MUSEO_JUMEX_EXCLUIR`
  por `consolidation.ts` (arte contemporáneo, retrospectivas, wrap-ups del
  Mundial que mencionan el museo de pasada). **Excluidas, funcionando como se
  diseñó.**
- **Profeco — 2 (12.5%):** ambas son notas de **precio de gasolina** ("Precio
  de la gasolina en México hoy 10 de julio..."), el patrón exacto que el fix
  de KEY-0068 bloquea. **Verificado: son de 2026-07-12 y 2026-07-14, ANTES del
  fix (aplicado 2026-07-16, commit `62cf5e3`)** — residuo histórico, no una
  falla del fix actual. No se borraron (regla: no borrar menciones).
- **bebidas azucaradas — 7 (43.75%):** el hallazgo más importante de esta
  fase. Son artículos genéricos de política fiscal/salud pública ("Impuestos a
  bebidas azucaradas siguen siendo insuficientes", "Vive Saludable, Vive Feliz
  seguirá en las escuelas", "sistema universal de salud") — **ninguno
  menciona a Jumex por nombre.** El keyword-gate los deja pasar porque son
  temáticamente adyacentes (sector bebidas azucaradas + IEPS/salud), y
  `consolidation.ts` los clasifica `GO_ALTA`/`ALTA_RELEVANCIA` (grupo
  `SALUD_PUBLICA_BEBIDAS`). Esto es correcto como **monitoreo sectorial/
  regulatorio**, pero **no es cobertura de marca Jumex** — si se conectara a
  una hoja final tal cual, inundaría el reporte de noticias fiscales
  genéricas sin relación directa con el cliente.
- **Jumex (marca exacta) — 1 (6.25%):** una nota sobre donación de mango
  ("Diecisiete toneladas de mango...") — match borderline, requiere lectura
  manual para confirmar si Jumex participa realmente de la historia o es
  ruido de keyword ancha.

**Menciones genuinamente de marca Jumex en 30 días: 0-1 de 16.**

## 4. Estado GO/NO-GO — hoja final

**NO-GO, confirmado y reforzado.** No es un problema de cobertura de medios
(la captura general funciona: 42 medios en cron, muchos ya LISTO_LEYENDO) —
es que Jumex, como marca, genera muy poca noticia PR-relevante orgánica
ahora mismo, y la señal que sí existe es mayormente ruido institucional
(Museo) o sectorial genérico (política fiscal de bebidas azucaradas), no
cobertura de marca.

**Qué falta para GO:**
1. Decidir si "bebidas azucaradas" genérico cuenta como valor editorial para
   Jumex (monitoreo sectorial) o debe re-clasificarse a relevancia media/baja
   sin mención explícita de la marca — esto es una decisión de producto, no
   un bug.
2. Acumular más ventana de observación (16 menciones/30d es una muestra
   pequeña) antes de decidir volumen esperado real.
3. Confirmar si el caso "mango" (keyword Jumex exacta) es señal real o FP.

**Export generado:** tab interna `12_Operacion_Consolidada_Sin_PressClipping`
(`--clients=CLI-0001 --window-days=30`), 9 filas nuevas, 7 duplicados, 0
escritura en ninguna hoja final. Solo para revisión interna.

## 5. Criterio editorial de 4 categorías (2026-07-20)

Implementado en `src/editorial/jumexCriteria.ts` (13 tests), reutilizando el
`keyword_id` de cada mención ya gateada por contexto (no reinterpreta texto):

| categoría | keywords | regla de producción propuesta |
|---|---|---|
| MARCA_DIRECTA | KEY-0001 (Jumex/Grupo Jumex/Jugos Jumex) | candidata a producción Jumex |
| SECTOR_REGULATORIO_ALTO | KEY-0065/66/67/68 (IEPS, etiquetado frontal, retiro de producto, Profeco) | revisión humana / sección sectorial, nunca mezclada como marca |
| SECTOR_GENERAL | KEY-0009 (bebidas azucaradas genérico) | solo observación/staging |
| EXCLUIR | KEY-0002 (Museo/Fundación Jumex) | nunca sale de staging |

**Resultado real (30d, `npm run report-jumex-staging-categorized`):** 17
menciones — 1 MARCA_DIRECTA, 2 SECTOR_REGULATORIO_ALTO, 8 SECTOR_GENERAL, 6
EXCLUIR. Veredicto automático: **NO-GO**. Regla codificada: <3 menciones
MARCA_DIRECTA en la ventana = NO-GO automático.

---

## 7. JUMEX KEYWORD EXPANSION + 200-MEDIA BACKTEST (2026-07-22)

### 7.1 Auditoría de descubrimiento (`npm run audit-jumex-keyword-discovery`)

Búsqueda ilike en títulos de noticias para 25 términos candidatos (30d/90d).
**SOLO LECTURA — nada escrito.**

| término | categoría | keyword_id | hits_30d | hits_90d | señal |
|---|---|---|---|---|---|
| Jumex | YA_ACTIVA | KEY-0001 | 0 | 2 | ⬜ SIN SEÑAL |
| Grupo Jumex | YA_ACTIVA | KEY-0001 | 0 | 0 | ⬜ SIN SEÑAL |
| Jugos Jumex | YA_ACTIVA | KEY-0001 | 0 | 0 | ⬜ SIN SEÑAL |
| Museo Jumex | YA_ACTIVA | KEY-0002 | 1 | 1 | 🟡 DÉBIL |
| bebidas azucaradas | YA_ACTIVA | KEY-0009 | 1 | 1 | 🟡 DÉBIL |
| IEPS bebidas azucaradas | YA_ACTIVA | KEY-0065 | 0 | 0 | ⬜ SIN SEÑAL |
| etiquetado frontal | YA_ACTIVA | KEY-0066 | 0 | 0 | ⬜ SIN SEÑAL |
| retiro de producto | YA_ACTIVA | KEY-0067 | 0 | 0 | ⬜ SIN SEÑAL |
| Profeco | YA_ACTIVA | KEY-0068 | 162* | 164* | 🔴 ALTO (filtrado por contexto) |
| Jumex Holding | MARCA_DIRECTA | — | 0 | 0 | ⬜ SIN SEÑAL |
| néctar Jumex | MARCA_DIRECTA | — | 0 | 0 | ⬜ SIN SEÑAL |
| néctares Jumex | MARCA_DIRECTA | — | 0 | 0 | ⬜ SIN SEÑAL |
| jugo Jumex | MARCA_DIRECTA | — | 0 | 0 | ⬜ SIN SEÑAL |
| industria de jugos | PRODUCTO_CATEGORIA | — | 0 | 0 | ⬜ SIN SEÑAL |
| néctares de fruta | PRODUCTO_CATEGORIA | — | 0 | 0 | ⬜ SIN SEÑAL |
| jugos envasados | PRODUCTO_CATEGORIA | — | 0 | 0 | ⬜ SIN SEÑAL |
| jugos y néctares | PRODUCTO_CATEGORIA | — | 0 | 0 | ⬜ SIN SEÑAL |
| COFEPRIS bebidas | SECTOR_REGULATORIO_ALTO | — | 0 | 0 | ⬜ SIN SEÑAL |
| NOM bebidas | SECTOR_REGULATORIO_ALTO | — | 0 | 0 | ⬜ SIN SEÑAL |
| impuesto refrescos | SECTOR_REGULATORIO_ALTO | — | 0 | 0 | ⬜ SIN SEÑAL |
| reforma fiscal bebidas | SECTOR_REGULATORIO_ALTO | — | 0 | 0 | ⬜ SIN SEÑAL |
| industria refresquera | SECTOR_GENERAL | — | 0 | 0 | ⬜ SIN SEÑAL |
| bebidas no alcohólicas | SECTOR_GENERAL | — | 0 | 0 | ⬜ SIN SEÑAL |
| industria de bebidas | SECTOR_GENERAL | — | 0 | 0 | ⬜ SIN SEÑAL |
| agua embotellada | SECTOR_GENERAL | — | 2 | 2 | 🟡 DÉBIL (off-topic) |

_* Profeco raw: 162 hits son WITHOUT el filtro `contexto_incluir`. El gate
`exacta_contextual` con `Jumex|jugos|néctares|bebidas azucaradas` reduce esto
a ~4 menciones reales — la calibración actual es correcta y no se cambia._

**Conclusión del discovery:**
- **Ningún término candidato tiene señal relevante** para Jumex en 30d.
- `agua embotellada` (2 hits): titulares off-topic ("¿causa celulitis?",
  "costo oculto de botellas en negocios") — NO relevante para PR de marca.
- **Recomendación: no activar ningún keyword nuevo.** El set actual es el
  correcto; el problema es de volumen orgánico de marca, no de cobertura.

### 7.2 Actualización del clasificador (5 categorías)

`src/editorial/jumexCriteria.ts` actualizado con la 5ª categoría
`PRODUCTO_CATEGORIA` (antes eran 4). Ninguna keyword activa la usa todavía;
está preparada para cuando haya señal real.

| categoría | descripción | uso actual |
|---|---|---|
| MARCA_DIRECTA | Nombre directo de marca (Jumex, Grupo Jumex, Jugos Jumex) | KEY-0001 |
| PRODUCTO_CATEGORIA | Categoría de producto Jumex sin nombre (néctares, jugos envasados) | — (preparada) |
| SECTOR_REGULATORIO_ALTO | Riesgo fiscal/regulatorio (IEPS, etiquetado frontal, Profeco, retiro) | KEY-0065/66/67/68 |
| SECTOR_GENERAL | Sector bebidas azucaradas genérico | KEY-0009 |
| EXCLUIR | Museo/Fundación Jumex, ruido | KEY-0002 |

### 7.3 GO/NO-GO — Escenario A y B (2026-07-22)

| ventana | menciones | MARCA_DIRECTA | PRODUCTO_CATEGORIA | SECTOR_REG_ALTO | SECTOR_GENERAL | EXCLUIR |
|---|---|---|---|---|---|---|
| 24h | 4 | 0 | 0 | — | — | — |
| 7d | 6 | 0 | 0 | — | — | — |
| 30d | 21 | **1** | **0** | 4 | 10 | 6 |

**Escenario A (marca sola):** 1 MARCA_DIRECTA / 30d → **NO-GO**
**Escenario B (marca + regulatorio):** 1 MARCA_DIRECTA → **NO-GO** (threshold < 3, sin
autorización editorial expresa)

Único titular MARCA_DIRECTA: "Diecisiete toneladas de mango iban a
desperdiciarse..." (El Imparcial Sonora) — borderline, Jumex probablemente
involucrado indirectamente en donación, no es noticia PR directa de la marca.

**Veredicto final: NO-GO mantenido.** 200 medios capturando, 7 keywords
activas, 5 categorías implementadas — la cobertura técnica está lista, pero
Jumex como marca genera muy poca noticia PR orgánica en este período.

---

## 6. Rerun staging (2026-07-22 — NEWS LAKE 200 FINAL PUSH)

Después de activar Merca2.0 (MED-0184) y El CEO (MED-0185) en cron y ejecutar
crawl + enrich de ambos (30 noticias nuevas, 77% texto limpio):

| ventana | menciones |
|---|---|
| 24h | 4 |
| 7d | 6 |
| 30d | 21 |

**Por categoría (30d):** 1 MARCA_DIRECTA, 4 SECTOR_REGULATORIO_ALTO, 10
SECTOR_GENERAL, 6 EXCLUIR.

**Único titular MARCA_DIRECTA:** "Diecisiete toneladas de mango iban a
desperdiciarse..." — El Imparcial Sonora. Sigue siendo el mismo caso
borderline (donación de mango, Jumex probablemente involucrado indirectamente).

**Medios que aportaron menciones:** Excelsior, El Informador, Aristegui,
El Heraldo de México, El Sol de México, La Razón, El Diario de Chihuahua,
Vanguardia, Revista Espejo, Zócalo, Coolhuntermx, Xataka México.

**Veredicto: NO-GO mantenido.** 1 MARCA_DIRECTA / 30d — umbral sigue sin
alcanzarse. Hoja final Jumex no tocada. Ningún dato escrito en Sheets.
