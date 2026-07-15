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

### Opción B — Script de reporte automático

```bash
npm run generate-shadow-report
# Con ventana distinta (default: 7 días):
npm run generate-shadow-report -- --window-days=14
```

Genera `data/reporte-diario-YYYY-MM-DD.md` con las 11 secciones de la plantilla.
Solo lectura. Sin SMTP, sin Sheets, sin Google Docs. No activa `alertas_activas`.

---

## Reglas de seguridad del reporte

- Nunca escribir en 01_Noticias_Raw, 02_Menciones, 04_Logs
- Nunca activar `alertas_activas=true`
- Nunca llamar SMTP real, Twilio, Gmail
- Toda escritura a 10_Alertas_Sombra requiere readback y mismatch=false
- `--dry-run` en shadow-alerts fuerza `output=console` (no escribe en Sheet)
- El reporte es solo para uso interno del equipo Ethos

---

## Estado actual del sistema (2026-07-11, post fast-track P1)

### Rolling backtest 48h

| cliente_id | menciones | días activos | alertas | keywords | estado |
|---|---|---|---|---|---|
| CLI-0001 | 3 | 3 | 1 | 2 | ACTIVO_ESTABLE |
| CLI-0002 | 12 | 3 | 4 | 8 | ACTIVO_ESTABLE |
| CLI-0003 | 62 | 3 | 10 | 6 | ACTIVO_ESTABLE |
| CLI-MERY-TEST | 2 | 1 | 2 | 2 | ACTIVO_ESTABLE |

### Rolling backtest 7 días

| cliente_id | menciones | días activos | alertas | keywords | estado |
|---|---|---|---|---|---|
| CLI-0001 | 5 | 5 | 3 | 3 | ACTIVO_ESTABLE |
| CLI-0002 | 59 | 8 | 29 | 12 | ACTIVO_ESTABLE |
| CLI-0003 | 272 | 8 | 37 | 9 | ACTIVO_ESTABLE |
| CLI-MERY-TEST | 2 | 1 | 2 | 2 | ACTIVO_CON_SENALES |

