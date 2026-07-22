# National Media Coverage Master

_Fase "NATIONAL MEDIA COVERAGE RAMP + JUMEX STAGING PRODUCTION CRITERIA"
(2026-07-20). Generado con `npm run audit-all-media-clean-capture-readiness --
--json` tras corregir un segundo bug de paginación (ver §5)._

## 1. Resumen (173 medios en catálogo)

| métrica | valor |
|---|---|
| En cron | 44 (+2 desde la fase anterior: Aristegui, El Universal) |
| Catálogo sin cron | 120 |
| LISTO_LEYENDO | 15 |
| EN_CRON_TEXTO_MALO | 6 |
| NECESITA_REENRICH_RECIENTE | 18 |
| NECESITA_REPARAR_FUENTE | 1 |
| EN_CRON_SIN_NOTICIAS | 3 |
| Bloqueados | 6 (−1: El Universal reparado) |
| Paywall probable | 3 |
| Bajo valor | 1 |

## 2. Lista nacional prioritaria (35 medios + fuentes sectoriales)

| medio | en_catálogo | en_cron | lee notas | texto limpio | bloqueado/paywall | acción |
|---|---|---|---|---|---|---|
| El Universal | sí | **sí (nuevo)** | sí | — | **reparado** (era 404) | mantener, validar próximos días |
| Reforma | sí | no | no | no | paywall confirmado (403) | fuera por política |
| Milenio | sí | sí | sí | sí | no | mantener |
| Excélsior | sí | sí | sí | sí | no | mantener |
| El Financiero | sí | sí | sí | parcial (34.1%) | no | re-enrich reciente (2da ronda) |
| El Economista | sí | sí | sí | parcial (30.6%) | no | re-enrich reciente (2da ronda) |
| Forbes México | sí | sí | sí | parcial (57.5%) | no | re-enrich reciente aplicado, mejorando |
| Expansión | sí | sí | sí | **sí (80%+)** | no | re-enrich reciente aplicado — LISTO |
| El Heraldo de México | sí | sí | sí | parcial (28%) | no | volumen extremo (1938/7d), re-enrich no alcanza |
| La Jornada | sí | no | no | no | bloqueado (403); alterno encontrado NO confiable (403 intermitente, solo categorías) | requiere más trabajo, no reparado |
| La Razón de México | sí | sí | sí | parcial (27.1%) | no | re-enrich reciente (2da ronda) |
| 24 Horas | sí | no | no | no | **403 confirmado de nuevo** | fuera, bloqueado |
| Proceso | sí | sí | sí | parcial (20.3%) | no | candidato próximo lote |
| Animal Político | sí | no | no | no | sitemap devuelve página "offline" (no confiable) | requiere investigación adicional |
| Aristegui Noticias | sí | **sí (nuevo)** | sí | sí | no | mantener, alta reciente |
| LatinUS | **sí (MED-0190)** | no (script DIRECT propio) | pendiente crawl | — | B_PUBLICO_DIRECT | **CATALOGADO 2026-07-22** — extractor DIRECT `crawl-direct-latinus.ts`, pendiente crawl inicial |
| Uno TV | sí | sí | sí | sí | no | mantener |
| Publimetro | sí | sí | sí | sí | no | mantener |
| El Sol de México | sí | sí | sí | parcial (34.6%) | no | re-enrich reciente aplicado |
| El Informador | sí | sí | sí | parcial (34.5%) | no | re-enrich reciente (2da ronda) |
| Mural | sí | no | no | no | paywall confirmado (403, grupo Reforma) | fuera por política |
| NTR Guadalajara | sí | no | no | no | sitemap solo tiene secciones, no artículos | requiere extracción directa (no quick win) |
| Milenio Jalisco/Guanajuato | sí | sí | sí | sí | — | resuelve a Milenio nacional (sin ediciones separadas) |
| Quadratín Jalisco | sí | no | — | — | — | candidato a cron |
| AF Medios | **sí (MED-0187)** | **sí** | sí | 77%+ | no | **alta 2026-07-20 — LISTO** |
| Líder Informativo | sí | no | — | — | — | candidato a cron |
| Periódico Correo | sí | sí | sí | sí | no | mantener (caballo de batalla Patrón) |
| El Sol de Irapuato | sí | sí | sí | sí | no | mantener |
| AM León | sí | sí | sí | sí | no | mantener |
| Zona Franca | no | no | — | — | — | evaluar alta |
| Vanguardia | sí | sí | sí | parcial (18.7%) | no | candidato próximo lote |
| Revista Espejo | sí | sí | sí | sí | no | mantener |
| COFEPRIS | no | no | — | — | gob.mx portal complejo, sin sitemap COFEPRIS-específico identificable | NO catalogado — requiere investigación dedicada |
| CRT | sí | sí | sí | sí | no | mantener (alta reciente) |
| CNIT | **sí (MED-0188)** | no (script DIRECT propio) | pendiente crawl | — | B_PUBLICO_DIRECT | **CATALOGADO 2026-07-22** — extractor DIRECT implementado (`crawl-direct-cnit.ts`), pendiente crawl inicial |

