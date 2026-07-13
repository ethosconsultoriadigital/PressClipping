# Puente de Reportes — Jumex (CLI-0001) y Patrón/Bacardí (CLI-0002)

_Creado 2026-07-11 en el contexto de la emergencia de reemplazo de PressClipping._
_Documenta el camino hacia exportar resultados a una hoja de reportes final. NO conecta
salida real todavía — solo especifica campos, origen y validaciones._

---

## 0. Capa consolidada editorial — tab 12 (2026-07-13)

Tras auditoría externa (GPT) de la tab 11 raw, se creó una capa consolidada editorial:

| capa | tab | granularidad | uso |
|---|---|---|---|
| Raw staging técnico | `11_Operacion_Sin_PressClipping` | 1 fila por mención (por keyword) | auditoría técnica, dedupe por keyword_id |
| **Consolidada editorial** | `12_Operacion_Consolidada_Sin_PressClipping` | **1 fila por noticia (por url_norm)** | **candidata a reporte final** |

Script: `scripts/export-operational-news-consolidated-no-pc.ts`
(lógica pura determinística en `src/editorial/consolidation.ts`, sin classify-ia).

```bash
npm run export-operational-news-consolidated-no-pc -- --clients=CLI-0001,CLI-0002 --window-days=7 --output=sheet
```

**Resultado (ventana 7d, 2026-07-13):** 66 filas raw → **43 consolidadas** (23 duplicados
editoriales agrupados por url_norm). Readback `mismatch=false`. Dedupe verificado
(2ª corrida: 0 nuevas, 43 omitidas).

| relevancia_editorial | filas |
|---|---|
| ALTA_RELEVANCIA | 16 |
| MEDIA_RELEVANCIA | 8 |
| BAJA_RELEVANCIA | 8 |
| POSIBLE_FP | 11 |

### Decisión GO / NO-GO (incorpora dictamen GPT)

- **Patrón / CLI-0002 = GO CONDICIONADO.** 36 filas consolidadas, mayoría CRISIS_ALCOHOL_ADULTERADO
  (13) e INDUSTRIA_TEQUILA. Suficientes ALTA/MEDIA para reporte. **Condición:** filtrar
  `estado_editorial ∈ {GO_ALTA, GO_MEDIA}` y excluir POSIBLE_FP/EXCLUIR (turismo, seguridad
  incidental, T-MEC/COFEPRIS sin contexto bebida) antes de conectar a hoja final.
- **Jumex / CLI-0001 = NO-GO para hoja final.** 7 filas consolidadas, 3 marcadas
  MUSEO_JUMEX_EXCLUIR, y las restantes con poca señal regulatoria real. Se mantiene en
  staging hasta ampliar fuentes regulatorias (IEPS/Profeco/COFEPRIS) y acumular volumen útil.

### Hallazgo (detección, no editorial): alias "CRT" demasiado amplio

KEY-0063 ("Consejo Regulador del Tequila", alias **"CRT"**, tipo=`contiene`) matchea "CRT"
en notas tech no relacionadas (ej. "CFE Internet…", "Movimiento Ciudadano… celulares" en
Xataka). La capa editorial las clasificó INDUSTRIA_TEQUILA por confiar en el keyword. Es un
FP a nivel de detección: el alias "CRT" `contiene` debería ser `exacta` o eliminarse.
Pendiente de afinación de keyword (fuera del alcance de esta fase editorial).

---

## 1. Contexto

PressClipping (servicio externo) fue cancelado. Ethos pasa de "comparativo vs PressClipping"
a ser la **fuente operativa principal** para Patrón/Bacardí/Bebidas alcohólicas (CLI-0002) y
Jumex (CLI-0001). Este documento define el puente de datos hacia el reporte final, sin
todavía conectarlo (ninguna hoja de reportes fue tocada en esta fase).

## 2. Origen de los datos (Supabase)

| tabla | campos relevantes |
|---|---|
| `menciones` | mencion_id, cliente_id, noticia_id, keyword_id, keyword, texto_match, tipo_match, score_relevancia, requiere_alerta, estado_revision, created_at |
| `noticias` | noticia_id, medio_id, titulo, url_original, fecha_publicacion, texto_cuerpo_nota, texto_nota_limpia, texto_extraido |
| `medios` | medio_id, nombre_medio |
| `keywords` | keyword_id, cliente_id, keyword, tipo_keyword, alerta |
| `clientes` | cliente_id, nombre_cliente, alertas_activas |

Query base (join menciones + noticias + medios), scopeada por `cliente_id`:

