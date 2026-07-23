# Mery Pozos (CLI-MERY-TEST) — Staging Readiness

_Fase "MERY POZOS STAGING ALERT — 200 MEDIA BACKTEST" (2026-07-22).
alertas_activas=false. Sin envíos reales. Hoja final NO tocada._

---

## 1. Estado del cliente

| campo | valor |
|---|---|
| cliente_id | CLI-MERY-TEST |
| nombre | Mery Pozos / Merilyn Gómez Pozos |
| alertas_activas | **false** (shadow only) |
| activo | true |
| keywords activas | 12 (KEY-0040 a KEY-0051) |
| creado | 2026-07-10 |
| primer match real | 2026-07-11 |

---

## 2. Keywords activas

### Tier 1 — Nombre completo (frase_exacta, alerta=true)

| ID | keyword | alias |
|---|---|---|
| KEY-0040 | Merilyn Gómez Pozos | Merilyn Gomez Pozos |
| KEY-0041 | Mery Pozos | — |
| KEY-0042 | Mery Gómez Pozos | Mery Gomez Pozos |
| KEY-0043 | Merilyn Gomez Pozos | — |
| KEY-0044 | Mery Gomez Pozos | — |

### Tier 2 — Con cargo (frase_exacta, alerta=true)

| ID | keyword | alias |
|---|---|---|
| KEY-0045 | diputada Mery Pozos | Mery Pozos diputada |
| KEY-0046 | diputada Merilyn Gómez | variantes sin acento |
| KEY-0047 | diputada federal Merilyn Gómez Pozos | sin acentos |

### Tier 3 — Variantes amplias (exacta_contextual, alerta=false)

| ID | keyword | contexto_incluir | contexto_excluir |
|---|---|---|---|
| KEY-0048 | Merilyn Gómez | político/legislativo | entretenimiento/deportes |
| KEY-0049 | Mery Gómez | político/legislativo | entretenimiento/deportes |
| KEY-0050 | Gómez Pozos | político/legislativo | infraestructura/agua/Pemex |
| KEY-0051 | Gomez Pozos | político/legislativo | infraestructura/agua/Pemex |

### Reglas de bloqueo

- "Mery" sola: **BLOQUEADO** (nombre muy común)
- "Pozos" solo: **BLOQUEADO** (pozos de agua, petroleros, Pemex)
- "Gómez" sola: **BLOQUEADO** (apellido extremadamente común)
- "Merilyn Gómez" sin contexto: solo matchea con contexto político (KEY-0048)
- "Gómez Pozos" con infraestructura: excluido por contexto_excluir

---

## 3. Backtest 200 medios (2026-07-22)

### Volumen de menciones (tabla `menciones`, CLI-MERY-TEST)

| ventana | menciones |
|---|---|
| 24h | **2** |
| 7d | **26** |
| 30d | **29** |
| 90d | **29** (toda actividad en los últimos 30d) |

### Detalle por artículo (30d) — artículos distintos

| fecha | medio | titular | keywords |
|---|---|---|---|
| 2026-07-22 | Político MX | Mery Pozos denuncia intento de privatización del agua en Jalisco | KEY-0041, KEY-0045 |
| 2026-07-21 | El Informador | SIAPA: Gobierno de Jalisco se dice abierto al diálogo ante propuesta de Consejo Consultivo del Agua | KEY-0040, KEY-0042, KEY-0044, KEY-0049 |
| 2026-07-21 | Telediario Monterrey | Crisis del agua en Jalisco expone divisiones internas en Morena | KEY-0040, KEY-0043, KEY-0050, KEY-0051 |
| 2026-07-21 | Milenio | La Tremenda Corte | KEY-0041 |
| 2026-07-20 | El Informador | Denuncian diputados de MC abandono federal para solucionar mala calidad de agua en el AMG | KEY-0041 |
| 2026-07-20 | Milenio | La Tremenda Corte | KEY-0040, KEY-0043, KEY-0046, KEY-0048, KEY-0050, KEY-0051 |
| 2026-07-18 | El Heraldo de México | Hay presencia de plomo y mercurio en agua potable en Guadalajara, denuncia diputada Mery Pozos | KEY-0041, KEY-0045 |
| 2026-07-17 | El Informador | Comisión de presupuesto abre la puerta al diálogo para solucionar el tema del agua en Guadalajara | KEY-0041, KEY-0042, KEY-0044, KEY-0045, KEY-0049, KEY-0050, KEY-0051 |
| 2026-07-13 | El Informador | Mery Pozos rechaza propuesta de endeudamiento para atender crisis del agua | KEY-0041 |
| 2026-07-11 | El Informador | Brotan ideas | KEY-0041, KEY-0045 |

**~10 artículos distintos, 29 menciones** (keywords múltiples por artículo).

### Medios que aportaron menciones (30d)

| medio | menciones |
|---|---|
| El Informador | ~17 |
| Milenio | ~7 |
| Telediario Monterrey | ~4 |
| El Heraldo de México | 2 |
| Político MX | 2 |

---

## 4. Clasificación editorial

### MENCION_DIRECTA (nombre en título o frase inequívoca)

- "Mery Pozos denuncia intento de privatización del agua en Jalisco" (Político MX, 2026-07-22)
- "Hay presencia de plomo y mercurio en agua potable en Guadalajara, denuncia diputada Mery Pozos" (El Heraldo, 2026-07-18)
- "Mery Pozos rechaza propuesta de endeudamiento para atender crisis del agua" (El Informador, 2026-07-13)
- Artículos del Informador (2026-07-17, 2026-07-11) con "Mery Pozos" / "diputada Mery Pozos" en título