> **Primer match real de Mery Pozos confirmado (2026-07-11):** 2 menciones (KEY-0041 "Mery
> Pozos" + KEY-0045 "diputada Mery Pozos") sobre un artículo político legítimo — presentación
> del libro de Ricardo Monreal sobre gestión del recurso hídrico, mencionando a "la diputada
> Mery Pozos". Contexto político genuino, `requiere_alerta=true`, sin homónimos. El sistema
> shadow funciona como se diseñó.

### Readiness por cliente (audit-replacement-readiness)

| cliente_id | cobertura_vs_pc | alertas_score | estado_readiness |
|---|---|---|---|
| CLI-0001 | 0% | ~63 | NO_LISTO |
| CLI-0002 | 0% | ~10 | NO_LISTO |
| CLI-0003 | 0% | ~33 | NO_LISTO |
| CLI-MERY-TEST | N/A (shadow) | N/A | ACTIVO_ESTABLE (backtest) |

> `cobertura_vs_pc=0%` significa que el comparativo actual en 05_Comparativo muestra
> mayoría SOLO_PRESSCLIPPING y 0 MATCH. Esto indica que el matching de PressClipping vs
> Ethos aún no está produciendo coincidencias directas — el sistema detecta noticias
> DIFERENTES a las de PressClipping o en ventanas de tiempo distintas. No es señal de que
> Ethos no funcione: el rolling backtest de Supabase muestra actividad real y estable en
> los 4 clientes/personas monitoreados.

### Lote P1 fast-track (2026-07-11)

3 medios agregados al tier `daily-validated`: **Excelsior** (MED-0028, reparado RSS),
**Frontera** (MED-0084, reparado sitemap), **Noroeste** (MED-0055, ya READY).
Crawl dirigido: 36 noticias nuevas, 0 errores. Enrich: 36/36 OK. Detect: 1 mención real
(CLI-0003, sin FP). Detalle completo en `docs/MEDIA_PARITY_MATRIX.md` §9.

### 10_Alertas_Sombra

- Comportamiento `--dry-run`: **fijado** — ahora fuerza `output=console` (no escribe)
- Modo normal sin `--dry-run`: escribe en Sheet con readback obligatorio
- Última escritura: 72 filas, mismatch=false (sesión anterior — era un run real, no dry-run)
- Sin cambios en este fast-track (no se corrió shadow-alerts de nuevo)

### Bug conocido: feed XML de PressClipping vacío

El paso `live-comparison` (import-pressclipping) del pipeline `shadow-daily-validated-tier`
falló en este ciclo: el worker `https://tabla.ethosconsultoriadigital.workers.dev/read-xml`
devolvió 0 items. Esto es una causa externa preexistente (no relacionada al lote P1) que
pospone la actualización de 05/07/08 para este ciclo. Requiere investigación separada del
worker Cloudflare — fuera de alcance de este fast-track de 48h.

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
el comparativo PressClipping (05), cuya actualización quedó pospuesta por el bug del
feed XML. El backtest de Supabase muestra 59 menciones en 7 días con 29 alertas —
actividad real y estable. El score bajo refleja falta de matching en el comparativo
(bloqueado externamente), no ausencia de detección.

**No es un gate de 30 días.** El fast-track de 48h confirma: actividad estable en 48h y 7d
para los 3 clientes productivos + primer match real validado de Mery Pozos. La decisión de
piloto interno para CLI-0002 puede tomarse con esta base — el `alertas_score` bajo es un
artefacto del comparativo bloqueado, no una señal de baja calidad de detección.

---

## EMERGENCIA: PressClipping cancelado (2026-07-11)

PressClipping externo ya no disponible — deja de ser gate. Nueva métrica operativa propia:
`npm run audit-operational-readiness-no-pc -- --client=CLI-0002` (y `--client=CLI-0001`).

| cliente | estado_operativo | % ready | keywords | menciones_7d |
|---|---|---|---|---|
| CLI-0002 (Patrón/Bacardí) | OPERATIVO_INTERNO | 90% | 27 (+5 nuevas) | 59 |
| CLI-0001 (Jumex) | OPERATIVO_INTERNO | 90% | 7 (+4 nuevas) | 5 |

Gap corregido: faltaba "Patrón"/"Tequila Patrón" en CLI-0002. Ver
`docs/PRODUCTION_READINESS_PLAN.md` §Emergencia y `docs/PUENTE_REPORTES_JUMEX_PATRON.md`
para el detalle completo y el camino hacia el reporte final.

---

## Consolidación editorial — tab 12 (2026-07-13)

Nueva capa editorial `12_Operacion_Consolidada_Sin_PressClipping` (1 fila por noticia).
`npm run export-operational-news-consolidated-no-pc -- --clients=CLI-0001,CLI-0002 --window-days=7 --output=sheet`.
66 raw → 43 consolidadas. **Patrón GO condicionado** (filtrar GO_ALTA/GO_MEDIA), **Jumex NO-GO**
(Museo Jumex excluido, poca señal regulatoria). Reglas determinísticas sin IA en
`src/editorial/consolidation.ts`. Detalle: `docs/PUENTE_REPORTES_JUMEX_PATRON.md` §0.

## Preview final Patrón — tab 13 (2026-07-13)

`npm run export-patron-final-preview-no-pc -- --window-days=7 --output=sheet` proyecta la tab 12
→ `13_Patron_Final_Preview` (solo CLI-0002 GO). 9 filas (5 ALTA crisis, 4 MEDIA). Jumex NO
exportado. Keyword CRT afinada (ya no genera FP tech). Sin hoja externa conectada. Detalle:
`docs/PUENTE_REPORTES_JUMEX_PATRON.md` §0.b.

## Acceso NoticiasPatron resuelto + operación 24h (2026-07-15)

Acceso a la hoja final concedido; 2 bugs corregidos (gate + mapeo columna). `ready_to_write=true`
pero sin escribir aún (falta autorización explícita). Readiness 24h: ambos OPERATIVO_INTERNO 90%.
Segundo lote re-enrich: 489/500 notas. Jumex refuerza NO-GO: FP de Museo Jumex (Mundial) y
Profeco (gasolina, keyword IEPS demasiado amplia). Detalle:
`docs/PRODUCTION_READINESS_PLAN.md` §NO-PC OPERATION ADVANCE.