```sql
select m.mencion_id, m.cliente_id, m.keyword, m.texto_match, m.tipo_match,
       m.score_relevancia, m.requiere_alerta, m.estado_revision, m.created_at,
       n.titulo, n.url_original, n.fecha_publicacion,
       med.nombre_medio
from menciones m
join noticias n on n.noticia_id = m.noticia_id
join medios med on med.medio_id = n.medio_id
where m.cliente_id = 'CLI-0002'
order by m.created_at desc;
```

## 3. Cliente → keywords activas

| cliente_id | nombre | keywords_activas | keywords_nuevas (2026-07-11) |
|---|---|---|---|
| CLI-0002 | Bebidas alcoholicas (Patrón/Bacardí/tequila) | 27 | KEY-0060..0064 (Tequila Patrón, Casa Patrón, Atotonilco el Alto, CRT, IEPS alcohol) |
| CLI-0001 | Jumex | 7 | KEY-0065..0068 (IEPS bebidas azucaradas, etiquetado frontal, retiro de producto, Profeco) |

Ver `scripts/tune-patron-jumex-keywords.ts` para el detalle completo (idempotente, no toca `clientes`).

## 4. Campos mínimos para el reporte final

| campo destino | origen | notas |
|---|---|---|
| fecha | noticias.fecha_publicacion | ISO 8601 |
| medio | medios.nombre_medio | — |
| título | noticias.titulo | — |
| URL | noticias.url_original | preservar tal cual, no acortar |
| keyword | menciones.keyword | texto de la keyword que matcheó |
| tipo_match | menciones.tipo_match | frase_exacta / contiene / exacta_contextual |
| score_relevancia | menciones.score_relevancia | 0–1 |
| requiere_alerta | menciones.requiere_alerta | boolean, deriva P1 vs P2/P3 |
| sentimiento | (pendiente) | requiere clasificación IA — NO ejecutada en esta fase (`classify-ia` prohibido) |
| valoración | (pendiente) | idem — requiere IA |
| estado_revision | menciones.estado_revision | pendiente / revisado / falso_positivo |

**Sentimiento y valoración quedan pendientes** porque requieren `classify-ia`, explícitamente
prohibido en esta fase de emergencia (no producción, no IA). Se agregan en una fase posterior
autorizada.

## 5. Deduplicación

- `insertMenciones()` ya es idempotente por `(noticia_id, keyword_id)` — nunca duplica menciones.
- A nivel de noticia: `crawl.ts` deduplica por `hash_url` (upsert con `ignoreDuplicates`).
- Para el reporte final, deduplicar adicionalmente por `url_original` normalizada (por si
  el mismo artículo aparece bajo dos noticia_id por variación de query string/tracking).

## 6. Validaciones antes de exportar

- [ ] Confirmar `estado_revision != 'falso_positivo'` antes de incluir en reporte.
- [ ] Confirmar `texto_match` no vacío (evidencia mínima requerida).
- [ ] Confirmar `url_original` válida (no null, formato URL).
- [ ] Confirmar que la keyword no está en modo `activa=false` (evitar señal descontinuada).

## 7. Hoja destino (pendiente)

**Aún no se ha creado ni conectado ninguna hoja de reportes final.** Las hojas operativas
actuales (05/07/08/10) siguen siendo internas/shadow. Se propone (no creada en esta fase):

```
11_Operacion_Sin_PressClipping
```

Columnas propuestas:
```
fecha | run_id | cliente_id | cliente_nombre | estado_operativo | porcentaje_ready |
medios_en_cron | medios_con_noticias_24h | medios_texto_ok | noticias_24h | noticias_7d |
menciones_24h | menciones_7d | ultima_mencion | texto_ok_pct | errores_medios |
siguiente_accion | notas
```

**Actualización 2026-07-11: la tab YA fue creada.** Se implementó `ensureSheetTabAndHeaders()`
en `src/sheets/write.ts` (helper genérico, con lógica pura testeable en `src/sheets/tabPlan.ts`)
que crea la pestaña si no existe, preserva filas si ya existe, y hace **readback real**
(re-lee la cabecera desde la API tras escribir, no confía en la variable local).

### Estado real de `11_Operacion_Sin_PressClipping`

| campo | valor |
|---|---|
| Creada | ✅ Sí (2026-07-11) |
| Sheet ID | `1izEL0y6mGttGawEvpYScMoxB7CKUseKw00rAVW5vGxM` |
| Headers | 23 columnas (ver §4 arriba) |
| Filas exportadas | 64 (CLI-0002: 59, CLI-0001: 5) — ventana 7 días |
| Readback | ✅ mismatch=false |
| Dedupe verificado | ✅ segunda corrida: 0 filas nuevas, 64 duplicados omitidos |

### Exportador: `scripts/export-operational-news-no-pc.ts`

```bash
npm run export-operational-news-no-pc -- --clients=CLI-0001,CLI-0002 --window-days=7 --output=sheet --max-rows=500
```

