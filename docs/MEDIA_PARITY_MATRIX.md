# Matriz de Paridad de Medios — PressClipping vs Ethos

_Auditoría read-only 2026-07-08 (fase "Paridad de Medios + Ruta Rápida a Producción")._
_Fuentes: `comparativo_pressclipping` (623 registros PC), `medios` (171 catálogo Ethos),_
_`src/config/shadowMedia.ts` (cron), `noticias`/`menciones` (30d). Join por dominio +_
_fuzzy por nombre. Ventana PC efectiva: ~14–30 días._

## 1. Totales

| Métrica | Valor |
|---|---|
| Registros PC (comparativo) | 623 |
| **Medios únicos PressClipping** | **302** (por dominio) |
| Medios catálogo Ethos | 171 |
| Medios Ethos en cron shadow | 34 (base 25 + nacional B 2 + crisis 4 + daily 4, dedupe) |
| Medios Ethos con noticias (30d) | 33 |
| Medios Ethos con menciones | 46 |
| Registros PC sindicados (MSN/OEM) | 37 |

## 2. Overlap y paridad

| Métrica | Valor | % sobre PC |
|---|---|---|
| Overlap PC ∩ catálogo Ethos (dominio) | 64 | 21.2% |
| Overlap PC ∩ **catálogo Ethos (fuzzy nombre)** | **~85** | ~28% |
| Overlap PC ∩ **cron Ethos** | 27 | 8.9% |
| Solo PC (dominio) | 238 | — |
| Solo Ethos | 100 | — |

**Nota de interpretación:** el join por dominio subestima (dominios PC vs `url_base`
Ethos difieren). Con fuzzy por nombre, la cobertura de catálogo sube a ~28%.

## 3. Clasificación de los 302 medios PC

| Clase | Conteo | Lectura |
|---|---|---|
| CUBIERTO_EN_CRON | 27 | Ethos ya los crawlea |
| **EN_CATALOGO_NO_CRON** | **58** | **Ya en catálogo Ethos, sanos, fuera de cron → ruta rápida** |
| NO_CUBIERTO_PC_IMPORTANTE | 32 | Fuera de catálogo, ≥4 notas o multi-cliente |
| NO_CUBIERTO_PC_BAJO_VALOR | 182 | Cola larga (1–3 notas, one-offs) |
| SINDICADO_LOW_VALUE | 3 | MSN/OEM replicadores |

**Conclusión estructural:** PressClipping es mucho más ancho (302 medios) pero
**dominado por cola larga** (182/302 = 60% son one-offs de 1–3 notas). El grueso
de la brecha *accionable* se concentra en **~58 medios ya presentes en el catálogo
Ethos** que solo necesitan alta a cron, más ~10–15 medios importantes fuera de catálogo.

## 4. Top gaps EN_CATALOGO_NO_CRON (ruta rápida)

| medio_id | medio | gap PC | clientes | fuente | audit | acción |
|---|---|---|---|---|---|---|
| MED-0005 | lado.mx | 28 | 3 (CLI-0002…) | RSS | READY conf 1.0 | **ALTA daily shadow** ✅ |
| MED-0049 | Telediario Monterrey | 14 | 3 | sitemap index | READY conf 1.0 | **ALTA daily shadow** ✅ |
| MED-0030 | Milenio | 10 | 3 | sitemap | (policy: excluido) | NO_TOCAR (ruido/volumen) |
| MED-0084 | Frontera | 8 | 3 | secciones | — | AUDITAR_MANUAL |
| MED-0037 | Mural | 6 | 1 | HTML (grupo Reforma) | — | DESCARTAR (paywall) |
| MED-0055 | Noroeste | 4 | 2 | sitemap | READY conf 1.0 | candidato (texto 58%) |
| MED-0028 | Excelsior | 5 | 2 | sitemap | estado=error | REPAIRABLE (siguiente lote) |
| MED-0033 | Eje Central | 3 | 2 | direct | DIRECT_EXTRACTION_ONLY | AUDITAR_MANUAL |
| MED-0038 | NTR Guadalajara | 3 | 1 (CLI-0002) | direct | DIRECT_EXTRACTION_ONLY | AUDITAR_MANUAL |

## 5. Top gaps NO_CUBIERTO_PC_IMPORTANTE (fuera de catálogo)

| medio | dominio | gap PC | clientes | nota |
|---|---|---|---|---|
| La Prensa MX | oem.com.mx | 22 | 2 | Hub OEM (Ethos ya tiene El Sol regionales en crisis tier) |
| La Silla Rota | lasillarota.com | 9 | 1 (CLI-0002) | Digital nacional, legítimo → candidato fuente nueva |
| Noticias México 24 | noticiasmexico24.com | 7 | 4 | Parece agregador → revisar |
| Jalisco Hoy | jaliscohoy.com | 7 | 1 (CLI-0002) | Regional Jalisco/tequila → candidato |
| Noticias CDMX | ntcd.mx | 5 | 3 | Revisar |
| Marca México | marca.com | 3 | 2 | Deportes → descartar bajo valor |

## 6. Medios extra de Ethos (solo Ethos)

~100 medios en catálogo Ethos sin presencia en PC. Incluye los tiers de crisis/daily
validados (El Sol de Irapuato, El Otro Enfoque, UNO MÁS UNO, Zeta Tijuana, etc.) que
aportan cobertura regional de crisis que PressClipping no rastrea → **valor añadido de Ethos**.

## 7. Acciones prioritarias

1. **Ejecutado:** alta a daily shadow de lado.mx (MED-0005) y Telediario Monterrey
   (MED-0049) — READY, extracción 100%, sin FP flood.
2. **Siguiente lote (P1):** Noroeste (MED-0055), Excelsior (MED-0028, reparar sitemap),
   La Silla Rota / Jalisco Hoy (crear fuente, CLI-0002).
3. **Descartar:** MSN/OEM replicadores, Marca (deportes), Mural (paywall Reforma),
   la cola larga de 182 one-offs (bajo ROI).

## 8. Conclusión de cobertura

- Ethos **no cubre aún tantos medios como PressClipping** en número bruto (34 cron vs
  302 PC), pero PC está dominado por cola larga de bajo valor.
- La **brecha accionable real** es modesta y **mayormente resoluble activando medios
  ya catalogados** (58 EN_CATALOGO_NO_CRON), no creando fuentes nuevas.
- Con altas graduales de medios READY (empezando por los 2 de esta fase), Ethos puede
  cerrar la mayor parte del gap accionable de CLI-0002 (Bebidas alcohólicas) —el cliente
  con precisión ya validada— en pocos lotes.
- **Aún NO hay base para sustitución global**; sí para seguir cerrando gap por lotes y
  avanzar el piloto interno CLI-0002.
