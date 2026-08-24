# MERY GAP CLOSURE — 2026-08-24

**Cliente:** CLI-MERY-TEST (Mery Pozos / Merilyn Gómez Pozos)
**Estado:** shadow only. `alertas_activas=false`. Sin envíos reales.
**Principio rector de esta fase:** el gap frente a la alerta legacy de Google RSS se cierra
mediante **cobertura de fuentes** y **extracción de cuerpo completo**, nunca mediante
keywords temáticas (SIAPA, agua, IEPC, promoción, etc.).

---

## 1. Resumen de la auditoría Ethos vs Google RSS (contexto de entrada)

Reportado por el usuario al iniciar esta fase (auditoría comparativa externa):

| métrica | valor |
|---|---|
| Ethos válido | 13 notas |
| Google RSS válido depurado | 21 notas |
| Coincidencias | 10 |
| Solo Google RSS | 11 |
| Solo Ethos | 3 |
| Gap real depurado estimado | 28.6% |
| Pérdidas reales estimadas | 6 |

Diagnóstico de causa raíz: el gap se explica principalmente por **fuentes locales/regionales
faltantes o inactivas/no capturables**, no por ausencia de cobertura temática. La
infraestructura de comparación legacy vs Ethos ya existía (`scripts/audit-mery-legacy-google-rss.ts`,
tab `19_Mery_Comparativo_GoogleRSS_vs_Ethos`) de una fase previa (commit `23ae247`).

---

## 2. Keywords del cliente — SIN CAMBIOS (confirmación explícita)

Las 12 keywords activas de CLI-MERY-TEST (`KEY-0040`..`KEY-0051`, definidas en
`scripts/tune-mery-pozos-shadow.ts` y documentadas en `docs/PERSONA_PUBLICA_MERY_POZOS_SHADOW.md`)
**no se modificaron en esta fase** y ya cumplían la política correcta antes de empezar:

- Todas son variantes del **nombre/cargo** de la diputada (`Mery Pozos`, `Mery Gómez Pozos`,
  `Merilyn Gómez Pozos`, `diputada Mery Pozos`, `diputada Merilyn Gómez`, etc.).
- **Ninguna** es un tema (SIAPA, agua, alerta sanitaria, IEPC, promoción, Guadalajara en Escena,
  Oblatos, Presupuesto de Egresos 2027, Hacienda, empresariado, Parque Solidaridad).
- Bloqueos anti-homónimo vigentes: "Mery" sola, "Pozos" sola y "Gómez" sola siguen bloqueadas
  (`src/editorial/meryCriteria.ts`, `NOMBRE_EN_TITULO_RE` / `NOMBRE_EN_CUERPO_RE`).

**Confirmación:** no se agregó, modificó ni evaluó ninguna keyword temática en esta fase.
La validación de cliente sigue dependiendo exclusivamente de que aparezca el nombre/cargo
autorizado de Mery Pozos en título, resumen (descripción) o cuerpo completo del artículo.

---

## 3. Auditoría de fuentes (`scripts/audit-mery-gap-sources.ts`)

Script nuevo, read-only, creado en esta fase. Audita catálogo, estado de cron y captura de
cuerpo completo para las fuentes candidatas del gap, sin insertar/actualizar/borrar nada.

```bash
npm run audit-mery-gap-sources
npm run audit-mery-gap-sources -- --skip-probe   # sin fetch en vivo de RSS/sitemap
```

### 3.1 Hallazgo crítico de esta auditoría

El catálogo de configuración `src/config/shadowMedia.ts` (tier `SHADOW_MEDIOS_DAILY_VALIDATED`)
ya tenía desde el commit `35cdfdf` (2026-07-29, "MERY JALISCO PRIORITY") cuatro entradas:
`MED-0201` (Semanario Conciencia Pública), `MED-0202` (A Fondo Jalisco), `MED-0203` (Siker) y
`MED-0204` (Página 24 Jalisco) — **pero los `medio_id` nunca se insertaron en la tabla `medios`
de Supabase**. Resultado: el cron corría "en verde" pero **no capturaba nada** de estas 4
fuentes porque las filas no existían. Esto era un contribuyente directo y silencioso al gap.

