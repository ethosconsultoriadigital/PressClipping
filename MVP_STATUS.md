# Estado del MVP técnico — PressClipping (Ethos PR Intelligence)

**Fecha de validación:** 2026-06-09
**Validado por:** ejecución local controlada (`RUN_BY=local`)
**Resultado global:** MVP técnico validado de extremo a extremo, sin IA y sin alertas.

---

## 1. Resumen ejecutivo

El flujo completo Sheets → Supabase → ingesta → detección → exportación → XML quedó
validado con datos reales, en modo controlado y sin efectos peligrosos:

- Lectura de Google Sheets: OK
- Conexión Supabase + migraciones aplicadas: OK
- Sincronización de panel (`sync-sheets`): OK
- Diagnóstico de medios (`validate:media --limit=144`): OK
- Primera ingesta real limitada (`crawl --limit=5 --solo-validados`): OK
- Detección de menciones (`detect-mentions`): OK (validada con keyword temporal)
- Exportación a Sheets (`export-results`): OK
- Generación de XML (`generate-xml`): OK
- IA: **no ejecutada**
- WhatsApp / correos / alertas externas: **no ejecutadas**
- Errores visibles: **0**

---

## 2. Comandos ejecutados y resultados

| Comando | Resultado |
|---|---|
| `npm run validate:supabase` | OK — tablas visibles y pobladas |
| `npm run sync-sheets` | OK — medios/clientes/keywords sincronizados |
| `npm run validate:media -- --limit=144` | OK — 136 diagnosticados, sin guardar noticias |
| `npm run crawl -- --dry-run --limit=10 --solo-validados` | OK — 62 incluidos, plan correcto |
| `npm run crawl -- --limit=5 --solo-validados` | OK — 500 URLs, 390 noticias nuevas, 100 dup, 0 err |
| `npm run detect-mentions` | OK — 390 analizadas, 2 menciones (con keyword temporal) |
| `npm run export-results` | OK — 2 menciones a `06_Resultados`, 11 logs a `05_Logs` |
| `npm run generate-xml` | OK — XML con 2 menciones |

### Diagnóstico de medios (`validate:media --limit=144`)

- total: 144 · procesables: 136 · inactivos: 2 · duplicados: 6
- `ok`: 0 · `parcial`: 62 · `error`: 59 · `sin_fuente`: 15 · especiales: 66

---

## 3. Resultados actuales (estado de datos)

| Métrica | Valor |
|---|---|
| Medios en Supabase | 144 |
| Clientes | 3 |
| Keywords activas | 4 (originales) |
| Noticias | 390 |
| Menciones | 2 |
| Menciones exportadas a `06_Resultados` | 2 |
| Logs exportados a `05_Logs` | 11 |
| XML generado | Sí |
| Keyword temporal `KEY-TEST-001` (`Gas Natural`) | **Desactivada** (conservada para trazabilidad) |

**Archivo XML generado (local):**
`output/pressclipping-2026-06-09T21-40-19-244Z.xml`
(ruta absoluta: `C:\Users\Juanjo\ProyectosCursor\PressClipping\PressClipping\output\pressclipping-2026-06-09T21-40-19-244Z.xml`)

> Nota: las 2 menciones provienen de la prueba con la keyword temporal `Gas Natural`
> sobre el cliente `CLI-0003` (Reforma laboral). La keyword ya quedó desactivada.

---

## 4. Qué ya funciona

- Sincronización Sheets → Supabase.
- Diagnóstico de medios no destructivo (probe RSS/sitemap) y escritura de
  `08_Validacion_Medios` y `09_Medios_Especiales`.
- Selección segura de medios para crawl (filtros duros + diagnóstico).
- Ingesta RSS/sitemap con dedup por `hash_url` y logging por medio.
- Motor de detección de menciones (validado: regla `frase_exacta`, match en título, score 1.0).
- Exportación de menciones y logs a Google Sheets.
- Generación de XML `<pressclipping_ethos>`.

---

## 5. Qué NO se ha probado todavía

- Clasificación con IA (`classify-ia`) — intencionalmente apagada.
- Alertas (WhatsApp / correo) — no implementadas/activadas en estas pruebas.
- `generate-xml -- --marcar` (marcar `exportado_xml`): el XML actual **no** marcó `exportado_xml`.
- Crawl amplio (más de 5 medios) o sin filtro `--solo-validados`.
- Medios diagnosticados como `error`, `sin_fuente` o `especial`.
- Extracción de texto completo (`texto_extraido` queda null por política MVP).
- Endpoint XML del Cloudflare Worker (`worker/`).
- GitHub Actions (no se ha ejecutado ningún workflow).

---

## 6. Flujo manual seguro (orden recomendado)

Ejecutar en este orden, revisando el resultado de cada paso antes del siguiente:

