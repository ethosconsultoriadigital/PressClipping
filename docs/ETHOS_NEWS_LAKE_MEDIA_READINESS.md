# Ethos News Lake — Readiness de captura limpia (TODOS los medios)

_Fase "ETHOS NEWS LAKE — ALL MEDIA CLEAN CAPTURE FOUNDATION" (2026-07-17).
Generado con `npm run audit-all-media-clean-capture-readiness -- --json`
(snapshot 2026-07-17T21:10:52Z). Paginación real (`.range()`), sin truncamiento
(lección de `audit-patron-important-media-readiness.ts`, commit `4c79068`)._

## 1. Arquitectura: captura general YA está separada de detección por cliente

Confirmado leyendo el código (no fue necesario rediseñar nada):

```
CAPTURA GENERAL (scripts/crawl.ts)
  — lee medios activos, RSS→sitemap, dedupe por hash_url, NO filtra por keyword/cliente
        ↓
NOTICIAS LIMPIAS (scripts/enrich-news.ts + src/enrichers/enrichNews.ts)
  — completa título/texto/autor/sección visitando la URL, NO filtra por keyword/cliente
  — tabla `noticias` (mirror: 01_Noticias_Raw)
        ↓
DETECCIÓN POR CLIENTE (scripts/detect-mentions.ts)
  — aplica keywords por cliente_id, escribe en tabla SEPARADA `menciones`
  — tabla `menciones` (mirror: 02_Menciones)
        ↓
CONSOLIDACIÓN EDITORIAL (src/editorial/consolidation.ts)
  — reglas determinísticas (relevancia/grupo_tema/sentimiento), sin IA
        ↓
SALIDAS POR CLIENTE (scripts/export-*-no-pc.ts)
  — tab 11 (raw) → tab 12 (consolidado) → tab 13 (preview Patrón) → NoticiasPatron
```

`crawl.ts` y `enrich-news.ts` no importan ni referencian `keywords`/`clientes` en
ningún punto — capturan y limpian el 100% de lo que el medio publica,
independientemente de si algún cliente lo va a detectar después. Las keywords
solo entran en juego en `detect-mentions.ts`, que lee de `noticias` (ya limpias)
y escribe menciones en una tabla distinta, sin tocar `noticias`. Esto YA es
exactamente el principio operativo pedido — no se necesitó ningún cambio de
arquitectura, solo confirmarlo y documentarlo.

## 2. Resumen general (173 medios en catálogo)

| métrica | valor |
|---|---|
| Total catálogo | 173 |
| En cron (algún tier) | 42 |
| Catálogo sin cron | 121 |
| Bloqueados (403/404/error) | 7 |
| Paywall probable (grupo Reforma) | 3 |
| LISTO_LEYENDO | 14 |
| EN_CRON_TEXTO_MALO | 21 |
| NECESITA_REENRICH_RECIENTE | 3 |
| EN_CRON_SIN_NOTICIAS | 3 |
| BAJO_VALOR | 1 |

**Lectura:** de los 42 medios en cron, solo 14 están completamente listos
(≥70% texto limpio en 7d). La mayoría de los 21 "texto malo" son medios de
**alto volumen** (cientos a miles de notas/7d) donde el cron los captura bien
pero el enrich no alcanza a limpiarlos todos — el mismo patrón estructural ya
documentado para Patrón, ahora confirmado a escala de todo el catálogo. El
verdadero cuello de botella no es cobertura (121 medios en catálogo sin cron es
la oportunidad más grande) sino el ritmo de enrich frente al volumen de crawl.

## 3. Top gaps por volumen (mejor retorno de un re-enrich reciente)