### 3.2 Estado por fuente (antes → después de esta fase)

| Fuente | medio_id | Antes | Acción | Después |
|---|---|---|---|---|
| **A Fondo Jalisco** | MED-0202 | Config en cron, **sin fila en Supabase** | RSS verificado en vivo (200 OK, feed real, actualizado hoy) → **insertado en catálogo** | ✅ `OK_EN_CRON`, activo, RSS |
| **Siker** | MED-0203 | Config en cron, **sin fila en Supabase** | RSS verificado en vivo (200 OK) → **insertado en catálogo** | ✅ `OK_EN_CRON`, activo, RSS |
| **Semanario Conciencia Pública** | MED-0201 | Config en cron, **sin fila en Supabase** | RSS verificado en vivo (200 OK) → **insertado en catálogo** (mismo lote ya aprobado) | ✅ `OK_EN_CRON`, activo, RSS |
| **Página 24 Jalisco** | MED-0204 | Config en cron, **sin fila en Supabase** | RSS y sitio base **timeout 3/3 intentos** — NO se insertó | ⚠️ `PENDIENTE_VERIFICACION` — reintentar antes de insertar |
| **AFmedios** | MED-0187 | Ya en catálogo y en cron desde lote previo | Ninguna — ya correcto | ✅ `OK_EN_CRON`, cuerpo completo 20/20 en muestra |
| **Meganoticias Jalisco** | — | No catalogado | Investigado (ver §3.3) | ❌ `NO_VIABLE` |
| **MURAL** | MED-0037 | En catálogo, fuera de cron (paywall) | Ninguna — correcto, no se toca | 🔒 `D_PAGO_CONVENIO_API` |
| **Reforma** | MED-0027 | En catálogo, fuera de cron (paywall) | Ninguna — correcto, no se toca | 🔒 `D_PAGO_CONVENIO_API` |
| UDG TV / Canal 44 | MED-0040 | En catálogo, activo, **fuera de todo cron** | Ninguna (requiere autorización explícita — ver §3.4) | ⏸ `ACTIVAR_EN_CRON` pendiente |
| Notisistema | MED-0129 | En catálogo, **`activo=false`**, fuera de cron | Ninguna | ⏸ `ACTIVAR_EN_CRON` pendiente (revisar por qué está inactivo primero) |
| Tráfico ZMG | MED-0116 | En catálogo, activo, fuera de cron | Ninguna | ⏸ `ACTIVAR_EN_CRON` pendiente |
| Vallarta Independiente | MED-0124 | En catálogo, activo, fuera de cron | Ninguna | ⏸ `ACTIVAR_EN_CRON` pendiente |
| Partidero | MED-0042 | En catálogo, activo, fuera de cron | Ninguna | ⏸ `ACTIVAR_EN_CRON` pendiente |

### 3.3 Meganoticias Jalisco — NO_VIABLE (justificación)

- El medio existe y publica sección Jalisco/Guadalajara real (`meganoticias.mx/guadalajara`).
- Su página de RSS (`meganoticias.mx/index.php/guadalajara/rss`) es un **selector JS de ciudad**
  sin URL de feed directa visible sin ejecutar JavaScript (no se usó Playwright, según restricción).
- `robots.txt` del sitio declara explícitamente:
  ```
  Disallow: */rss
  Disallow: */rss/
  Disallow: */feed
  Disallow: */feed/
  ```
  Es decir, el propio sitio **prohíbe el acceso a sus rutas de RSS/feed** vía robots.txt.
- `sitemap.xml` devuelve error 500 (tanto con `www` como sin `www`).
- **Conclusión:** no viable con el método conservador del proyecto (sin proxy, sin bypass, sin
  evadir restricciones, sin Playwright sin aprobación). Requeriría un extractor HTML directo
  con aprobación explícita — no se implementó en esta fase.

### 3.4 Fuentes `ACTIVAR_EN_CRON` — pendientes de autorización explícita

Estas 5 fuentes (UDG TV/Canal 44, Notisistema, Tráfico ZMG, Vallarta Independiente, Partidero)
**ya existen en el catálogo de Supabase** (se encontraron con sus `medio_id` reales, distintos
a los asumidos originalmente en el lote `35cdfdf`) pero no están en ningún tier de cron. No se
activaron en esta fase porque:

