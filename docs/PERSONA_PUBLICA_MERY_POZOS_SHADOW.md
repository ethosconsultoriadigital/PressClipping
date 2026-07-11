# Monitoreo Shadow — Merilyn Gómez Pozos / Mery Pozos

_Creado: 2026-07-10. Modo: shadow only. alertas_activas=false. Sin envíos reales._

---

## 1. Objetivo del monitoreo

Rastrear cobertura mediática de la diputada federal Merilyn Gómez Pozos (Mery Pozos)
en medios nacionales y de Jalisco, como prueba de capacidad del sistema para monitorear
personas públicas antes de activar un cliente de producción.

- **Tipo:** persona_publica
- **Cargo:** diputada federal / vocera del Gobierno Federal
- **Partido:** Morena
- **Foco geográfico:** Nacional + Jalisco / Guadalajara
- **Estado:** shadow only — `alertas_activas=false`

---

## 2. Keywords implementadas

Implementadas en `scripts/tune-mery-pozos-shadow.ts` (KEY-0040 a KEY-0051).
Activan con `npm run tune-mery-pozos-shadow` (upsert idempotente).

### Tier 1 — Nombre completo/compuesto (frase_exacta, alerta=true)

| ID | keyword | alias | prioridad |
|---|---|---|---|
| KEY-0040 | Merilyn Gómez Pozos | Merilyn Gomez Pozos | Alta |
| KEY-0041 | Mery Pozos | — | Alta |
| KEY-0042 | Mery Gómez Pozos | Mery Gomez Pozos | Alta |
| KEY-0043 | Merilyn Gomez Pozos | — | Alta |
| KEY-0044 | Mery Gomez Pozos | — | Media |

### Tier 2 — Con cargo (frase_exacta, alerta=true)

| ID | keyword | alias | prioridad |
|---|---|---|---|
| KEY-0045 | diputada Mery Pozos | Mery Pozos diputada | Alta |
| KEY-0046 | diputada Merilyn Gómez | Merilyn Gómez diputada, variantes sin acento | Alta |
| KEY-0047 | diputada federal Merilyn Gómez Pozos | sin acentos | Alta |

### Tier 3 — Variantes amplias (exacta_contextual, alerta=false)

Requieren contexto político para matchear. Solo monitoreo, no generan alerta sombra.

| ID | keyword | contexto_incluir | contexto_excluir |
|---|---|---|---|
| KEY-0048 | Merilyn Gómez | político/legislativo | entretenimiento/deportes |
| KEY-0049 | Mery Gómez | político/legislativo | entretenimiento/deportes |
| KEY-0050 | Gómez Pozos | político/legislativo | infraestructura/agua/Pemex |
| KEY-0051 | Gomez Pozos | político/legislativo | infraestructura/agua/Pemex |

---

## 3. Reglas de bloqueo / anti-homónimos

- **"Mery" sola:** BLOQUEADO — nombre muy común (entretenimiento, redes, deportes).
- **"Pozos" solo:** BLOQUEADO — "pozos de agua", "pozos petroleros", "Pemex", "acuífero".
- **"Gómez" sola:** BLOQUEADO — apellido extremadamente común, sin valor discriminante.
- **"Merilyn Gómez" sin Pozos:** solo matchea si hay contexto político (KEY-0048).
- **"Mery Gómez" sin apellido Pozos:** solo matchea con contexto político fuerte (KEY-0049).
- **"Gómez Pozos" infraestructura:** contexto_excluir incluye pozos/agua/Pemex (KEY-0050/0051).

---

## 4. Clasificación temática esperada

| tema | descripción |
|---|---|
| NACIONAL_LEGISLATIVO | Cámara de Diputados, San Lázaro, iniciativas, reformas |
| JALISCO_POLITICO | Jalisco, Guadalajara, posicionamientos locales |
| GUADALAJARA_CANDIDATURA | Rumores o confirmaciones de candidatura municipal |
| ELECTORAL_RUMOR | Encuestas, perfiles, precandidaturas |
| DECLARACION_PUBLICA | Conferencias, ruedas de prensa, tuits/posts |
| INICIATIVA_LEGISLATIVA | Presentación o debate de iniciativa específica |
| REPUTACION_POSITIVA | Notas favorables, logros |
| REPUTACION_NEGATIVA | Críticas, denuncias, escándalos |
| CONTROVERSIA | Conflicto político, señalamientos |
| HOMONIMO | Falso positivo — mención de otra persona |
| NO_RELEVANTE | Mención marginal sin interés |

---

## 5. Severidad shadow

| nivel | criterios |
|---|---|
| P1 | Acusación, denuncia, escándalo, investigación, sanción, violencia política, crisis reputacional, candidatura de alto impacto, tendencia nacional |
| P2 | Nota política relevante, declaraciones, iniciativa, posicionamiento, encuesta, mención en Cámara/Morena/Guadalajara |
| P3 | Mención simple, agenda, evento, columna de bajo alcance, republicación |

Todas las alertas shadow: `sin_envio=true`, `canal=shadow`, `send_enabled=false`,
`whatsapp_enabled=false`, `email_enabled=false`.

---

## 6. Fuentes relevantes confirmadas

### Nacionales con cobertura verificada en PressClipping CSV

| medio | medio_id | cobertura | evidencia |
|---|---|---|---|
| El Informador | — | Confirmada | Nota "Operación Enjambre" 2026-02-06 |
| lado.mx | MED-0005 | Confirmada | Nota "Operación Enjambre" 2026-02-06 (republica de El Informador) |

