# Puente de Reportes — Jumex (CLI-0001) y Patrón/Bacardí (CLI-0002)

_Creado 2026-07-11 en el contexto de la emergencia de reemplazo de PressClipping._
_Documenta el camino hacia exportar resultados a una hoja de reportes final. NO conecta
salida real todavía — solo especifica campos, origen y validaciones._

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

**Por qué no se creó en esta fase:** no existe actualmente un helper seguro y probado para
crear pestañas nuevas en el spreadsheet (`getOutputTab` solo lee pestañas existentes; crear
una requeriría código nuevo sin testear, en medio de una fase etiquetada "no romper
producción"). Se recomienda crear y probar ese helper en una fase separada, no urgente.

## 8. Siguiente fase para exportar de verdad

1. Crear helper `ensureOutputSheetExists(title, headers)` con test dedicado (nuevo, no
   existe hoy) — antes de usarlo en producción.
2. Crear `11_Operacion_Sin_PressClipping` con ese helper + readback obligatorio.
3. Escribir snapshot diario (cliente, estado_operativo, métricas) — reutilizando
   `audit-operational-readiness-no-pc.ts`.
4. Cuando exista clasificación de sentimiento/valoración (fase separada, requiere IA
   autorizada), agregar esas columnas al reporte.
5. Recién entonces conectar a la hoja de reportes final del cliente (fuera del alcance
   de este documento).
