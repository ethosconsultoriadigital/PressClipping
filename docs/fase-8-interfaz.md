# Fase 8 — Interfaz futura (documentación de preparación)

> **Esta fase NO se implementa todavía.** Es la preparación documental para las
> capas de cara al usuario, según la sección 24 del brief. Aquí se define el
> diseño, los contratos y los puntos de extensión —apoyándose en lo ya
> construido (Supabase, FTS, menciones, IA, XML)— para que su construcción
> futura sea incremental y de bajo riesgo.

Cubre: **Dashboard**, **Buscador**, **Filtros**, **Revisión humana**,
**Reportes** y **Alertas**.

---

## 0. Principio y postura arquitectónica

Se mantiene el principio rector del sistema:

> Google Sheets controla · Supabase/PostgreSQL almacena · el código procesa.

La interfaz futura es una **capa de lectura/curación sobre Supabase**, no una
nueva fuente de verdad. No reemplaza el panel operativo de Sheets de un día para
otro: convive con él durante un periodo de comparación (criterio 10 de la
sección 6 del brief).

```
                 ┌─────────────────────────────────────────┐
                 │   Interfaz futura (Fase 8)                │
                 │   Dashboard · Buscador · Revisión         │
                 │   Reportes · Alertas                      │
                 └───────────────┬─────────────────────────┘
                                 │ API de lectura (REST/Edge)
                                 │ + acciones de curación (write acotado)
                 ┌───────────────▼─────────────────────────┐
                 │   Supabase / PostgreSQL (verdad)          │
                 │   noticias · menciones · clusters · …     │
                 │   FTS español · vistas · RLS              │
                 └───────────────▲─────────────────────────┘
                                 │  (sin cambios en el motor)
                 Motor de ingesta/IA (Fases 2-7) sigue escribiendo aquí
```

**Stack sugerido (a decidir al iniciar la fase):** un frontend SPA (Next.js o
similar) consumiendo una API delgada. Dos opciones para la API:

- **Supabase directo + RLS** — el frontend usa la `anon key` y políticas RLS por
  rol/tenant. Mínima infraestructura. Recomendado para el primer dashboard.
- **Cloudflare Worker / capa propia** — si se requiere lógica de servidor,
  caché, o unificar con el endpoint `/read-xml`. Recomendado cuando haya
  multiusuario real o reportes pesados.

> **Prerrequisito transversal:** RLS ya está contemplado en el esquema (el motor
> usa la Service Role Key y la omite). Antes de exponer datos a un navegador hay
> que **definir políticas RLS** y un modelo de roles (ver §7).

---

## 1. Dashboard

Vista ejecutiva de "qué está pasando" con los clientes monitoreados.

**Widgets propuestos:**

| Widget | Fuente de datos | Notas |
|---|---|---|
| Menciones por día (línea) | `menciones.created_at` agregado | filtro por cliente/rango |
| Menciones por cliente (barras) | `menciones` × `clientes` | top N |
| Distribución de sentimiento | `menciones.sentimiento` (IA) | requiere Fase 7 activa |
| Riesgo reputacional | `menciones.riesgo_reputacional` | resalta `alto` |
| Top medios por impactos | `noticias.medio_id` × `medios` | conteo |
| Republicaciones (clusters) | `clusters.total_impactos` | mide alcance de una nota |
| Cola de revisión | `menciones.estado_revision='pendiente'` | enlaza a §4 |
| Alertas abiertas | `menciones.requiere_alerta=true` | enlaza a §6 |
| Salud de ingesta | `logs_ingesta`, `medios.ultimo_estado` | medios en error/bloqueados |

**Preparación recomendada (no implementada):** crear **vistas SQL** materializadas
o normales para no recalcular agregados en el cliente, p. ej.
`vw_menciones_diarias`, `vw_resumen_cliente`, `vw_salud_medios`. Estas vistas se
añadirían como una migración futura (`00XX_vistas_dashboard.sql`).

---

## 2. Buscador

Búsqueda libre sobre el universo histórico de noticias y menciones.

