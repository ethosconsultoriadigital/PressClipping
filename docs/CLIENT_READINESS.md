# Matriz de Readiness por Cliente — Shadow MVP

> Estado: **shadow / observación**. Ningún cliente tiene alertas reales activas.
> Última actualización: 2026-07-07 (post-commit `e2fc9ea`).
> Fuente de evidencia: `10_Alertas_Sombra`, `05/07`, `08_Cobertura_Medios`,
> auditorías P1 de los ciclos crisis/daily.

---

## Resumen

| cliente_id | cliente | cobertura actual | fuentes relevantes | alertas shadow | P1 últimos ciclos | FP estimado | riesgos | estado | siguiente acción |
|---|---|---|---|---|---|---|---|---|---|
| CLI-0002 | Bebidas alcohólicas | media-alta en crisis | El Sol de Irapuato (MED-0169), UNO MAS UNO (MED-0170), El Otro Enfoque (MED-0171); red OEM | sí (P1 crisis) | ~7 P1/ciclo (alcohol/tequila adulterado) | ~0% en P1 | matches "tequila" turísticos como P2 borderline | **CANDIDATO_PILOTO_INTERNO** | reunir 3 schedules limpios post-`e2fc9ea` y correr piloto interno |
| CLI-0003 | Reforma laboral | media (nacional + regional) | Vanguardia, Los Noticieristas, Zeta, Espejo, marcomares, Paralelo 19 | sí (P1/P2 laboral) | ~2 P1/ciclo (huelga, contrato colectivo) | <=10% (keywords amplias) | `trabajadores`/`contrato` incidentales | **SHADOW_ESTABLE_PERO_NO_REAL** | mantener shadow; validación humana antes de real (umbral 5 schedules) |
| CLI-0001 | Jumex | baja | dispersa; aparece en PressClipping | débil | ~0 P1 útiles | alto (PC false positives: "Mundial", ofertas Chedraui/Soriana) | señal real escasa, ruido de marca | **NECESITA_MAS_COBERTURA** | ampliar fuentes/keywords; revisar contexto de marca |
| CLI-PRUEBA | Cliente de prueba | n/a | n/a | n/a (artefacto de test) | n/a | n/a | contamina métricas si se cuenta | **SOLO_TEST** | nunca activar; excluir de conteos reales |

---

## Detalle por cliente

### CLI-0002 — Bebidas alcohólicas
- **Señal**: la más fuerte y precisa. Crisis real de alcohol/tequila adulterado
  en Guanajuato (muertes, intoxicaciones, "piratas del alcohol"), capturada por
  el tier crisis. En el último ciclo crisis: 9 P1 totales, ~7 CLI-0002, **0 FP**.
- **Dedupe**: garantizado por `unique(noticia_id, keyword_id)` + upsert.
- **Riesgo**: menciones de "tequila" como destino turístico caen como P2
  borderline (no P1) → aceptable.
- **Veredicto**: candidato #1 a piloto **interno** (no externo). Ver
  `docs/ALERTAS_REALES_ACTIVACION.md` §5.

### CLI-0003 — Reforma laboral
- **Señal**: real y recurrente (huelga Pemex, contratos colectivos, juntas
  laborales), pero con keywords amplias (`trabajadores`, `contrato`) que pueden
  producir menciones incidentales.
- **Veredicto**: shadow estable; **no** activar real aún. Requiere umbral de 5
  schedules limpios + validación humana.

### CLI-0001 — Jumex
- **Señal**: débil. En los comparativos aparece sobre todo como
  `PC_FALSE_POSITIVE` (notas de "Mundial", ofertas de retail Chedraui/Soriana
  donde "Jumex" es producto de anaquel, no PR).
- **Veredicto**: necesita más cobertura y refinamiento de contexto de marca antes
  de considerar shadow estable.

### CLI-PRUEBA — Cliente de prueba
- Artefacto de test (aparece 1 mención en MED-0012). **Nunca** activar; debería
  excluirse de cualquier métrica de servicio.

---

## Gate de readiness (para pasar a piloto)

Un cliente pasa a **piloto interno** solo si:
1. Estado = `CANDIDATO_PILOTO_INTERNO`.
2. Cumple umbrales de `ALERTAS_REALES_ACTIVACION.md` §3.
3. Existe módulo de envío + plantilla + destinatarios internos (hoy ausente).

Hoy: **solo CLI-0002** es candidato, y queda **bloqueado por el prerequisito de
ingeniería del canal** (no hay envío real implementado).