> **Nota:** lado.mx (MED-0005) ya está en el daily shadow tier y tiene una nota
> verificada con la keyword "Mery Pozos". Alta prioridad para el monitoreo de Mery Pozos.

### Medios nacionales shadow activos donde puede aparecer

- MED-0005 lado.mx (daily validated) — ya cubre Nacional/Jalisco
- MED-0049 Telediario Monterrey (daily validated) — cubre perfil político nacional
- Medios del base shadow tier (Proceso, Animal Político, El Universal, etc.)

---

## 7. Estado de texto limpio

No se ejecutó `audit-extraction-quality` específico para Mery Pozos en esta sesión.
Referencia previa (2026-07-08):
- MED-0005 lado.mx: EXCELENTE (102/102 notas con texto limpio en auditoría previa)
- MED-0049 Telediario Monterrey: EXCELENTE conf=1.0

Para persona pública, el campo crítico es `titulo` + `resumen` — el matching de Tier 1/2
no requiere texto completo.

---

## 8. Resultado del dry-run

Ejecutado 2026-07-10:
```
npm run tune-mery-pozos-shadow -- --dry

=== CLIENTE ANTES ===
(no existe aún)

=== KEYWORDS ANTES ===
(existentes: 0 / objetivo: 12)

[DRY] Plan cliente:
  CLI-MERY-TEST "Mery Pozos / Merilyn Gómez Pozos" alertas_activas=false

[DRY] Plan keywords:
  KEY-0040 "Merilyn Gómez Pozos" tipo=frase_exacta prio=Alta alerta=true
  KEY-0041 "Mery Pozos" tipo=frase_exacta prio=Alta alerta=true
  KEY-0042 "Mery Gómez Pozos" tipo=frase_exacta prio=Alta alerta=true
  KEY-0043 "Merilyn Gomez Pozos" tipo=frase_exacta prio=Alta alerta=true
  KEY-0044 "Mery Gomez Pozos" tipo=frase_exacta prio=Media alerta=true
  KEY-0045 "diputada Mery Pozos" tipo=frase_exacta prio=Alta alerta=true
  KEY-0046 "diputada Merilyn Gómez" tipo=frase_exacta prio=Alta alerta=true
  KEY-0047 "diputada federal Merilyn Gómez Pozos" tipo=frase_exacta prio=Alta alerta=true
  KEY-0048 "Merilyn Gómez" tipo=exacta_contextual prio=Media alerta=false
  KEY-0049 "Mery Gómez" tipo=exacta_contextual prio=Baja alerta=false
  KEY-0050 "Gómez Pozos" tipo=exacta_contextual prio=Media alerta=false
  KEY-0051 "Gomez Pozos" tipo=exacta_contextual prio=Media alerta=false

[DRY] No se escribió nada.
```

No se escribió nada en Supabase. Script listo para ejecución real con autorización.

### Ejecución real — 2026-07-10

**Estado: MERY_SHADOW_CONFIG_CREATED**

`npm run tune-mery-pozos-shadow` ejecutado sin `--dry` el 2026-07-10.

Read-back desde Supabase confirmado:
```
CLI-MERY-TEST: alertas_activas=false, activo=true ✅
KEY-0040..KEY-0051: 12/12 con cliente_id=CLI-MERY-TEST ✅
Post-upsert assertion: alertas_activas=false ✅
Sin conflictos de keyword_id ✅
```

Dry-run de detección ejecutado:
```
npm run detect-mentions -- --dry-run --only-with-text

keywords_activas: 49 (incluye 12 nuevas de Mery Pozos)
noticias pendientes: 0 (históricas ya procesadas en runs previos)
menciones_potenciales: 0
insertas: 0 (dry-run real confirmado)
```

**Próximo ciclo de crawl** aplicará automáticamente las keywords de Mery Pozos a noticias nuevas.

---

## 9. Riesgos de homónimos

| riesgo | nivel | mitigación |
|---|---|---|
| "Mery" entertenimieto/redes | Alto | frase_exacta exige "Pozos" o "Gómez Pozos"; Tier 3 excluye entretenimiento |
| "Pozos" infraestructura/agua | Alto | contexto_excluir en KEY-0050/0051; Tier 1/2 nunca usan "Pozos" solo |
| "Merilyn Gómez" = otra persona | Medio | KEY-0048 requiere contexto político; KEY-0040 exige nombre completo |
| "Gómez Pozos" = empresa | Bajo | contexto_incluir político en KEY-0050/0051 |
| nota lado.mx = republica | Bajo | normal para medio agregador; no genera FP, solo duplicado |

---

## 10. Siguiente paso recomendado

1. **Autorizar escritura en Supabase:** ejecutar `npm run tune-mery-pozos-shadow` (sin `--dry`)
   para insertar CLI-MERY-TEST y las 12 keywords en producción shadow.
2. **Ejecutar dry-run de detect-mentions:**
   ```bash
   npm run detect-mentions -- --dry-run --only-with-text
   ```
   para ver cuántas menciones históricas produce antes de marcar ninguna.
3. **Revisar resultado:** potenciales, FP estimado, flood sí/no, homónimos.
4. Si FP ≤ 20% y no hay flood: ejecutar `npm run detect-mentions -- --only-with-text`
   (sin `--dry-run`) con `alertas_activas=false` garantizado — solo inserta menciones, no envía.

**No activar `alertas_activas=true` sin autorización explícita.**
