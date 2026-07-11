# Reporte Diario Interno Shadow — Ethos PR Intelligence

_Modo shadow only. Sin envíos reales. Para uso interno del equipo Ethos._

---

## Plantilla de reporte diario

### 1. Resumen ejecutivo

| campo | valor |
|---|---|
| Fecha | {{YYYY-MM-DD}} |
| Run ID | {{SA-YYYY-MM-DDThh-mm-ss}} |
| Noticias crawleadas (24h) | {{N}} |
| Menciones detectadas (24h) | {{N}} |
| Alertas shadow candidatas | {{N}} |
| P1 inmediatas | {{N}} |
| P2 resumen | {{N}} |
| P3 dashboard | {{N}} |
| Clientes activos | CLI-0001, CLI-0002, CLI-0003, CLI-MERY-TEST |
| Envíos reales | 0 (shadow only) |
| Mismatch Sheets | sí/no |

---

### 2. Estado por cliente

| cliente_id | nombre | menciones_24h | alertas_shadow | estado_backtest | estado_readiness |
|---|---|---|---|---|---|
| CLI-0001 | Jumex | {{N}} | {{N}} | {{ACTIVO_ESTABLE}} | {{NO_LISTO}} |
| CLI-0002 | Bebidas alcohólicas / tequila | {{N}} | {{N}} | {{ACTIVO_ESTABLE}} | {{NO_LISTO}} |
| CLI-0003 | Reforma laboral | {{N}} | {{N}} | {{ACTIVO_ESTABLE}} | {{NO_LISTO}} |
| CLI-MERY-TEST | Mery Pozos / Merilyn Gómez Pozos | 0 | 0 | {{SHADOW_CONFIG_OK_SIN_DATOS}} | N/A |

---

### 3. Alertas P1/P2 del día

_Nota: sin envío real. Las alertas P1 son solo candidatas para revisión interna._

```
[Para cada P1]:
- cliente: {{nombre}}
- keyword: {{keyword}}
- medio: {{nombre_medio}}
- título: {{titulo_noticia}}
- motivo: {{motivo_alerta}}
- URL: {{url}}
```

---

### 4. Menciones nuevas destacadas

Top 5 menciones del día (por score_relevancia):

```
1. cliente: {{nombre}}
   keyword: {{keyword}}
   medio: {{nombre_medio}}
   título: {{titulo}}
   score: {{score}}
   texto_match: {{extracto}}
```

---

### 5. Medios con mejor señal (últimos 7 días)

| medio_id | nombre_medio | menciones | % con texto limpio |
|---|---|---|---|
| {{MED-xxx}} | {{nombre}} | {{N}} | {{pct}}% |

Fuentes críticas activas:
- MED-0005 lado.mx (Jalisco / Nacional)
- MED-0049 Telediario Monterrey (política)
- [agregar medios clave según cliente]

---

### 6. Medios problemáticos

| medio | problema | acción recomendada |
|---|---|---|
| {{nombre}} | {{cuerpo_vacio / feed_viejo / 0_notas}} | {{reparar / escalar}} |

---

### 7. Texto limpio

| métrica | valor |
|---|---|
| Noticias con texto_cuerpo_nota (24h) | {{N}} / {{total}} |
| % texto OK | {{pct}}% |
| % cuerpo vacío | {{pct}}% |
| Mediana chars | {{N}} |

Fuentes de mayor riesgo de boilerplate: {{lista}}

---

### 8. Gaps PressClipping vs Ethos

_Basado en 05_Comparativo_PressClipping y audit-replacement-readiness._

| categoría | cantidad |
|---|---|
| SOLO_PRESSCLIPPING total | {{N}} |
| GAP_REAL_ACCIONABLE | {{N}} ({{pct}}%) |
| SINDICADA_LOW_VALUE | {{N}} |
| SOLO_ETHOS | {{N}} |
| MATCH | {{N}} |
| Cobertura bruta | {{pct}}% |
| Cobertura ajustada | {{pct}}% |

Top medios con gap accionable: {{lista}}
Top keywords con gap: {{lista}}

---

### 9. Mery Pozos / persona pública (CLI-MERY-TEST)

| campo | valor |
|---|---|
| Menciones hoy | 0 |
| Matches últimos 7 días | 0 |
| FP detectados | 0 |
| Estado | SHADOW_CONFIG_OK_SIN_DATOS |
| alertas_activas | false (inmutable hasta autorización) |
| Última simulación | `npm run simulate-mery-pozos-shadow -- --window-days=7` |

_Sin cobertura hasta ahora. El sistema detectará automáticamente en el próximo crawl._

---

### 10. Riesgos

| riesgo | nivel | acción |
|---|---|---|
| Texto limpio < 80% | Medio | enrich-news para medios prioritarios |
| SOLO_PRESSCLIPPING > 70 accionables | Alto | expandir fuentes o reparar crawl |
| P1 FP estimado > 10% | Alto | revisar reglas contextuales del cliente |
| 10_Alertas_Sombra mismatch | Alto | verificar write.ts / Sheets |
| Mery Pozos 0 matches por 14+ días | Info | revisar fuentes Jalisco/político en cron |

