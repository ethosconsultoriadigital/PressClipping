# Discovery V3 — census + geo plan + Batch 8

Ancla de censo: `2026-10-01T17:56:31.125Z` (certificador vigente, probe diagnóstico + `scoreMediaAtAnchor`).
Sin escritura LIVE en Fases 1–3.

## Census (559)

| | A | B | C | D | E | n |
|---|---|---|---|---|---|---|
| TOTAL | 430 | 53 | 8 | 0 | 68 | 559 |
| ACTIVE | 430 | 53 | 8 | 0 | 61 | 552 |
| INACTIVE | 0 | 0 | 0 | 0 | 7 | 7 |

`552 ACTIVE` ≠ 552 A. Evidencia insuficiente (n7=0 / no_capture): 83 (76 activos).

Método: RSS 382 (A 342), SITEMAP 170 (A 88, E 58), HTML 5 E, DIRECT 2 E.

## Geo (propuesta, no persistida)

Canonical: acentos INEGI + `Ciudad de México` (no CDMX) + `Nacional`.

Aliases HIGH (55 filas): CDMX→Ciudad de México; San Luis Potosi; Nuevo Leon; Michoacan; Estado de Mexico.

SIN_ESTADO: 194. Inferencia HIGH 50 / MEDIUM 3 / LOW 141. Solo HIGH sería auto-persistible.

P1 virtual (A≤1): Hidalgo 0; Campeche/Colima/Durango 1 (tras HIGH). P2: Nayarit, Aguascalientes, Oaxaca, Tlaxcala, Chiapas, Nuevo León.

## Batch 8 (DISCOVERY V3)

- Descubiertos/probed ~110; SKIP LIVE ~22; FAIL ~70; PASS 19; insertados 17 (15–24).
- Rechazados post-PASS: Gaceta Médica (ES), América Retail (redirect malls).
- IDs MED-0563..0579. No reusa 0513–0562.
- Cert: 16 A / 1 B / 0 C / 0 D / 0 E = 94.12% A. GATE PASS.
- Fix: Cambio de Michoacán `post-sitemap.xml` (el index Yoast colgaba el crawl).
- Storecheck queda B (ENCODING/CLONED_BODY). No force A.

Hidalgo P1: Criterio/Independiente/Capital/Acropolis sin RSS/sitemap STRICT usable. Portalhidalgo ya está LIVE pero SIN_ESTADO (LOW hasta persistir geo).