## 3. Sub-lote nacional ejecutado (máx. 4 candidatos evaluados, solo 1 viable + 1 reparado)

Evaluados: Animal Político, Aristegui Noticias, 24 Horas, NTR Guadalajara.

- **Aristegui Noticias (MED-0008):** ÚNICO viable de forma limpia. `news-sitemap.xml` verificado en vivo (artículos del mismo día). Agregado a `SHADOW_MEDIOS_NACIONALES_B`. Primer crawl real: **53 noticias nuevas, 0 duplicados, 0 errores**, gate detect limpio.
- **24 Horas:** confirmado bloqueado (403) — mismo estado que hace semanas.
- **Animal Político:** su sitemap de noticias devuelve una página de "archivo offline" (placeholder), no artículos reales — no confiable sin más investigación.
- **NTR Guadalajara:** su `sitemap.xml` solo lista páginas de sección (no URLs de artículos) — necesitaría extracción directa, no el patrón estándar.

**Bonus no planeado:** El Universal (BLOQUEADO por 404 desde hace semanas) se reparó en esta misma fase — `robots.txt` reveló un feed alterno real de Arc Publishing (`/arc/outboundfeeds/news/?outputType=xml`), verificado en vivo y con crawl real (20/20 notas, 0 errores). Agregado también a `SHADOW_MEDIOS_NACIONALES_B`.

## 4. Re-enrich reciente — revisión y siguiente lote de 5

**Revisión de la ronda anterior (El Heraldo/La Razón/El Financiero, hace 3 días):** los tres **degradaron de nuevo** (47.6%→28-34%) — confirma que un lote de 100 notas no puede seguirle el paso a medios con miles de notas/semana. Ver §5.

**Siguiente lote ejecutado (5 medios, 100 notas c/u, 499/500 con texto limpio):**

| medio | antes | después | notas | estado final |
|---|---|---|---|---|
| Expansión (MED-0159) | 24.5% | **80.2%** | 100/100 | LISTO_LEYENDO (bajo volumen, funcionó) |
| Forbes México (MED-0145) | 26.6% | 57.5% | 100/100 | EN_CRON_TEXTO_MALO (mejorando) |
| El Sol de México (MED-0158) | 33.1% | 34.6% | 100/100 | EN_CRON_TEXTO_MALO (volumen medio, apenas se mueve) |
| El Heraldo (MED-0157), 2da ronda | 31.4% | 28% | 100/100 | NECESITA_REENRICH_RECIENTE (volumen extremo: 1938/7d) |
| El Informador (MED-0017), 2da ronda | 37.8% | 34.5% | 99/100 | EN_CRON_TEXTO_MALO (volumen extremo: 1211/7d) |

**Patrón claro:** el re-enrich reciente funciona genuinamente bien en medios de volumen bajo-medio (Expansión, Forbes) pero es insuficiente para medios de volumen extremo (El Heraldo, El Informador, El Economista, La Razón — todos con 1000+ notas/semana). Ver recomendación en §7.

## 5. Segundo bug de paginación encontrado y corregido

El script general (`audit-all-media-clean-capture-readiness.ts`) hacía UN fetch
global paginado sobre toda la tabla `noticias` (los 173 medios a la vez). En
una corrida real quedó **capado exactamente en 50,000 filas** sin error
visible — probablemente un límite de tiempo/tamaño de PostgREST/Supabase para
queries muy largas (varios minutos). Esto producía números incorrectos para
los medios de mayor volumen (El Heraldo reportó 17-228 cuando el real,
verificado aparte, era ~1935-1938).

**Corregido:** ahora pagina **por medio_id** (como ya hacía el script
específico de Patrón, corregido en la fase anterior), consultando solo los
~44 medios en cron. Verificado: El Heraldo ahora reporta 1938, consistente
con la verificación manual directa.

## 6. Fuentes oficiales (COFEPRIS, CNIT) — no catalogadas esta fase

Ninguna cumplió el criterio de viabilidad limpia (sitemap público con
artículos reales, como AM León/CRT la fase pasada):
- **COFEPRIS:** portal gob.mx multi-agencia con un índice de sitemaps enorme
  y genérico (gobierno/trámites/…), sin un sitemap específico de COFEPRIS
  identificable sin investigación más profunda.