---

### 11. Siguiente acción

```
Hoy:
[ ] Revisar P1s nuevas → confirmar FP o escalar
[ ] Verificar medios con cuerpo_vacio > 90% → escalar a enrich
[ ] Correr rolling-readiness-backtest -- --window-days=7

Esta semana:
[ ] Evaluar gate GO_ENVIO_INTERNO_LIMITADO para CLI-0002
[ ] Ejecutar simulate-mery-pozos-shadow -- --window-days=7
[ ] Revisar medios accionables con gap Reforma laboral

```

---

## Cómo generar el reporte

### Opción A — Comandos individuales (recomendado)

```bash
# Backtest rolling 7 días por cliente
npm run rolling-readiness-backtest -- --window-days=7

# Simulación Mery Pozos (7 días más recientes)
npm run simulate-mery-pozos-shadow -- --window-days=7

# Auditoría de readiness vs PressClipping
npm run audit-replacement-readiness

# Shadow alerts (escribe 10_Alertas_Sombra)
npm run shadow-alerts -- --no-send --no-whatsapp --no-email

# Auditoría de extracción
npm run audit-extraction-quality -- --window-days=7
```

### Opción B — Script de reporte automático (PENDIENTE DE IMPLEMENTAR)

```bash
npm run generate-shadow-report
```

> Script pendiente: `scripts/generate-internal-daily-shadow-report.ts`
> Generaría salida markdown local, sin SMTP, sin Gmail, sin Google Docs.

---

## Reglas de seguridad del reporte

- Nunca escribir en 01_Noticias_Raw, 02_Menciones, 04_Logs
- Nunca activar `alertas_activas=true`
- Nunca llamar SMTP real, Twilio, Gmail
- Toda escritura a 10_Alertas_Sombra requiere readback y mismatch=false
- `--dry-run` en shadow-alerts fuerza `output=console` (no escribe en Sheet)
- El reporte es solo para uso interno del equipo Ethos

---

## Estado actual del sistema (2026-07-11)

### Rolling backtest 7 días

| cliente_id | menciones | días activos | alertas | keywords | estado |
|---|---|---|---|---|---|
| CLI-0001 | 5 | 5 | 3 | 3 | ACTIVO_ESTABLE |
| CLI-0002 | 54 | 8 | 26 | 11 | ACTIVO_ESTABLE |
| CLI-0003 | 274 | 8 | 32 | 9 | ACTIVO_ESTABLE |
| CLI-MERY-TEST | 0 | 0 | 0 | 0 | SHADOW_CONFIG_OK_SIN_DATOS |

### Readiness por cliente (audit-replacement-readiness)

| cliente_id | cobertura_vs_pc | alertas_score | estado_readiness |
|---|---|---|---|
| CLI-0001 | 0% | 62.9 | NO_LISTO |
| CLI-0002 | 0% | 9.7 | NO_LISTO |
| CLI-0003 | 0% | 33.0 | NO_LISTO |
| CLI-MERY-TEST | N/A (shadow) | N/A | SHADOW_CONFIG_OK_SIN_DATOS |

> `cobertura_vs_pc=0%` significa que el comparativo actual en 05_Comparativo muestra
> 76 SOLO_PRESSCLIPPING vs 21 SOLO_ETHOS y 0 MATCH. Esto indica que el matching de
> PressClipping vs Ethos aún no está produciendo coincidencias directas — el sistema
> detecta noticias DIFERENTES a las de PressClipping o en ventanas de tiempo distintas.
> No es señal de que Ethos no funcione: el shadow-alerts muestra 333 menciones en 7 días.

### 10_Alertas_Sombra

- Comportamiento `--dry-run`: **fijado** — ahora fuerza `output=console` (no escribe)
- Modo normal sin `--dry-run`: escribe en Sheet con readback obligatorio
- Última escritura: 72 filas, mismatch=false (sesión anterior — era un run real, no dry-run)

---

## Siguiente gate para producción interna

**GO_ENVIO_INTERNO_LIMITADO (CLI-0002)**

Requerimientos pendientes:
- [ ] `alertas_score >= 50` en rolling backtest — CLI-0002 tiene 9.7 actualmente
- [ ] 3 corridas limpias sin mismatch en 10_Alertas_Sombra
- [ ] P1 FP estimado ≤ 10%
- [ ] Credenciales SMTP internas cargadas fuera del repo (no commiteadas)
- [ ] `GO_ENVIO_INTERNO_LIMITADO=true` — requiere autorización explícita

Nota: `alertas_score=9.7` para CLI-0002 está bajo porque el script de auditoría usa
el comparativo PressClipping (05). El backtest de Supabase muestra 54 menciones en 7 días
con 26 alertas — lo que indica actividad real. El score bajo refleja falta de matching
en el comparativo, no ausencia de detección.