| medio | medio_id | noticias_7d | texto_ok_7d | estado |
|---|---|---|---|---|
| El Heraldo de México | MED-0157 | 1103 | 47% | EN_CRON_TEXTO_MALO (re-enrich aplicado esta fase) |
| El Imparcial Sonora | — | 1083 | 51.4% | EN_CRON_TEXTO_MALO |
| El Informador | MED-0017 | 847 | 57% | EN_CRON_TEXTO_MALO (mejorando, re-enrich fase anterior) |
| El Diario de Chihuahua | — | 778 | 51% | EN_CRON_TEXTO_MALO |
| Zócalo | — | 766 | 53% | EN_CRON_TEXTO_MALO |
| La Razón de México | MED-0034 | 655 | 52.1% | EN_CRON_TEXTO_MALO (re-enrich aplicado esta fase) |
| La Crónica de Hoy | — | 611 | 40.9% | EN_CRON_TEXTO_MALO |
| El Economista | MED-0001 | 607 | 54% | EN_CRON_TEXTO_MALO (mejorando, re-enrich fase anterior) |
| Vanguardia | MED-0155 | 521 | 50.7% | EN_CRON_TEXTO_MALO |
| ContraRéplica | — | 451 | 31.5% | EN_CRON_TEXTO_MALO |
| El Sol de México | MED-0158 | 364 | 44.5% | EN_CRON_TEXTO_MALO |
| El Financiero | MED-0156 | 346 | 49.7% | EN_CRON_TEXTO_MALO (re-enrich aplicado esta fase) |
| Forbes México | MED-0145 | 225 | 28% | NECESITA_REENRICH_RECIENTE |

**Nota sobre los porcentajes:** son una foto de una ventana rodante de 7 días
con cron activo escribiendo continuamente — dos snapshots tomados minutos
aparte pueden variar varios puntos por el denominador cambiante, no porque el
re-enrich haya "empeorado" nada. La evidencia confiable es la salida directa
de `enrich-news` (ver §5): 100/100, 100/100 y 98/100 notas realmente
actualizadas en El Heraldo/La Razón/El Financiero respectivamente.

## 4. Medios nacionales prioritarios (lista de la fase)

| medio | en_catálogo | en_cron | estado | acción |
|---|---|---|---|---|
| El Universal | sí (MED-0011) | no | BLOQUEADO (404) | reparar fuente |
| Reforma | sí (MED-0027) | no | PAYWALL_NO_VIABLE | fuera por política, no forzar |
| Milenio | sí (MED-0030) | sí | LISTO_LEYENDO | mantener |
| Excélsior | sí (MED-0028) | sí | LISTO_LEYENDO | mantener |
| El Financiero | sí (MED-0156) | sí | EN_CRON_TEXTO_MALO | re-enrich aplicado, monitorear |
| El Economista | sí (MED-0001) | sí | EN_CRON_TEXTO_MALO (mejorando) | ya recibió 2 rondas de re-enrich |
| Forbes México | sí (MED-0145) | sí | NECESITA_REENRICH_RECIENTE | candidato próximo lote |
| Expansión | sí (MED-0159) | sí | NECESITA_REENRICH_RECIENTE | candidato próximo lote |
| El Heraldo de México | sí (MED-0157) | sí | EN_CRON_TEXTO_MALO | re-enrich aplicado, monitorear |
| La Jornada | sí (MED-0029) | no | BLOQUEADO (403) | reparar fuente |
| La Razón de México | sí (MED-0034) | sí | EN_CRON_TEXTO_MALO | re-enrich aplicado, monitorear |
| 24 Horas | sí (MED-0035) | no | CATALOGO_NO_CRON | candidato a cron |
| Proceso | sí (MED-0031) | sí | EN_CRON_TEXTO_MALO | candidato próximo lote |
| Animal Político | sí | no | CATALOGO_NO_CRON | candidato a cron |
| Aristegui Noticias | sí (MED-0008) | no | CATALOGO_NO_CRON | candidato a cron |
| LatinUS | no | no | NO_CATALOGADO | evaluar alta |
| Uno TV | sí (MED-0025) | sí | LISTO_LEYENDO | mantener |
| Publimetro | sí (MED-0053) | sí | LISTO_LEYENDO | mantener |
| El Sol de México | sí (MED-0158) | sí | EN_CRON_TEXTO_MALO | candidato próximo lote |
| El Informador | sí (MED-0017) | sí | EN_CRON_TEXTO_MALO (mejorando) | ya recibió 2 rondas de re-enrich |
| Mural | sí (MED-0037) | no | PAYWALL_NO_VIABLE | fuera por política |
| NTR Guadalajara | sí | no | CATALOGO_NO_CRON | candidato a cron |
| Milenio Jalisco/Guanajuato | resuelve a MED-0030 | sí | (mismo Milenio nacional) | sin ediciones regionales separadas |
| Quadratín Jalisco | sí | no | CATALOGO_NO_CRON | candidato a cron |
| AF Medios | no | no | NO_CATALOGADO | evaluar alta |
| Líder Informativo | sí | no | CATALOGO_NO_CRON | candidato a cron |
| Periódico Correo | sí (MED-0164) | sí | LISTO_LEYENDO | mantener (caballo de batalla Patrón) |
| El Sol de Irapuato | sí (MED-0169) | sí | LISTO_LEYENDO | mantener |
| AM León | sí (MED-0172) | sí | LISTO_LEYENDO | mantener (alta reciente) |
| Zona Franca | no | no | NO_CATALOGADO | evaluar alta |
| Revista Espejo | sí (MED-0066) | sí | LISTO_LEYENDO | mantener |
| Vanguardia | sí (MED-0155) | sí | EN_CRON_TEXTO_MALO | candidato próximo lote |
| **COFEPRIS** | **no** | no | NO_CATALOGADO | evaluar como fuente institucional (patrón CRT) |
| **CRT** | sí (MED-0173) | sí | LISTO_LEYENDO | mantener (alta reciente) |
| **CNIT** | **no** | no | NO_CATALOGADO | evaluar como fuente institucional (patrón CRT) |