1. No estaban en la lista explícita de esta solicitud (que pidió específicamente A Fondo
   Jalisco, AFmedios, Siker, Meganoticias, MURAL/Reforma).
2. 3 de las 5 (UDG TV, Vallarta Independiente, Partidero) tienen `captura_cuerpo_completo=false`
   en la muestra reciente — activarlas sin revisar el extractor arriesga perder menciones que
   solo aparecen en cuerpo, no en título.
3. Notisistema está `activo=false` en catálogo — requiere decidir primero si reactivarlo.

**Recomendación para la siguiente fase (requiere autorización):**
`npm run catalog-mery-jalisco-priority -- --upsert --patch-shadowmedia` completaría el alta de
cron para estas 5 con sus `medio_id` reales, pero se sugiere primero auditar extracción de
cuerpo (`audit-extraction-quality` o similar) para las 3 con `cuerpo_completo=false`.

---

## 4. Backtest / dry-run controlado (validación de que el cierre es por fuentes, no por temas)

Tras insertar las 3 fuentes verificadas en vivo (A Fondo Jalisco, Siker, Semanario Conciencia
Pública), se ejecutó una prueba controlada y acotada (no crawl masivo: 3 medios, máx. 5 notas
cada uno):

```bash
npm run crawl -- --medio-ids=MED-0201,MED-0202,MED-0203 --max-notas=5
npm run enrich-news -- --medio-ids=MED-0201,MED-0202,MED-0203 --limit=20
npm run detect-mentions -- --dry-run --client=CLI-MERY-TEST --medio-ids=MED-0201,MED-0202,MED-0203 --only-with-text
```

### Resultados

| paso | resultado |
|---|---|
| Crawl | 14 notas nuevas, 0 duplicados, 0 errores |
| Enrich | 14/14 leídas, 14/14 actualizadas, **14/14 con cuerpo completo**, 0 fallidas |
| Detect (dry-run, `--client=CLI-MERY-TEST`) | **4 menciones potenciales** sobre **2 noticias distintas**, 0 insertadas (dry-run real) |

### Las 2 noticias detectadas

Ambas notas son cobertura del mismo evento ("Guadalajara en Escena", festival cultural en
Oblatos) publicadas por las fuentes recién capturadas:

- *"Guadalajara en Escena reúne a miles de jóvenes en Oblatos"* — Semanario Conciencia Pública
- *"Guadalajara en Escena congrega a miles de jóvenes en Oblatos..."* — A Fondo Jalisco

Ambas matchean por `"Mery Pozos"` / `"diputada Mery Pozos"` en el campo `resumen`
(`score=0.6`, `tipo_match=frase_exacta`), porque el texto dice *"el festival impulsado por la
diputada Mery Pozos..."*.

### Por qué esto valida la política correcta

**"Guadalajara en Escena" y "Oblatos" son dos de los términos que el usuario explícitamente
prohibió usar como keywords temáticas.** La detección NO ocurrió porque el sistema buscara esos
términos — ocurrió porque:

1. Se amplió la **cobertura de fuentes** (A Fondo Jalisco y Semanario Conciencia Pública, antes
   sin captura real por el bug de catálogo descrito en §3.1).
2. Se capturó el **cuerpo/resumen completo** de esas notas.
3. El nombre autorizado de la diputada (`Mery Pozos`, `diputada Mery Pozos`) apareció
   naturalmente en ese cuerpo/resumen, y las keywords de nombre ya existentes lo detectaron.

Esto es exactamente el mecanismo que pidió el usuario: **cerrar el gap por fuentes y extracción,
nunca por temas.**

El exportador LIVE Sheet (`scripts/client-live-sheet-export.ts --client-id=CLI-MERY-TEST`,
dry-run) confirma el mismo resultado de forma consolidada (una fila por noticia, sin duplicar
por keyword — fix de la fase anterior), sin escribir nada:

```
noticias_encontradas: 16
menciones_detectadas: 7
revision_humana: 8
```

Ninguna keyword usada en el preview de `menciones_detectadas` es temática; todas son variantes
del nombre/cargo de Mery Pozos.

