# Overnight expansion 2026-09-30 — recovery checkpoint

- A_BRANCH: `juan/agent-a-expansion-overnight-20260930`
- START_HEAD: `85374de854a0bcab87a3ce1801a5aecf58d2cdee`
- B_BRANCH_NOT_TOUCHED: `claude/ethos-pr-intelligence-design-q9GzX` (B avanzó a `bd1e616`; no rebase/merge)

## Recovery

- LIVE_MED0513_0537_COUNT: 25
- DUPLICATES_FOUND: 0
- Reinsert catalog: NO
- Recrawl batch: NO
- Cocina Vital: filtro host-scoped `/academia-cocina-vital/`, `/video`, `/videoteca`, `/get-videoteca`, `/test`

## Batch 6

- SELECTED: 25 (MED-0513..MED-0537)
- A/B/C/D/E: 25 / 0 / 0 / 0 / 0
- A%: 100
- GATE: PASS
- HISTORICAL_IMPACTS_RECOVERED: 301 (aprox. Quinta Fuerza 25 + Al Tiempo 23 + PLAYERS 22 + Mexico Informa 21 + Dónde Ir 18 + Cocina Vital 17 + Plaza Pública 17 + Diario Amanecer 16 + La de Hoy QRO 16 + Índice Político 15 + Presencia Puebla 14 + Periódico Victoria 14 + Food and Wine 14 + Cambio Digital 14 + Reporte Chihuahua 14 + Por La Libre 14 + Curul 9 + e-Tlaxcala 9 + Mundo Ejecutivo 9)

## Batch 7

- SELECTED: 24 (MED-0538..0562 salvo MED-0543 Zona Roja, HTTP 500 en todas las fuentes; ID no reutilizado)
- A/B/C/D/E: 22 / 2 / 0 / 0 / 0
- A%: 91.67
- GATE: PASS
- Lo de Hoy México (MED-0541): sitemap nacional mezcla `/local/`, `/municipios/`, `/en-juego/` con 403 persistente; filtro host-scoped. RSS/post-sitemap 404.
- Gentleman México (MED-0552): `post-sitemap.xml` + filtro `/tag` y hubs de sección. sitemap_index mezclaba archivos.
- Residual B: Adlatina (LATENCY+BODY_PARTIAL), Alianza Flotillera (CLONED_BODY Zeen + LATENCY). No force A.
- Caps remaining after B7: 6 batches, ~151 altas.

## Discovery V3 — Batch 8

- SELECTED: 17 (MED-0563..0579)
- A/B/C/D/E: 16 / 1 / 0 / 0 / 0
- A%: 94.12
- GATE: PASS
- Cambio de Michoacán: post-sitemap (no sitemap_index Yoast)
- Residual B: Storecheck ENCODING
- Detalle: `artifacts/discovery-v3.md`


## Discovery V3 — Batch 8

- SELECTED: 17 (MED-0563..0579)
- A/B/C/D/E: 16 / 1 / 0 / 0 / 0
- A%: 94.12
- GATE: PASS
- Cambio de Michoacán: post-sitemap (no sitemap_index Yoast)
- Residual B: Storecheck ENCODING
- Detalle: `artifacts/discovery-v3.md`


## STOP

- Leftover STRICT PASS vs LIVE: 1 (Zonaroja / zonaroja.com.mx), ya descartado en Batch 7 por HTTP 500 en feed y sitemaps.
- Candidatos STRICT < 15 → STOP overnight Factory. No se abre Batch 8.
- No se bajó calidad ni se usó pool aleatorio.
