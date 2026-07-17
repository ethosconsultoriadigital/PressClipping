# Readiness de Medios Importantes — Patrón (CLI-0002)

_Auditoría read-only 2026-07-16 (`npm run audit-patron-important-media-readiness`).
Datos: `medios` (catálogo), `src/config/shadowMedia.ts` (cron), `noticias` (7d),
`menciones` CLI-0002 (7d). Ventana: 7 días._

## 1. Resumen

| métrica | valor |
|---|---|
| Medios importantes auditados | 35 |
| P1_CRÍTICO | 10 |
| P1 LISTO_LEYENDO | 2 (Excélsior, Periódico Correo) |
| P1 CATALOGO_NO_CRON | 3 (Reforma, Milenio, Mural) |
| P1 NECESITA_REENRICH | 3 (El Financiero, El Economista, El Informador) |
| P1 BLOQUEADO | 2 (El Universal, La Jornada) |
| P1 NO_CATALOGADO | 0 |

Distribución global por estado: LISTO_LEYENDO 6 · NECESITA_REENRICH 11 · CATALOGO_NO_CRON 11 ·
NO_CATALOGADO 5 · BLOQUEADO 2.

## 2. Respuestas directas

**¿Cubrimos medios suficientes para Patrón?** Parcialmente. La cobertura de crisis/sector
funciona (Periódico Correo es el caballo de batalla: 95.2% texto, 9 menciones de sector en 7d;
El Economista aporta 4; El Heraldo, Expansión, Xataka aportan 2 c/u). Pero **la mayoría de los
medios P1 nacionales tienen cuerpo vacío** (NECESITA_REENRICH) o están fuera de cron.

**¿Menciones de marca directa?** **0 en 7 días** en todos los medios — no es problema de
cobertura sino de que la marca Patrón/Bacardí simplemente no apareció en el ciclo (confirmado
por `simulate-patron-brand-mentions`, ver §5). La keyword de marca ya está reforzada (KEY-0069
"Patrón" + orden invertido + Bacardí México) para capturarla cuando aparezca.

**¿Qué medios críticos faltan o están débiles?** Ver §4 (top gaps).

## 3. Matriz completa