- **CNIT** (Cámara Nacional de la Industria Tequilera, `cnit.org.mx`):
  **muy relevante para Patrón** — blog público real con posts sobre
  agroindustria tequilera, sustentabilidad, denominación de origen — pero
  sin sitemap.xml; requeriría extracción DIRECT (listado HTML paginado), un
  método más complejo que merece su propia fase de verificación, no un
  intento apurado.

## 7. Actualizaciones NEWS LAKE 200 FINAL PUSH (2026-07-22)

| medio | acción | resultado |
|---|---|---|
| Merca2.0 (MED-0184) | Activado en cron daily-validated (estaba catalogado sin cron) | 15 noticias, 0 errores, texto limpio OK |
| El CEO (MED-0185) | Activado en cron daily-validated (estaba catalogado sin cron) | 15 noticias, 0 errores, texto limpio OK |
| CNIT (MED-0188) | Catalogado, extractor DIRECT creado | Pendiente primer crawl real |
| Jumex staging | Rerun post-activación | 21 menciones/30d — **NO-GO** (1 MARCA_DIRECTA) |
| PorEsto (MED-0189) | Catalogado A_PUBLICO_FACIL + activado en cron daily-validated (fuente: rss) | Pendiente primer crawl real |
| LatinUS (MED-0190) | Catalogado B_PUBLICO_DIRECT + extractor DIRECT `crawl-direct-latinus.ts` | Pendiente primer crawl real |
| La Silla Rota (MED-0191) | Catalogado B_PUBLICO_DIRECT + extractor DIRECT `crawl-direct-lasillarota.ts` (prioridad Alta, P2) | **10 noticias, 10 enriquecidas, 0 fallidas** |
| ZonaDocs (MED-0192) | Catalogado A_PUBLICO_FACIL RSS, activado en daily-validated | 15 noticias lote4 crawl |
| Pie de Página (MED-0193) | Catalogado A_PUBLICO_FACIL RSS, activado en daily-validated | 15 noticias lote4 crawl |
| Chiapas Paralelo (MED-0194) | Catalogado A_PUBLICO_FACIL RSS, activado en daily-validated | 15 noticias lote4 crawl |
| Quadratín Nacional (MED-0195) | Catalogado A_PUBLICO_FACIL RSS, activado en daily-validated | 15 noticias lote4 crawl |
| Tabasco Hoy (MED-0196) | Catalogado A_PUBLICO_FACIL RSS, activado en daily-validated | 15 noticias lote4 crawl |
| El Imparcial Oaxaca (MED-0197) | Catalogado A_PUBLICO_FACIL RSS, activado en daily-validated | 15 noticias lote4 crawl |
| 8 Columnas (MED-0198) | Catalogado A_PUBLICO_FACIL RSS, activado en daily-validated | 10 noticias lote4 crawl |
| DesInformémonos (MED-0199) | Catalogado A_PUBLICO_FACIL RSS, activado en daily-validated | 10 noticias lote4 crawl |
| Eje Central (MED-0200) | Catalogado A_PUBLICO_FACIL SITEMAP mensual (1357+/mes), sin cron | **HITO 200 MEDIOS** — evaluar volumen antes de activar cron |

**Conteo real (2026-07-22 — HITO 200 MEDIOS):**
- Catálogo: **200 medios** (MED-0001 a MED-0200)
- En cron estándar (daily-validated): **67** (+8 del lote4: ZonaDocs, Pie de Página, Chiapas Paralelo, Quadratín Nacional, Tabasco Hoy, El Imparcial Oaxaca, 8 Columnas, DesInformémonos)
- Extractores DIRECT implementados: **3** (CNIT, LatinUS, La Silla Rota)
- Eje Central (MED-0200): catalogado, sin cron (ALTO VOLUMEN — evaluar primero)
- Catálogo sin cron: 133 (incluye MED-0200)

## 8. Recomendación estructural (la más importante de esta fase)

Con 3 rondas de re-enrich acumuladas sobre los mismos medios de alto volumen
(El Heraldo, El Informador, El Economista, La Razón) y degradación repetida
en cada una, la evidencia es ya contundente: **el re-enrich manual por lotes
no es una solución durable** para medios que reciben >1000 notas/semana. La
causa raíz documentada desde hace semanas (`docs/PATRON_IMPORTANT_MEDIA_READINESS.md`
§5) — el cron base no encadena `enrich-news` tras el crawl, a diferencia del
tier daily-validated — sigue sin resolverse. Cada re-enrich manual es un
parche temporal que el propio volumen de crawl revierte en días. Esto ya se
ha señalado 3 veces en fases distintas; la recomendación explícita es
priorizar esa fase estructural antes de seguir gastando ciclos en más lotes
manuales de re-enrich.
