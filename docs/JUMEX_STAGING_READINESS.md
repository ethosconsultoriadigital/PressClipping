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
EXCLUIR. Veredicto automático: **NO-GO** ("solo 1 mención MARCA_DIRECTA —
insuficiente para producción estable, requiere autorización editorial
expresa"). Regla codificada: <3 menciones MARCA_DIRECTA en la ventana =
NO-GO automático, salvo autorización editorial explícita del usuario.