| medio | región | imp. | estado | cron | notas_7d | texto_ok | m.marca | m.sector | acción |
|---|---|---|---|---|---|---|---|---|---|
| El Universal | nacional | P1 | BLOQUEADO | no | 0 | 0% | 0 | 0 | reparar fuente (404) |
| Reforma | nacional | P1 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 | ⚠ paywall (ver §4) |
| Milenio | nacional | P1 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 | ⚠ política ruido/volumen (ver §4) |
| Excélsior | nacional | P1 | LISTO_LEYENDO | sí | 20 | 100% | 0 | 0 | mantener |
| El Financiero | nacional | P1 | NECESITA_REENRICH | sí | 57 | 0% | 0 | 0 | re-enrich |
| El Economista | nacional | P1 | NECESITA_REENRICH | sí | 87 | 0% | 0 | 4 | re-enrich (alto valor) |
| Forbes México | nacional | P2 | NECESITA_REENRICH | sí | 12 | 0% | 0 | 0 | re-enrich |
| Expansión | nacional | P2 | NECESITA_REENRICH | sí | 1 | 0% | 0 | 2 | re-enrich |
| El Heraldo de México | nacional | P2 | NECESITA_REENRICH | sí | 144 | 0% | 0 | 2 | re-enrich |
| La Jornada | nacional | P1 | BLOQUEADO | no | 0 | — | 0 | 0 | reparar fuente (403) |
| La Razón de México | nacional | P2 | NECESITA_REENRICH | sí | 83 | 0% | 0 | 0 | re-enrich |
| 24 Horas | nacional | P3 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 | candidato a cron |
| Proceso | nacional | P2 | NECESITA_REENRICH | sí | 20 | 0% | 0 | 0 | re-enrich |
| Animal Político | nacional | P2 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 | candidato (conf. media, ver §4) |
| Aristegui Noticias | nacional | P2 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 | candidato (conf. media) |
| LatinUS | nacional | P3 | NO_CATALOGADO | no | 0 | — | 0 | 0 | evaluar alta a catálogo |
| Uno TV | nacional | P3 | LISTO_LEYENDO | sí | 20 | 100% | 0 | 4 | mantener |
| Publimetro | nacional | P3 | LISTO_LEYENDO | sí | 26 | 88.5% | 0 | 2 | mantener |
| El Sol de México | nacional | P2 | NECESITA_REENRICH | sí | 27 | 0% | 0 | 0 | re-enrich |
| El Informador | jalisco | P1 | NECESITA_REENRICH | sí | 78 | 0% | 0 | 1 | re-enrich (P1 Jalisco) |
| Mural | jalisco | P1 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 | ⚠ paywall grupo Reforma (ver §4) |
| NTR Guadalajara | jalisco | P2 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 | candidato (DIRECT_EXTRACTION_ONLY) |
| Milenio Jalisco | jalisco | P2 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 | ⚠ resolvió a MED-0030 (ver nota) |
| Quadratín Jalisco | jalisco | P3 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 | candidato a cron |
| AF Medios | jalisco | P3 | NO_CATALOGADO | no | 0 | — | 0 | 0 | evaluar alta |
| Líder Informativo | guanajuato | P3 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 | candidato a cron |
| Periódico Correo | guanajuato | P1 | LISTO_LEYENDO | sí | 21 | 95.2% | 0 | 9 | **mantener (caballo de batalla)** |
| El Sol de Irapuato | guanajuato | P2 | LISTO_LEYENDO | sí | 1 | 100% | 0 | 1 | mantener |
| AM León | guanajuato | P2 | NO_CATALOGADO | no | 0 | — | 0 | 0 | evaluar alta a catálogo |
| Zona Franca | guanajuato | P3 | NO_CATALOGADO | no | 0 | — | 0 | 0 | evaluar alta |
| Milenio Guanajuato | guanajuato | P3 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 | ⚠ resolvió a MED-0030 (ver nota) |
| Food & Pleasure | sectorial | P3 | NO_CATALOGADO | no | 0 | — | 0 | 0 | evaluar alta |
| Xataka México | sectorial | P3 | NECESITA_REENRICH | sí | 4 | 0% | 0 | 2 | re-enrich |
| Revista Espejo | sinaloa | P3 | LISTO_LEYENDO | sí | 8 | 100% | 0 | 4 | mantener |
| Vanguardia | coahuila | P2 | NECESITA_REENRICH | sí | 38 | 0% | 0 | 0 | re-enrich |

> **Nota de resolución de nombre:** "Milenio Jalisco" y "Milenio Guanajuato" resolvieron por
> subcadena al mismo `medio_id` que "Milenio" nacional (MED-0030). El catálogo no tiene ediciones
> regionales separadas de Milenio. Tratar como un solo medio.

## 4. Top 10 gaps críticos y matices

1. **El Universal (P1, BLOQUEADO 404)** — `medios.ultimo_estado=error`, `activo=false`. Reparar fuente.
2. **La Jornada (P1, BLOQUEADO 403)** — sitemap devuelve 403. Reparar fuente (probar RSS alterno).
3. **El Economista (P1, NECESITA_REENRICH)** — 87 notas/7d, **4 menciones de sector** ya, cuerpo vacío. Re-enrich alto valor.
4. **El Informador (P1 Jalisco, NECESITA_REENRICH)** — 78 notas/7d, cuerpo vacío. Re-enrich.
5. **El Financiero (P1, NECESITA_REENRICH)** — 57 notas/7d, cuerpo vacío. Re-enrich.
6. **Reforma (P1, CATALOGO_NO_CRON)** — ⚠ **paywall grupo Reforma**. La recomendación automática
   "AGREGAR A CRON" NO aplica: requiere estrategia de paywall (no bypass). Dejar fuera por ahora.