**Ya disponible en la base:** la tabla `noticias` tiene una columna `tsvector`
generada (`fts`) con índice GIN sobre título + subtítulo + resumen + texto, en
configuración `'spanish'` (ver `0001_initial_schema.sql`). El buscador se apoya
directamente en ella.

**Contrato de consulta (futuro):**

```sql
-- Búsqueda full-text con ranking
select n.*, ts_rank(n.fts, q) as rank
from noticias n, websearch_to_tsquery('spanish', :texto) q
where n.fts @@ q
order by rank desc, n.fecha_publicacion desc
limit :limit offset :offset;
```

- `websearch_to_tsquery` permite sintaxis natural (comillas, `-exclusión`, `or`).
- Para coincidencia aproximada / typos se puede sumar `pg_trgm` (extensión ya
  habilitada) con `similarity()` como segundo criterio.

**Buscar dentro de menciones** (lo más usado por PR): combinar el texto con los
filtros de §3 sobre el join `menciones × noticias × clientes × medios`.

---

## 3. Filtros

Conjunto de filtros transversal a dashboard, buscador, revisión y reportes.
**Reutiliza el mismo contrato que el XML** (`src/exporters/xml.ts` →
`FiltrosXml`) para mantener coherencia entre interfaz y exportación:

| Filtro | Columna | Tipo |
|---|---|---|
| Cliente | `clientes.nombre_cliente` / `cliente_id` | selección |
| Keyword | `menciones.keyword` | texto/contiene |
| Medio | `medios.nombre_medio` | selección |
| Grupo de medio | `medios.grupo_medio` | selección |
| Región / Estado | `medios.region` / `noticias.estado` | selección |
| Rango de fechas | `noticias.fecha_publicacion` | desde/hasta |
| Sentimiento | `menciones.sentimiento` | selección (IA) |
| Riesgo | `menciones.riesgo_reputacional` | selección (IA) |
| Tema / Subtema | `menciones.tema` / `subtema` | selección (IA) |
| Estado de revisión | `menciones.estado_revision` | selección |
| Requiere alerta | `menciones.requiere_alerta` | booleano |
| Tipo de match | `menciones.tipo_match` | selección |

**Preparación recomendada:** alimentar los desplegables desde `07_Diccionarios`
(hoy declarada pero sin uso) para que las listas válidas de categorías,
prioridades, estados de revisión y métodos vivan en un único lugar editable.

---

## 4. Revisión humana

Flujo de curación: un analista valida/ajusta lo que el motor y la IA produjeron.

**Estados** (alimentados por `07_Diccionarios`, columna `estado_revision`):

```
pendiente → en_revision → aprobada ──► (exportable a reporte/XML)
                       └→ descartada (falso positivo)
                       └→ requiere_ajuste (corrige keyword/cliente)
```

**Acciones de curación (escritura acotada sobre `menciones`):**

| Acción | Efecto | Columnas |
|---|---|---|
| Aprobar / descartar | cambia estado | `estado_revision` |
| Corregir sentimiento/tema | sobreescribe IA | `sentimiento`, `tema`, `subtema` |
| Marcar/!marcar alerta | ajusta alerta | `requiere_alerta` |
| Reasignar cliente | corrige atribución | `cliente_id` |
| Notas del analista | comentario libre | (columna `notas` futura) |

**Trazabilidad (preparación):** añadir en una migración futura
`revisado_por`, `revisado_at` y, si se requiere auditoría fina, una tabla
`revisiones_log` (append-only) que registre cada cambio. **Nunca** borrar
menciones por revisión: descartar = cambiar estado, preservando el histórico
(coherente con la política anti-borrado de la dedup).

**Relación con el borrado de republicaciones:** la revisión opera sobre
menciones individuales; los `clusters` siguen conservando todos los impactos.

---

## 5. Reportes

Generación de entregables para el cliente final.

**Formatos objetivo:** PDF ejecutivo, Excel (detalle), y el **XML propio** ya
implementado (Fase 6) como formato de intercambio.

**Reutilización de lo existente:**
- El **XML** (`generate-xml` / futuro `/read-xml`) ya filtra por cliente,
  keyword, fecha, medio, región y estado de revisión — sirve como base de datos
  del reporte.