## 5. Re-enrich reciente ejecutado esta fase (3 medios, `--recent-first --window-days=7`)

| medio | notas leídas | actualizadas | con texto limpio | fallidas |
|---|---|---|---|---|
| El Heraldo de México (MED-0157) | 100 | 100 | 100 | 0 |
| La Razón de México (MED-0034) | 100 | 100 | 100 | 0 |
| El Financiero (MED-0156) | 100 | 98 | 98 | 2 |

300 notas procesadas, 298 con texto limpio nuevo. Máximo 100 por medio, sin
force-refresh, sin crawl masivo — cumple las reglas de la fase.

## 6. Captura general — tiers existentes, ya corriendo automáticamente

No se forzó un re-crawl manual: se confirmó vía `gh run list` que ambos tiers
ya corrieron automáticamente y con éxito desde el último cambio:
- **Nacional B** (Milenio incluido): corrida automática 2026-07-17T19:39Z,
  Milenio insertó **87 noticias nuevas** en un solo ciclo, gate detect limpio
  (`potenciales=3, limpio=true`).
- **Daily-validated** (AM León/CRT incluidos): corrida automática diaria
  2026-07-17T14:15Z, exitosa.

Repetir el crawl manualmente minutos después habría sido redundante (mismo
efecto, más carga) — se prefirió verificar el resultado real de la corrida
automática, que es la señal más honesta de que el sistema funciona sin
intervención.

## 7. Siguiente lote recomendado (NO ejecutado — requiere autorización)

1. Re-enrich reciente de Forbes México (MED-0145, 225 notas/7d, 28%) y
   Expansión (MED-0159), ambos `NECESITA_REENRICH_RECIENTE`.
2. Evaluar alta a cron de los ~121 medios `CATALOGO_NO_CRON` — empezar por los
   de mayor prioridad ya catalogada (Reforma/Mural quedan fuera por paywall;
   Animal Político, Aristegui, 24 Horas, NTR Guadalajara son candidatos
   técnicamente viables sin paywall conocido).
3. Evaluar catalogar COFEPRIS y CNIT como fuentes institucionales primarias
   (mismo patrón que CRT: verificar sitemap/RSS público antes de dar de alta).
4. Reparar El Universal (404) y La Jornada (403).

## 8. NATIONAL MEDIA COVERAGE RAMP — seguimiento (2026-07-20)

Ejecutado: Aristegui Noticias agregada a cron (único viable de 4 candidatos
evaluados), El Universal reparado (feed alterno real encontrado y
verificado), 5 medios más con re-enrich reciente. **Segundo bug de
paginación encontrado y corregido** en este mismo script (fetch global capado
en 50,000 filas sin error — corregido a paginación por medio_id). Detalle
completo, incluyendo la recomendación estructural más importante de la fase
(el re-enrich manual no es durable para medios >1000 notas/semana), en
`docs/NATIONAL_MEDIA_COVERAGE_MASTER.md`.