7. **Milenio (P1, CATALOGO_NO_CRON)** — ⚠ **excluido por política** (ruido/volumen, ver
   `MEDIA_PARITY_MATRIX.md`). No agregar sin decisión explícita de volumen.
8. **Mural (P1 Jalisco, CATALOGO_NO_CRON)** — ⚠ **paywall grupo Reforma**. Igual que Reforma.
9. **El Heraldo / La Razón / El Sol de México / Vanguardia (P1/P2, NECESITA_REENRICH)** — alto
   volumen (144/83/27/38 notas) con cuerpo vacío. Candidatos a re-enrich.
10. **AM León (P2 Guanajuato, NO_CATALOGADO)** — medio relevante de la zona de crisis (Guanajuato),
    no está en catálogo. Evaluar alta.

## 5. Hallazgo estructural: por qué persiste NECESITA_REENRICH

11 de 35 medios (y 3 de 10 P1) muestran cuerpo vacío pese a **dos lotes previos de re-enrich**
(El Informador, El Economista ya fueron re-enriquecidos y volvieron a 0% en la ventana de 7d).
Causa raíz: el **cron base** (`live-comparison-shadow` / `shadow-scheduler`) crawlea títulos
pero **no ejecuta enrich** — cada corrida agrega noticias título-only más rápido de lo que los
lotes de re-enrich (capados a 500) las limpian. El re-enrich por lotes trata el síntoma.

**Fix estructural sugerido (fase separada, requiere autorización):** que el cron base encadene
`enrich-news --only-pending-mentions` tras el crawl, como ya hace el tier daily-validated. Esto
eliminaría el backlog de cuerpo vacío de raíz. NO se aplica en esta fase (cambio de cron/arquitectura).

**Impacto real acotado:** la detección de Patrón por título (marca frase_exacta + crisis en
título) NO se ve bloqueada por el cuerpo vacío. El cuerpo solo se necesita para la "nota completa"
(≥600 chars) al escribir en `NoticiasPatron`, y el capture loop ya re-enriquece dirigido las
noticias con mención pendiente vía `--only-pending-mentions`. Por eso Patrón ya escribe en la
hoja final pese a este backlog.

## 6. Lote inmediato propuesto (NO ejecutado — requiere autorización)

Máximo 5, evidence-based (excluyendo paywall/política):

| # | acción | medio | motivo |
|---|---|---|---|
| 1 | B. reparar fuente | El Universal (MED-0011) | P1 nacional, 404, reparar sitemap/RSS |
| 2 | B. reparar fuente | La Jornada (MED-0029) | P1 nacional, 403, probar RSS alterno |
| 3 | C. re-enrich dirigido | El Economista (MED-0001) | P1, 4 menciones sector, cuerpo vacío |
| 4 | C. re-enrich dirigido | El Informador (MED-0017) | P1 Jalisco, 78 notas, cuerpo vacío |
| 5 | A. evaluar alta catálogo | AM León | P2 Guanajuato (zona crisis), no catalogado |

No se ejecuta ninguna hasta autorización. Reforma/Milenio/Mural quedan **fuera** por
paywall/política (no son candidatos técnicos válidos).

## 7. PATRON P1 MEDIA GAP CLOSURE — ejecutado (2026-07-17)

Por autorización explícita del usuario (informada por auditoría editorial externa), se
ejecutó el lote de 5 acciones #3/#4/#5 de arriba **más Milenio** (que la auditoría externa
pidió reconsiderar pese a la exclusión previa):