```bash
npm run validate:supabase
npm run validate:sheets
npm run validate:media -- --limit=144
npm run crawl -- --dry-run --limit=10 --solo-validados
npm run crawl -- --limit=5 --solo-validados
npm run detect-mentions
npm run export-results
npm run generate-xml
```

**Importante:** el `crawl` normal sin filtros (`npm run crawl`) **NO debe usarse todavía**.
Siempre usar `--solo-validados` y un `--limit` pequeño hasta ampliar la cobertura validada.

---

## 7. Comandos prohibidos por ahora

- `npm run crawl` sin `--solo-validados` y sin `--limit` (crawl masivo).
- `npm run classify-ia` (IA apagada hasta aprobación).
- Cualquier envío de alertas (WhatsApp / correo).
- Ejecutar el workflow `Ingesta` de GitHub Actions (ver sección 9).
- `worker:deploy` (publicar el endpoint XML) hasta revisión.

---

## 8. Riesgos conocidos

1. **Workflow `Ingesta` con cron horario** corre `crawl` sin filtros + `classify-ia`
   automáticamente cada hora si los Secrets están configurados (detalle en sección 9). **Riesgo alto.**
2. **Cobertura de medios baja:** solo 62 medios `parcial` usables; 59 `error`, 15 `sin_fuente`,
   66 especiales. La mayoría de fuentes aún no son confiables.
3. **Sin texto completo:** el matching depende de `titulo`/`resumen`; muchos `resumen` son null,
   lo que reduce la tasa de detección.
4. **`detect-mentions` marca noticias como procesadas:** reanalizar requiere reabrir
   `menciones_procesado=false` (operación controlada, ya usada en la prueba).
5. **Keyword temporal en Supabase, no en la Sheet:** un `sync-sheets` futuro podría
   reintroducir/alterar el estado si se gestiona desde la hoja. Hoy está desactivada.
6. **Datos de prueba mezclados:** las 390 noticias y 2 menciones son de prueba; decidir
   cuándo aislarlas/limpiarlas antes de operación real.

---

## 9. Workflows de GitHub Actions (revisión, NO ejecutados)

> Solo se inspeccionaron los archivos. **No se ejecutó ningún workflow.**

### `.github/workflows/ingesta.yml` — "Ingesta" ⚠️ RIESGO ALTO
- `schedule`: **sí** — `cron: '0 * * * *'` (cada hora, UTC).
- `workflow_dispatch`: sí.
- Comandos: `sync-sheets` → **`crawl` (sin filtros)** → `detect-mentions` →
  **`classify-ia`** → `export-results`.
- Riesgo operativo: **alto**. Si los Secrets del repo están configurados, este workflow
  hará crawl masivo y clasificación con IA automáticamente cada hora, justo lo que se
  pidió evitar. **Recomendación: desactivar el `schedule` (dejar solo `workflow_dispatch`)
  hasta aprobación.** No se modifica sin tu visto bueno (patch propuesto aparte).

### `.github/workflows/validacion.yml` — "Validación del sistema" ✅ Seguro
- `schedule`: no.
- `workflow_dispatch`: sí (con inputs `media_limit`, `media_priority`).
- Comandos: `typecheck`, `test`, `healthcheck`, `validate:supabase`, `validate:sheets`,
  `validate:media`. Solo lectura, sin efectos en datos.
- Riesgo operativo: bajo.

### `.github/workflows/ci.yml` — "CI" ✅ Seguro
- `schedule`: no. Se dispara en `push` y `pull_request`.
- Comandos: `typecheck`, `test`. Sin acceso a datos productivos.
- Riesgo operativo: bajo.

---

## 10. Pendientes técnicos

- [ ] Agregar flag `--max-notas` a `crawl` (límite de notas por medio por corrida).
- [ ] Mejorar extracción de texto completo (`texto_extraido`).
- [ ] Revisar medios con `error` (59).
- [ ] Revisar medios `sin_fuente` (15).
- [ ] Crear parsers especiales para los 66 medios especiales.
- [ ] Probar `generate-xml -- --marcar` (marcar `exportado_xml`).
- [ ] Preparar workflow manual de GitHub Actions (solo `workflow_dispatch`).
- [ ] Evitar GitHub Actions automático cada hora hasta aprobación (desactivar `schedule` de `ingesta.yml`).
- [ ] Probar IA en dry-run después.
- [ ] Probar alertas después.
- [ ] Limpiar o aislar datos de prueba cuando se decida.

---

## 11. Siguiente fase recomendada

**Asegurar la operación antes de ampliar funcionalidad:** desactivar el `schedule`
horario del workflow `Ingesta` (dejándolo en `workflow_dispatch` manual) para eliminar
el riesgo de crawl masivo + IA automáticos. Hecho eso, ampliar gradualmente la cobertura
de medios validados y, por separado, probar IA en modo dry-run.