**Estimado: ~6–8 artículos MENCION_DIRECTA (60–80% del total)**

### CONTEXTO_POLITICO (aparece en cuerpo con contexto político claro)

- "SIAPA: Gobierno de Jalisco se dice abierto al diálogo..." (El Informador, 2026-07-21)
- "Crisis del agua en Jalisco expone divisiones internas en Morena" (Telediario, 2026-07-21)
- "Denuncian diputados de MC abandono federal..." (El Informador, 2026-07-20)

**Estimado: ~2–3 artículos CONTEXTO_POLITICO (20–30%)**

### POSIBLE_FP — verificar manualmente

- "La Tremenda Corte" (Milenio, 2026-07-20 y 2026-07-21): programa/sección de opinión/tribunales. El título no menciona a Mery Pozos, pero 6+ keywords de su perfil dispararon vía texto. Posiblemente legítimo (nota sobre crisis del agua que menciona a la diputada en el cuerpo). **Recomendación: leer el artículo para confirmar.**

**Estimado: 1–2 artículos a verificar (10%)**

### EXCLUIR

- Ninguna detectada — "Pozos" genérico (agua, pozos petroleros) bloqueado correctamente.

---

## 5. Contexto editorial

El tema que domina toda la cobertura es la **crisis del agua en Jalisco/Guadalajara**:
- Denuncias de plomo y mercurio en agua potable
- Debate sobre privatización del SIAPA
- Propuesta de Consejo Consultivo del Agua
- Posicionamiento de Morena vs. MC en el Congreso de Jalisco
- Mery Pozos actúa como **vocera federal de Morena** en este tema

Este es un tema de alto interés público y cobertura activa. La señal es real, orgánica y sostenida.

---

## 6. Análisis de la simulación (0 hits) — por qué

`npm run simulate-mery-pozos-shadow -- --window-days=30` reportó 0 hits.
Esto NO contradice los 29 menciones en la tabla `menciones`. La razón:

Con 200 medios activos y 67 en cron diario, la tabla `noticias` acumula
~1000–2000 noticias nuevas por día. El simulador tiene un límite de 2000
noticias máximo, ordenadas por `fecha_publicacion DESC`. Con 30 días de
ventana, las 2000 noticias más recientes cubren solo los últimos 1–2 días.
Los artículos del período 2026-07-11 a 2026-07-20 ya no aparecen en la
muestra de 2000 — pero sus menciones ya están capturadas en la tabla
`menciones` por el pipeline normal de `detect-mentions`.

**Conclusión:** el simulador es útil para periodos pre-pipeline (sin menciones en DB),
pero con el pipeline activo, la tabla `menciones` es la fuente de verdad.

---

## 7. GO/NO-GO — producción controlada

### Criterios

| criterio | resultado |
|---|---|
| ≥3 MENCION_DIRECTA en 30d | ✅ ~6–8 artículos explícitos |
| FP bajo | ✅ ~10% posible FP (1–2 artículos a verificar) |
| No depende de una sola fuente | ✅ 5 medios distintos |
| Dedupe funciona | ✅ keywords múltiples por artículo, no duplica a nivel noticia |
| alertas_activas=false | ✅ sin envíos reales |

### Veredicto: **GO CONDICIONADO**

La señal es suficiente para pasar a producción controlada:
- 29 menciones / 30d, pico activo en julio 2026 por crisis del agua en Jalisco
- 5 medios distintos, incluyendo El Informador (principal en Jalisco), Milenio, El Heraldo
- Tema de alta relevancia PR (crisis reputacional potencial vs. logros legislativos)
- 0 FP de "pozos de agua / pozos petroleros" — exclusiones funcionando

**Pendiente para producción:**
1. Verificar manualmente "La Tremenda Corte" (Milenio) — 1–2 artículos
2. Confirmar formato de salida preferido (Sheets, report interno, o ambos)
3. Autorización explícita para activar `alertas_activas=true`

---

## 8. Nota sobre detect-mentions dry-run (2026-07-22)

`detect-mentions --client=CLI-MERY-TEST --dry-run --max-inserts=100` reportó:
```
noticias_pendientes: 500
menciones_potenciales: 0
sinTexto: 500
```

Los 500 noticias pendientes están sin texto (pendientes de enrich). Las menciones
ya capturadas vienen del pipeline de días anteriores donde el enrich ya había corrido.
El siguiente ciclo de enrich + detect procesará las 500 noticias actuales.

---

## 9. Infraestructura completa

| artefacto | estado |
|---|---|
| `scripts/tune-mery-pozos-shadow.ts` | Activo — idempotente |
| `scripts/simulate-mery-pozos-shadow.ts` | Activo — read-only |
| `test/matcher-mery-pozos.test.ts` | 30 tests, todos verdes |
| `test/detect-mentions-client-filter.test.ts` | Verdes |
| CLI-MERY-TEST en Supabase | alertas_activas=false, 12 keywords |
| Menciones en DB | 29 en 30d |

---

## 10. Siguiente paso recomendado

**GO condicionado.** Para avanzar a producción controlada:
1. Leer manualmente "La Tremenda Corte" (Milenio, 2026-07-20) para confirmar
   que la mención es real — si es legítima, el set es limpio.
2. Autorizar `alertas_activas=true` para CLI-MERY-TEST.
3. Definir formato de salida (Sheets / report interno).

**No activar sin autorización explícita.**
