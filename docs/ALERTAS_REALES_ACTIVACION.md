# Protocolo de Activación de Alertas Reales

> Estado actual: **NO ACTIVADO**. Todo el sistema opera en modo sombra
> (observación, sin envíos). Este documento define CÓMO y CUÁNDO se activarían
> alertas reales. Crearlo **no activa nada**.
> Última actualización: 2026-07-07 (post-commit `e2fc9ea`).

---

## 0. Estado técnico de canales (bloqueante)

Antes de cualquier fase con envío real, hay un **prerequisito de ingeniería**:

- **No existe código de envío real** implementado. Las alertas se **simulan**
  (`canal_simulado` en `10_Alertas_Sombra`). No hay integración Twilio ni
  Gmail/SMTP en el repo.
- Las guardas anti-envío operan en 3 capas y deben permanecer:
  1. CLI: `run-shadow-alerts.ts` aborta con exit 2 ante `--send/--whatsapp/--email`.
  2. Entorno: `verificarEnvObservacion` aborta si `SEND_ALERTS` / `WHATSAPP_ENABLED`
     / `EMAIL_ENABLED` = `true`.
  3. Código: el tier crisis fuerza `send=false whatsapp=false email=false`.

**Conclusión**: la activación real requiere (a) implementar un módulo de envío,
(b) credenciales, (c) plantillas y (d) destinatarios — todo ausente hoy. Hasta
entonces, la máxima madurez alcanzable es "listo para piloto INTERNO tras
implementar el canal".

---

## 1. Principios

- Las alertas reales se activan **por cliente**, nunca globalmente.
- Activación **gradual** (por fases).
- **Primero CLI-0002 crisis** (señal más fuerte y precisa).
- No activar clientes generales sin validación.
- No activar WhatsApp y email simultáneamente en el primer paso.
- **Siempre conservar shadow-alerts** en paralelo (auditoría continua).

---

## 2. Clientes elegibles

Estados posibles: `NO_LISTO`, `LISTO_SHADOW`, `CANDIDATO_ALERTAS_REALES`, `SOLO_OBSERVACION`.

| cliente | evaluación | estado |
|---|---|---|
| CLI-0002 Bebidas alcohólicas | señal crisis fuerte, FP ~0 en P1 | **CANDIDATO_ALERTAS_REALES** (solo crisis_bebidas P1) |
| CLI-0003 Reforma laboral | señal real pero keywords amplias (incidental) | **LISTO_SHADOW** (aún no real) |
| CLI-0001 Jumex | cobertura débil, mayormente PC false positives | **NO_LISTO** (evaluar después) |
| CLI-PRUEBA | cliente de prueba | **SOLO_OBSERVACION** (nunca real) |

---

## 3. Umbrales de activación

### CLI-0002 crisis (piloto principal)

- Mínimo **3 schedules limpios consecutivos** del tier crisis.
- P1 FP estimado **<= 10%**.
- P1 duplicadas controladas (dedupe verificado).
- `10_Alertas_Sombra`: readback OK, `mismatch=false`.
- `05/07` sin mismatch.
- `send=false` confirmado en el entorno **antes** del cambio.
- Dedupe OK (`unique(noticia_id, keyword_id)`).
- Sin boilerplate; sin aranceles/T-MEC off-topic como P1.

> Estado hoy: MED-0169 tiene 5 schedules limpios; MED-0171 se agregó al tier y
> aún **no** tiene schedules automáticos post-`e2fc9ea`. El conteo de "3
> consecutivos con el tier ampliado" arranca desde el primer schedule post-commit.

### CLI-0003 laboral

- Mínimo **5 schedules limpios**.
- FP P1 **<= 10%**.
- Sin keywords amplias incidentales (revisar `trabajadores`, `contrato`).
- Validación humana adicional.
- **No activar todavía.**

---

## 4. Fases de activación

| Fase | Descripción | Envío |
|---|---|---|
| **Fase 0** | Shadow only (estado actual). | Ninguno. |
| **Fase 1** | Alerta real interna por **email** solo al equipo MDP. | Email interno. |
| **Fase 2** | **WhatsApp** interno solo para crisis P1 CLI-0002. | WhatsApp interno. |
| **Fase 3** | Cliente externo con ventana controlada. | Externo acotado. |
| **Fase 4** | Producción multi-cliente. | Producción. |

Cada salto de fase requiere GO/NO-GO firmado (sección 7) y cumplir umbrales (sección 3).

---

## 5. Primer piloto recomendado

- **Cliente**: CLI-0002.
- **Tipo**: `crisis_bebidas` P1 (alcohol/tequila adulterado).
- **Fuentes**: cron crisis sombra (MED-0169 / MED-0170 / MED-0171).
- **Canal inicial**: email interno **o** WhatsApp interno (equipo MDP), **no** cliente externo.
- **Duración piloto**: 48–72h.
- **Límite**: máximo **5 alertas reales/día**.
- **Horario**: ventana laboral (p.ej. 08:00–20:00 CDMX) — definir con el equipo.
- **Prerequisito**: implementar módulo de envío + credenciales + plantilla (sección 0).

---

## 6. Condiciones de rollback

Revertir a Fase 0 (shadow only) de inmediato ante cualquiera de:

- Cualquier envío erróneo.
- FP P1 **> 10%**.
- Duplicados enviados.
- Mismatch en `10_Alertas_Sombra`.
- Fallo en `05/07`.
- Error de Twilio/Gmail.
- Queja de un receptor.
- Ruido por una fuente concreta.

**Rollback técnico**: poner `SEND_ALERTS=false` (y `WHATSAPP_ENABLED`/`EMAIL_ENABLED=false`)
en el entorno → las 3 guardas vuelven a bloquear envío. No requiere revertir código.

---

## 7. Checklist GO / NO-GO

Marcar TODO antes de subir de fase:

- [ ] N schedules limpios consecutivos (según cliente/umbral).
- [ ] P1 auditadas (FP <= umbral).
- [ ] Dedupe validado.
- [ ] Canales validados (config + módulo de envío implementado).
- [ ] Destinatarios internos confirmados.
- [ ] Mensaje/plantilla aprobado.
- [ ] Rollback documentado y probado.
- [ ] Log de envío disponible (auditable).

Si algún ítem falla → **NO-GO**, permanecer en la fase actual.