- `dedupe_key = cliente_id::url_norm::keyword_id` — estable entre corridas.
- Estados: `EXPORTADO`, `DUPLICADO_OMITIDO`, `SIN_TEXTO_LIMPIO`, `REVISAR` (falso positivo
  según `estado_revision`).
- `sentimiento`/`valoracion` quedan vacíos hasta que exista clasificación IA autorizada
  (columna presente, valor pendiente — no bloquea el export).
- `prioridad` viene de `keywords.prioridad` (Alta/Media/Baja del keyword que matcheó).

## 8. Cómo conectar a hoja final Jumex

1. La hoja final de Jumex necesita: filtrar `11_Operacion_Sin_PressClipping` por
   `cliente_id = 'CLI-0001'` (o correr el exportador con `--clients=CLI-0001` solo).
2. Antes de conectar: agregar clasificación de sentimiento (requiere `classify-ia`,
   autorización separada — prohibido en esta fase).
3. Revisar filas con `estado_export = 'REVISAR'` antes de reportar (falsos positivos).
4. Conectar vía script dedicado (no creado aún) que lea `11_Operacion_Sin_PressClipping`
   filtrado por cliente y haga push a la hoja de reportes de Jumex, con su propio readback.

## 9. Cómo conectar a hoja final Patrón

1. Igual que Jumex, filtrando `cliente_id = 'CLI-0002'`.
2. Las keywords `Tequila Patrón`/`Casa Patrón` (alerta=true) deberían priorizarse en el
   reporte — usar columna `requiere_alerta` para ordenar/destacar.
3. Igual que Jumex: pendiente clasificación IA y conexión real a hoja final.

## 9.b Re-enrich controlado (2026-07-11)

Top 5 medios por impacto+volumen (todos con `cuerpo_vacio_pct=100%` en ventana 7d):

| medio_id | medio | notas_7d | impacta | 
|---|---|---|---|
| MED-0157 | El Heraldo de México | 100 | CLI-0002 |
| MED-0153 | Zócalo | 98 | CLI-0001 + CLI-0002 |
| MED-0017 | El Informador | 83 | CLI-0002 |
| MED-0160 | El Diario de Chihuahua | 75 | CLI-0001 |
| MED-0020 | El Imparcial Sonora | 64 | CLI-0001 |

```bash
npm run enrich-news -- --medio-ids=MED-0157,MED-0153,MED-0017,MED-0160,MED-0020 \
  --limit=500 --only-missing-clean-text
```

Resultado: 500 leídas, **487 actualizadas**, 13 sin cambios, 4 fallidas. Controlado (5 medios,
tope de 500 notas total, `--only-missing-clean-text`, sin `--force-refresh-clean-text`).

**Hallazgo importante:** estos 5 medios YA tenían buen texto histórico (82-84% de su catálogo
completo tiene `texto_nota_limpia`). El problema es específico del **backlog reciente**: cada
medio acumula ~400-600 notas sin enriquecer en su historial completo, de las cuales solo una
fracción cae en la ventana de 7 días. El cap de 500 notas (respetando "no re-enrich masivo")
corrigió una parte real pero no vació el backlog completo — se necesitarían más lotes
controlados (mismo comando, en días sucesivos) para cerrar la brecha por completo.

## 10. Riesgos

- Sin clasificación de sentimiento/valoración: el reporte es solo hechos (medio, título,
  keyword, fecha), sin análisis de tono. Aceptable para operación urgente; no para reporte
  ejecutivo final.
- Algunas keywords amplias (`tequila`, `mezcal` tipo `contiene`) pueden generar falsos
  positivos de baja severidad (ej. mención de tequila en artículo no relacionado a
  Patrón/CLI-0002) — requieren revisión humana vía `estado_revision` antes de publicar.
- 20 medios en cron con `cuerpo_vacio_pct=100%` (ver `docs/PRODUCTION_READINESS_PLAN.md`
  §Emergencia) — no bloquea detección por título, pero limita profundidad de contexto.

## 11. Siguiente fase para exportar de verdad

1. ~~Crear helper `ensureSheetTabAndHeaders` con test dedicado.~~ ✅ Hecho.
2. ~~Crear `11_Operacion_Sin_PressClipping` con readback obligatorio.~~ ✅ Hecho.
3. ~~Exportador staging con dedupe.~~ ✅ Hecho (`export-operational-news-no-pc.ts`).
4. Cuando exista clasificación de sentimiento/valoración (fase separada, requiere IA
   autorizada), completar esas columnas en el export.
5. Crear script de conexión a hoja final por cliente (filtrado + push), con su propio
   readback — fuera del alcance de esta fase.
6. Automatizar corrida diaria del exportador (cron), una vez validado 2-3 días manualmente.