---

## 5. Qué NO se hizo (guardrails respetados)

- No se agregó ni evaluó ninguna keyword temática (SIAPA, agua, IEPC, promoción, etc.).
- No se activó ningún envío real (email/WhatsApp/Twilio/SMTP). `alertas_activas` sigue en `false`.
- No se hizo `export-results`, `generate-xml` ni `classify-ia`.
- No se tocó `NOTAS ENVIADAS MERYPOZOS` ni `test_pressclipping`.
- No se borraron noticias ni menciones.
- No se limpiaron ni reemplazaron pestañas de Sheets; el dry-run del exportador LIVE no escribió nada.
- No se usó proxy, Playwright ni bypass de paywall. MURAL/Reforma se dejaron intactos
  (`D_PAGO_CONVENIO_API`).
- No se hizo crawl masivo: el crawl controlado fue de 3 medios × máx. 5 notas.
- No se modificó Patrón ni Jumex.
- No se insertaron menciones reales — el detect final fue `--dry-run`.
- No se hizo commit/push — pendiente de revisión del usuario.

---

## 6. Riesgos

| riesgo | nivel | mitigación / nota |
|---|---|---|
| Página 24 Jalisco sigue sin insertar (config "huérfana" en shadowMedia.ts) | Bajo | Reintentar verificación en vivo antes de insertar; no bloquea nada más |
| 5 fuentes `ACTIVAR_EN_CRON` no autorizadas aún | Medio (oportunidad, no riesgo de seguridad) | 3/5 con `cuerpo_completo=false` — revisar extractor antes de subir volumen |
| Notisistema inactivo en catálogo (`activo=false`) | Bajo | Investigar causa de inactivación antes de reactivar |
| Meganoticias Jalisco no viable con método conservador | Bajo (aceptado) | robots.txt prohíbe rutas RSS/feed; requeriría extractor HTML directo con aprobación |
| Volumen del festival "Guadalajara en Escena" podría generar más notas similares en próximos crawls | Bajo | Es cobertura real y correcta (nombre de la diputada aparece genuinamente); no es ruido |

---

## 7. Comandos para correr en GitHub Actions (validación en CI, opcional)

El insert de catálogo y el crawl/enrich/detect controlado ya se ejecutaron localmente contra
Supabase real (ver §3.2 y §4) con resultados confirmados por readback. Si se desea repetir/validar
desde Actions:

```bash
# Auditoría read-only (repetible, no requiere autorización adicional)
gh workflow run mery-priority-media-capture.yml --ref claude/ethos-pr-intelligence-design-q9GzX \
  -f dry_run=true -f max_notas=5 -f enrich_limit=20 -f detect_limit=50 -f max_inserts=0

# Exportador LIVE Sheet dry-run (mismo comando ya validado por el usuario)
gh workflow run client-live-sheet-export.yml --ref claude/ethos-pr-intelligence-design-q9GzX \
  -f dry_run=true -f sheet_id=1rWl-yDibT91AiELV-bkzaFiMTm6HY4JUSlBxiq-eNq8 \
  -f tab_prefix=ETHOS_MERY_CLIENT_TEST -f client_id=CLI-MERY-TEST -f client_name="Mery Pozos" \
  -f window_days=30 -f limit=50 -f max_rows=50
```

---

## 8. Pendiente para la siguiente fase (requiere autorización del usuario)

1. Reintentar verificación en vivo de Página 24 Jalisco (MED-0204) e insertar si responde.
2. Decidir si autorizar `ACTIVAR_EN_CRON` para UDG TV/Canal 44, Tráfico ZMG, Vallarta
   Independiente, Partidero (revisando primero extracción de cuerpo completo) y Notisistema
   (revisando primero por qué está `activo=false`).
3. Evaluar extractor HTML directo para Meganoticias Jalisco si se decide invertir en esa fuente
   pese al robots.txt restrictivo (fuera de alcance sin aprobación explícita).
4. Si el volumen y calidad se sostienen, considerar una corrida real (no dry-run) de
   `detect-mentions --client=CLI-MERY-TEST` para insertar las menciones ya validadas de
   "Guadalajara en Escena", con autorización explícita.