- **Milenio (MED-0030):** agregado a `SHADOW_MEDIOS_NACIONALES_B` (prefiltro_titulo=true,
  max_notas_shadow=30, 6h) — **REVIERTE** la exclusión "NO_TOCAR (ruido/volumen)" de §4/
  `MEDIA_PARITY_MATRIX.md` por decisión explícita del usuario. Viabilidad técnica
  reconfirmada (`audit-media-sources`: READY_SITEMAP_INDEX, conf=1.0, sin proxy/JS). Nota
  importante: el hallazgo previo de "ruido" era de **volumen** en `01_Noticias_Raw`
  (~230 notas/lote, mayoría crimen/FIFA), no de falsos positivos de detección (las
  menciones siguen gateadas por keyword real). El tier nacional B ya tiene `schedule`
  activo cada 6h — Milenio se crawleará automáticamente en la próxima corrida programada,
  sin paso manual adicional. Estado inmediatamente después del cambio: `EN_CRON_SIN_NOTICIAS`
  (aún no corre el cron).
- **El Informador (MED-0017):** re-enrich controlado (100 notas, only-missing-clean-text,
  sin force-refresh). 88 actualizadas, 87 con texto limpio, 1 fallida. **Backlog real: 735
  notas pendientes desde 2026-06-26** — el batch de 100 despejó backlog viejo (oldest-first),
  no las de la ventana 7d. `texto_ok_pct` de 7d se mantiene en 0%. Reconfirma el hallazgo
  estructural §5: el cap de 100 no alcanza a mover la métrica visible dado el tamaño real
  del backlog.
- **El Economista (MED-0001):** mismo patrón. 99/100 actualizadas, 99 con texto limpio, 1
  fallida. Backlog real: 737 notas pendientes desde 2026-06-29. `texto_ok_pct` 7d también
  se mantiene en 0% por la misma razón.
- **AM León (nuevo MED-0172):** catalogado vía `scripts/catalog-patron-p1-gap-media.ts`.
  `news-sitemap.xml` (Yoast/Jetpack, formato Google News) verificado en vivo con artículos
  recientes (2026-07-16/17). Sin proxy/JS. Agregado a `SHADOW_MEDIOS_DAILY_VALIDATED`
  (max_notas_shadow=30, fuente=auto). Ese tier también tiene `schedule` diario activo
  (12:45 UTC) — se crawleará en la próxima corrida (hasta 24h). 0 noticias aún.
- **CRT / Consejo Regulador del Tequila (nuevo MED-0173):** catalogado como fuente primaria
  **sectorial** (boletines/comunicados oficiales del organismo — denominación de origen,
  certificaciones — **NO** "CRT tech"). Sitemap de posts (`wp-sitemap-posts-post-1.xml`,
  no el índice, para evitar páginas/taxonomías/usuarios) verificado en vivo. Agregado a
  `SHADOW_MEDIOS_DAILY_VALIDATED` (max_notas_shadow=20, volumen institucional bajo). 0
  noticias aún.
- **Captura Patrón post-cambios:** dry-run limpio; la corrida real encontró 1 candidato
  nuevo `GO_MEDIA` sectorial (Periódico Correo, "Hacienda de Jaral de Berrios..."),
  escrito en la tab interna `13_Patron_Final_Preview`. **NO escrito en `NoticiasPatron`
  real** — el comando de captura no incluyó `--allow-final-sheet=true`; pendiente
  confirmación explícita del usuario para completar esa escritura externa.
- **Cron de `patron-no-pc-capture.yml`:** sigue en `workflow_dispatch` únicamente. NO se
  activó su `schedule` en esta fase (requiere confirmación explícita separada).
- Jumex: sin cambios, NO-GO, sin conexión a hoja final. 1067 tests, todos verdes.

## 8. PATRON IMMEDIATE PRODUCTION + RECENT ENRICH FIX (2026-07-17, continuación)

Por autorización explícita del usuario ("avanzar con Patrón"):

- **Candidato pendiente escrito:** la fila GO_MEDIA de Periódico Correo (§7) se escribió en
  `NoticiasPatron` real (7→8 filas, 0 duplicados, 0 Jumex, `headers_mismatch=false`).
- **Schedule activado:** `.github/workflows/patron-no-pc-capture.yml` ahora corre cada 2h
  (`cron: '0 */2 * * *'`) con guard por `github.event_name` — el `schedule` fuerza
  `dry_run=false/output_sheet=true/allow_final_sheet=true` (escritura real automática); el
  `workflow_dispatch` manual conserva sus defaults seguros sin cambios.