- Para PDF/Excel: una plantilla que consuma las **mismas vistas** del dashboard
  (§1) y los **mismos filtros** (§3), de modo que "lo que ves es lo que se
  exporta".

**Contenido sugerido de un reporte por cliente:**
1. Resumen ejecutivo (conteos, sentimiento agregado, alertas).
2. Top de impactos por relevancia/medio.
3. Detalle de menciones aprobadas (título, medio, fecha, enlace, resumen IA).
4. Republicaciones agrupadas por `cluster_id` (alcance).
5. Anexo: metodología y periodo.

**Preparación recomendada:** definir un endpoint/Job `report:generate` que reciba
`FiltrosXml + formato` y produzca el archivo. El cron de GitHub Actions puede
agendar reportes periódicos (diario/semanal) reutilizando el patrón de
`.github/workflows/ingesta.yml`.

> **Fuera de alcance hasta aprobación** (sección 6 del brief): PDF automático.
> Aquí solo se deja el contrato y el punto de extensión.

---

## 6. Alertas

Notificación proactiva ante menciones críticas.

**Señal ya disponible:** `menciones.requiere_alerta` (calculada en Fase 7
combinando la IA con la marca `alerta` de la keyword — ver
`computeRequiereAlerta`) y `clientes.alertas_activas`.

**Canales objetivo:** email y WhatsApp (sección 1.10 y 6 del brief).

**Arquitectura propuesta (no implementada):**

```
classify-ia escribe requiere_alerta=true
        │
        ▼
 (A) Job alert:dispatch (cron corto)         (B) Supabase webhook / trigger
     lee menciones con requiere_alerta=true       on insert/update de menciones
     y alerta_no_enviada                           → Edge Function → canal
        │
        ▼
   Canal: email (SMTP/API) · WhatsApp (API oficial)
        │
        ▼
   marca alerta_enviada_at (evita reenvíos)
```

- Patrón análogo al de export: una columna futura `alerta_enviada_at` evita
  duplicar envíos (igual que `exportado_sheets`/`exportado_xml`).
- Anti-ruido: respetar `clientes.alertas_activas`, agrupar por cliente/ventana
  de tiempo, y permitir umbral (p. ej. solo `riesgo_reputacional='alto'`).
- WhatsApp requiere API oficial con plantillas aprobadas; queda **fuera del MVP**
  hasta aprobación explícita (sección 6 del brief).

**Preparación recomendada:** migración futura con `alerta_enviada_at` +
`alerta_canal`, y una tabla `alertas_log` para auditoría de envíos.

---

## 7. Seguridad, roles y multiusuario (transversal)

Antes de exponer cualquier dato a un navegador:

- **Activar RLS** en las tablas leídas por la interfaz y escribir políticas por
  rol (lectura para analistas; escritura acotada de curación; admin).
- **Modelo de roles** mínimo: `admin`, `analista`, `lectura`. Multi-tenant por
  cliente si se vende como servicio (filtrar por `cliente_id` en las políticas).
- El **motor sigue usando la Service Role Key** (omite RLS) — no cambia.
- Nunca exponer la Service Role Key al frontend; el navegador usa `anon key`
  + sesión autenticada, o pasa por el Worker.

---

## 8. Resumen de preparaciones sugeridas (para cuando se apruebe la fase)

Ninguna se implementa ahora; se listan como migraciones/puntos de extensión:

- [ ] Vistas SQL de agregación para el dashboard (`vw_*`).
- [ ] Uso real de `07_Diccionarios` para alimentar filtros y estados.
- [ ] Columnas de trazabilidad de revisión (`revisado_por`, `revisado_at`).
- [ ] Columnas/tabla de alertas (`alerta_enviada_at`, `alertas_log`).
- [ ] Políticas RLS + modelo de roles.
- [x] Endpoint `/read-xml` (Worker) como primer servicio de lectura — **implementado** (`worker/`).
- [ ] Job de reportes (`report:generate`) y su cron.

**Criterio de no-regresión:** todo lo anterior es aditivo. El motor de las
Fases 2-7 y sus contratos (Sheets, Supabase, XML) no deben cambiar para
habilitar la interfaz.
