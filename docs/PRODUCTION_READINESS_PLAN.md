# Plan de Producción — Ethos PR Intelligence

_Creado 2026-07-08 (fase "Paridad de Medios + Ruta Rápida a Producción")._
_Ruta escalonada y reversible desde shadow medible hasta sustitución global. Cada fase
tiene criterio de entrada/salida, riesgos, rollback y qué se activa / qué NO._

> Principio rector: **nada se activa hacia afuera sin evidencia medible y sin un
> rollback trivial**. El módulo de envío permanece _disabled by default_ hasta la Fase 1.

---

## Fase 0 — Shadow medible (ACTUAL)

- **Qué es:** crons shadow (base/nacional B/crisis/daily) que crawlean, extraen,
  detectan y comparan contra PressClipping, **sin enviar nada**.
- **Criterio de entrada:** ✅ ya cumplido (crons activos, comparativo en Sheets).
- **Criterio de salida:**
  - Paridad de medios medida (✅ ver `MEDIA_PARITY_MATRIX.md`).
  - Precisión validada en ≥1 cliente (✅ CLI-0002 tequila, FP bajo).
  - Alertas shadow trazables (✅ `10_Alertas_Sombra` con prioridad/estado).
- **Qué se activa:** solo observación (Sheets, shadow-alerts).
- **Qué NO:** envíos, IA, export-results, generate-xml.
- **Riesgos:** falsa sensación de cobertura; **mitigación:** matriz de paridad + readiness report.
- **Rollback:** desactivar `activo_shadow` en `shadowMedia.ts` (config-only).

## Fase 1 — Piloto interno CLI-0002 email (credenciales apagadas primero)

- **Qué es:** envío de alertas P1/P2 de CLI-0002 a un buzón **interno** (equipo Ethos),
  no al cliente.
- **Criterio de entrada:**
  - CLI-0002 en `SHADOW_ESTABLE` con FP ≤15% sostenido 7 días.
  - GO_CREDENCIALES_INTERNAS cerrado (checklist `docs/CREDENCIALES_INTERNAS_CHECKLIST.md`).
  - Digest de P1 repetidos funcionando (anti-fatiga).
- **Criterio de salida:**
  - ≥1 semana de envíos internos sin falsos P1 relevantes.
  - Latencia y formato validados por el equipo.
- **Qué se activa:** `notificationService` con `email` interno, `send_enabled=true`
  **solo** para allowlist interna; primero **dry-run con credenciales vacías**.
- **Qué NO:** WhatsApp, envío a cliente externo, Twilio/SMTP hacia fuera del equipo.
- **Riesgos:** fuga de alerta a destino equivocado; **mitigación:** allowlist interna
  + `shadow_client_allowlist` + arranque con credenciales apagadas.
- **Rollback:** `send_enabled=false` (flag), revocar credenciales.

## Fase 2 — Reporte diario interno por cliente

- **Qué es:** digest diario interno (no alertas en tiempo real) por cliente, con
  menciones, P1/P2, gaps vs PressClipping.
- **Criterio de entrada:** Fase 1 estable ≥2 semanas; ≥2 clientes en `SHADOW_ESTABLE`.
- **Criterio de salida:** reporte reproducible, revisado por analista, sin ruido dominante.
- **Qué se activa:** generación de digest interno (email interno).
- **Qué NO:** entrega a cliente externo.
- **Riesgos:** ruido/promo en el digest; **mitigación:** puertas contextuales por cliente
  (tequila CLI-0002, Jumex CLI-0001) + clasificación de gaps.
- **Rollback:** desactivar el job de digest.

## Fase 3 — Cliente externo acotado (1 cliente, opt-in)

- **Qué es:** un cliente real recibe alertas/reporte, con SLA acotado y revisión humana previa.
- **Criterio de entrada:** Fase 2 estable; cliente piloto acepta condiciones; revisión
  humana en el loop; cobertura de medios del cliente ≥ PressClipping en su vertical.
- **Criterio de salida:** satisfacción del cliente; FP ≤10%; cobertura ≥ PC en su tema.
- **Qué se activa:** envío externo a 1 cliente, con `human-in-the-loop`.
- **Qué NO:** múltiples clientes, sustitución de PressClipping.
- **Riesgos:** reputacional si falla una alerta; **mitigación:** revisión humana previa,
  rollback inmediato, se mantiene PressClipping en paralelo.
- **Rollback:** apagar envío del cliente; PressClipping sigue activo.

## Fase 4 — Sustitución parcial de PressClipping

- **Qué es:** para verticales/clientes donde Ethos demuestra cobertura ≥ PC, se deja de
  depender de PressClipping.
- **Criterio de entrada:** ≥3 clientes estables en externo; paridad de medios ≥ PC por
  vertical; backtest 7–14 días con match alto y solo_pc accionable ~0.
- **Criterio de salida:** métricas sostenidas 1 mes; sin gaps accionables recurrentes.
- **Qué se activa:** baja de PressClipping en las verticales cubiertas.
- **Qué NO:** baja global.
- **Riesgos:** perder cobertura de cola larga PC; **mitigación:** mantener PC en verticales
  no cubiertas; monitor de gap continuo.
- **Rollback:** reactivar PressClipping en la vertical.

## Fase 5 — Sustitución global

- **Qué es:** Ethos reemplaza a PressClipping en todos los clientes/verticales.
- **Criterio de entrada:** Fase 4 sostenida ≥2 meses en todas las verticales; paridad
  global ≥ PC; procesos de soporte/rollback probados.
- **Criterio de salida:** N/A (estado objetivo).
- **Qué se activa:** operación completa sobre Ethos.
- **Qué NO:** —
- **Riesgos:** dependencia total; **mitigación:** SLA, redundancia de fuentes, monitor de
  gap y de salud de fuentes (403/paywall).
- **Rollback:** contrato PressClipping en standby reactivable.

---

## Estado actual y siguiente fase permitida

- **Estado:** Fase 0 (shadow medible) **consolidada**; paridad medida.
- **Siguiente fase permitida:** preparar **Fase 1** (piloto interno CLI-0002 email con
  credenciales apagadas) — sin activar envíos todavía.
- **No permitido aún:** sustitución parcial/global (Fases 4–5) — sin evidencia suficiente.