- **Milenio, AM León y CRT ejecutados manualmente (sin esperar el cron):**
  - Milenio: primer crawl real — 11 noticias nuevas, 0 errores, gate detect limpio (0
    menciones nuevas esa corrida). Tras el fix de re-enrich reciente (ver abajo), pasó a
    **LISTO_LEYENDO** (111 noticias/7d, 89.2% texto, 3 menciones sector).
  - AM León: primer crawl real — 30 noticias nuevas, 0 duplicados, 0 errores. Aún
    `EN_CRON_SIN_NOTICIAS` en la ventana 7d/24h (el sitemap trajo su página más reciente,
    pero sin señal Patrón todavía — 0 menciones).
  - CRT: primer crawl real — 30 noticias nuevas, 0 duplicados, 0 errores, texto limpio
    100%. **Hallazgo:** el gate detect (dry-run) contó 84 menciones potenciales (83 reales
    para CLI-0002 tras el detect real) — la keyword amplia "tequila" (`contiene`) matchea
    trivialmente casi cualquier boletín propio del CRT. **No es un riesgo de flood para el
    reporte:** son posts institucionales históricos (2024-2025 por `fecha_publicacion`), muy
    fuera de cualquier ventana de captura (24h/7d) — confirmado en la corrida de captura
    posterior (0 candidatos nuevos de CRT). Si el cron diario empieza a traer boletines
    *nuevos* con este mismo patrón, vale la pena revisar la keyword "tequila" amplia
    específicamente para fuentes institucionales — no se tocó en esta fase (fuera de scope).
- **Fix de re-enrich reciente:** `enrich-news.ts`/`enrichNews()`/`getNoticiasParaEnriquecer()`
  ganaron `--recent-first` (ordena por `fecha_publicacion` descendente en vez de
  `created_at` ascendente) y `--window-days=N` (acota a los últimos N días), aditivos —
  el comportamiento default (oldest-first, sin ventana) no cambió. 34 tests nuevos/actualizados.
  - **El Informador:** texto_ok_pct 7d **0% → 98.7%**. Pasó de NECESITA_REENRICH a
    **LISTO_LEYENDO** (78 noticias/7d, 4 menciones sector).
  - **El Economista:** texto_ok_pct 7d **0% → 100%**. Pasó de NECESITA_REENRICH a
    **LISTO_LEYENDO** (64 noticias/7d, 5 menciones sector).
- **Captura Patrón post-cambios:** dry-run limpio → real capturó **1 nota nueva** de Milenio
  ("Guanajuato busca implementar Novoglass para evitar la reutilización de botellas",
  INDUSTRIA_TEQUILA/GO_MEDIA) → `NoticiasPatron` 8→9 filas. 0 duplicados, 0 Jumex,
  `headers_mismatch=false`. Confirma el ciclo completo (crawl→enrich→detect→consolidado→
  preview→escritura) funcionando end-to-end para un medio recién agregado, sin intervención
  manual en la clasificación.
- **P1 listos:** 2 (Excélsior, Periódico Correo) → **4** (Excélsior, Milenio, El Economista,
  El Informador). Periódico Correo bajó de LISTO_LEYENDO a EN_CRON_TEXTO_MALO (60%, 5
  noticias/7d) — **no es efecto de esta fase**: es drift natural de la ventana rodante de 7
  días (notas viejas de buena calidad salieron de la ventana, sin re-enrich propio reciente
  en este medio). Top gaps restantes: El Universal/La Jornada (bloqueados 404/403),
  Reforma/Mural (paywall, fuera por política), El Financiero (necesita re-enrich, aún no
  tratado con el fix reciente), Periódico Correo (nuevo gap por drift de ventana).
- Jumex: sin cambios, NO-GO confirmado, sin export final, sin tocar hoja externa.
