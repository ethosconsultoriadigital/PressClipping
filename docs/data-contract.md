# Contrato de datos — Sheets ↔ Supabase ↔ XML

Este documento es la fuente de verdad del mapeo entre las pestañas de Google
Sheets, las tablas de Supabase y la salida XML. La sincronización (Fase 2) mapea
**por nombre de cabecera** (no por posición), por lo que las columnas pueden
reordenarse en la Sheet sin romper el sistema, pero **los nombres deben coincidir**.

## Convenciones

- Listas multivalor en una celda: separadas por `|` (p.ej. `marca1|marca2`).
- Booleanos en Sheets: `TRUE`/`FALSE` (también se aceptan `sí/no`, `1/0`).
- Fechas: se normalizan a UTC (`timestamptz`) con `luxon`.

## 01_Medios → tabla `medios`

| Columna Sheet | Columna DB | Tipo | Notas |
|---|---|---|---|
| medio_id | medio_id | text (PK) | Identificador estable del medio |
| nombre_medio | nombre_medio | text | |
| grupo_medio | grupo_medio | text | |
| url_base | url_base | text | |
| pais | pais | text | Default `MX` |
| estado | estado | text | |
| municipio | municipio | text | |
| region | region | text | |
| categoria | categoria | text | |
| prioridad | prioridad | text | Ver 07_Diccionarios |
| activo | activo | boolean | Solo se procesan `TRUE` |
| metodo_extraccion | metodo_extraccion | text | rss / sitemap / secciones / html / api |
| rss_url | rss_url | text | |
| sitemap_url | sitemap_url | text | |
| secciones_urls | secciones_urls | text | Lista `|` |
| buscador_url | buscador_url | text | |
| requiere_javascript | requiere_javascript | boolean | `TRUE` → fuera del MVP |
| requiere_proxy | requiere_proxy | boolean | `TRUE` → fuera del MVP |
| frecuencia_minutos | frecuencia_minutos | integer | |
| ultimo_scrapeo | ultimo_scrapeo | timestamptz | Escrito por el motor |
| ultimo_estado | ultimo_estado | text | Escrito por el motor |
| ultimo_error | ultimo_error | text | Escrito por el motor |
| notas_tecnicas | notas_tecnicas | text | |

## 02_Keywords → tabla `keywords`

| Columna Sheet | Columna DB | Notas |
|---|---|---|
| keyword_id | keyword_id (PK) | |
| cliente_id | cliente_id (FK) | |
| cliente | cliente | Texto de apoyo |
| keyword | keyword | |
| alias_o_variantes | alias_o_variantes | Lista `|` |
| tipo_keyword | tipo_keyword | exacta / frase_exacta / contiene / booleana / exacta_contextual |
| regla | regla | Expresión para `booleana` |
| activa | activa | Solo se procesan `TRUE` |
| prioridad | prioridad | |
| alerta | alerta | boolean |
| contexto_incluir | contexto_incluir | Lista `|` |
| contexto_excluir | contexto_excluir | Lista `|` |
| notas | notas | |

## 03_Clientes → tabla `clientes`

| Columna Sheet | Columna DB | Notas |
|---|---|---|
| cliente_id | cliente_id (PK) | |
| nombre_cliente | nombre_cliente | |
| industria | industria | |
| marcas | marcas | Lista `|` |
| competidores | competidores | Lista `|` |
| voceros | voceros | Lista `|` |
| temas_sensibles | temas_sensibles | Lista `|` |
| activo | activo | |
| prioridad_ia | prioridad_ia | |
| alertas_activas | alertas_activas | boolean |
| notas | notas | |

## 04_Configuracion → tabla `configuracion` (llave/valor)

| clave | tipo lógico | default |
|---|---|---|
| frecuencia_global_minutos | int | 60 |
| max_notas_por_medio_por_corrida | int | 25 |
| usar_ia | bool | false |
| generar_xml_propio | bool | true |
| base_historica | text | supabase |
| sheets_es_panel_control | bool | true |
| retencion_logs_dias | int | 90 |
| modo_mvp | bool | true |

## 05_Logs ← tabla `logs_ingesta`

El motor **escribe** aquí (no lee): fecha_hora, fuente_id, medio_id, accion,
nivel, mensaje, urls_detectadas, notas_nuevas, duplicados, errores, duracion_ms,
ejecutado_por.

## 06_Resultados ← tabla `menciones` (+ join a `noticias`)

Vista operativa, **no** histórico. El motor escribe: mencion_id, noticia_id,
fecha_publicacion, fecha_captura, cliente, keyword, medio, estado, region,
titulo, url_original, resumen, texto_match, sentimiento, relevancia, tema,
subtema, requiere_alerta, estado_revision, exportado_xml, notas.

## 07_Diccionarios (referencia)

Listas válidas para: métodos de extracción, prioridades, reglas de keyword,
estados de revisión, categorías. Alimentan los `CHECK` y la validación zod.

## Salida XML propia

```xml
<pressclipping_ethos>
  <nota>
    <id>...</id>
    <cliente>...</cliente>
    <keyword>...</keyword>
    <fecha_publicacion>...</fecha_publicacion>
    <medio>...</medio>
    <titulo>...</titulo>
    <texto>...</texto>
    <url_original>...</url_original>
    <url_archivo>...</url_archivo>
    <sentimiento>...</sentimiento>
    <relevancia>...</relevancia>
  </nota>
</pressclipping_ethos>
```

Filtros futuros: `cliente`, `keyword`, `desde`/`hasta`, `medio`, `region`,
`estado_revision`.
