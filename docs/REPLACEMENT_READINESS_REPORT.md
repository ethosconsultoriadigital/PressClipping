# Reporte de Readiness de Sustitución — Ethos vs PressClipping

> Documento honesto de observabilidad. **Ethos NO está listo para sustituir
> PressClipping globalmente.** Hoy es un **shadow diagnóstico** medible. Este
> reporte hace auditable esa afirmación con datos reales de la última corrida.
>
> Generado por: `npm run audit-replacement-readiness` + `npm run audit-extraction-quality`
> (ambos SOLO LECTURA, sin envíos, sin IA, sin tocar producción).

---

## 1. Estado general

| Dimensión | Valor | Lectura |
|---|---|---|
| Cobertura ajustada (último run) | **0%** | match = 0 en la última corrida |
| SOLO_PRESSCLIPPING | 121 | 92.6% clasificado "gap real accionable" (cota superior) |
| SOLO_ETHOS | 8 | señal propia mínima en la ventana |
| Calidad de extracción (global) | 15.3% ≥600 chars | dominado por universo RSS sin cuerpo |
| Alertas sombra (10) | trazables por columna | P1/P2/BLOQUEADA/DUPLICADA + cluster_id explícitos |
| Envío real | **desactivado** | módulo interno disabled by default |

**Dictamen:** shadow estable y ahora medible. El bloqueador #1 para *medir*
sustitución no es cobertura sino que **la última comparación da 0 MATCH** con
121 registros PC y 8 menciones Ethos: eso apunta a un problema de
comparación/atribución (ventana, normalización de URL o import PC), no a que
existan 112 gaps de descubrimiento reales. Hasta resolver el 0-match, los
porcentajes de cobertura no son confiables como evidencia de reemplazo.

---

## 2. Último run auditado

```
run_id                  = RUN-2026-07-08T05-00-22-581Z
pressclipping_registros = 121
ethos_menciones         = 8
match                   = 0
solo_pressclipping      = 121
solo_ethos              = 8
cobertura_bruta         = 0
cobertura_ajustada      = 0
```

`match = 0` es la señal más importante: con 121 vs 8 y cero cruces, lo probable
es **desalineación de la comparación** (ventana temporal distinta entre import
PC y menciones Ethos, o normalización de URL/título), no 112 descubrimientos
perdidos. Prioridad: reproducir el cruce con la misma ventana y revisar
`normalizeUrl`/`diferencia_dias`.

---

## 3. Cobertura vs PressClipping

- **Cobertura bruta:** 0% (todos los SOLO_PRESSCLIPPING penalizan).
- **Cobertura ajustada:** 0% (solo penalizan los gaps accionables).
- Ambas iguales porque `match = 0`.

La cobertura ajustada es la métrica ejecutiva (excluye ruido de PC). Se calcula
`match / (match + solo_pc_accionable)`, excluyendo `CLI-PRUEBA`.

---

## 4. SOLO_PRESSCLIPPING por categoría (clasificación determinística fila por fila)

Clasificador: `src/comparators/soloPressclippingClassifier.ts` (sin IA, reglas
sobre `estado_comparativo`, `medio`, `keyword`, `titulo`, `razon_posible`,
`categoria` previa, `score_similitud`, `diferencia_dias`).

| categoria_gap | cantidad | % | acción |
|---|---|---|---|
| GAP_REAL_ACCIONABLE | 112 | 92.6% | priorizar cobertura (alta/reparación de fuente) |
| SINDICADA_DUPLICADA_LOW_VALUE | 9 | 7.4% | descartar (bajo valor) |
| PC_FALSE_POSITIVE | 0 | 0% | — |

> **Advertencia honesta:** el 92.6% "accionable" es una **cota superior**. El
> clasificador es conservador: si una fila no tiene señal de ruido, la marca
> accionable. Con `match = 0`, buena parte de esas 112 son casi seguro artefactos
> de comparación (window/normalización), no descubrimientos reales. Requieren
> revisión humana antes de tratarlas como brecha de cobertura.

**Top keywords con gap accionable:** Tequila (55), Reforma laboral (20), Jumex
(14), Impuesto Bebidas Alcohólicas (11), Consejo regulador del tequila (3),
Bacardí (3), Tequila Patrón (3).

**Top medios con gap accionable:** lado.mx (5), La Crónica de Hoy (4), Momento
Diario (3), Milenio (3), Marca México (3), El Heraldo de México (2), Xeu (2),
Talajalisco (2), Telediario (2), NTR Guadalajara (2).

---

## 5. SOLO_ETHOS por categoría

- SOLO_ETHOS total (ejecutivo): 7–8 en la ventana.
- Sin falsos positivos evidentes por `categoria` en la muestra.
- Volumen bajo: la señal propia de Ethos es escasa en esta ventana concreta,
  coherente con que la mayoría del universo capturado no tiene cuerpo (ver §6).

---

## 6. Calidad de extracción (01_Noticias_Raw / 02_Menciones)

Muestra: **6,000 noticias / 826 menciones** (ventana 120 días).

| Métrica | Valor |
|---|---|
| % título válido | 86.7% |
| % URL válida | 100% |
| % fecha válida | 99.3% |
| % medio válido | 100% |
| % texto ≥ 600 chars | 15.3% |
| % texto ≥ 1200 chars | 13.7% |
| **% cuerpo vacío** | **83.8%** |
| % encoding sospechoso | 0.3% |
| % boilerplate | 0% |
| % listing/sección | 0.4% |
| % duplicados por URL norm | 0.5% |
| % duplicados por título similar | 1.5% |

**Interpretación clave (matiz honesto):** el 83.8% de cuerpos vacíos está
dominado por el **universo de descubrimiento RSS** de los crons base, donde
Ethos guarda el titular pero **no extrae cuerpo** salvo en notas enriquecidas.
No es "extracción rota" en todos lados: donde el enrichment corre, la extracción
es **excelente**.

**Medios EXCELENTE / BUENA (extracción real, mediana alta):**
El Sol de Irapuato (100% ≥600, mediana 3223), El Otro Enfoque (100%, 2029),
Revista Espejo (100%, 3415), Zeta Tijuana (94.9%), Uno TV (98.8%, 2383),
Publimetro (78.3%, 2195), UNO MAS UNO (82.1%), ZonaDocs, Kiosco Informativo,
Diario Humano, Punto Norte, La Orquesta, Siete24, Posta, TV4.

**Medios SIN_CUERPO (100% vacías en la muestra — solo titular RSS):**
El Heraldo de México (511), El Imparcial Sonora (476), El Informador (402),
El Diario de Chihuahua (371), La Crónica de Hoy (346), Zócalo (342),
El Economista (342), La Razón (314), Vanguardia (267), ContraRéplica (204),
El Financiero (203), Periódico Correo (190), El Sol de México (186),
Proceso (154), Los Noticieristas (123), Forbes México (113), Expansión (71),
Xataka, Notus, Amexi, Líder Empresarial, EdoMex Al Día, Hidrocálido.

**Encoding:** único medio con mojibake relevante = **Uniradio Informa (MED-0087),
60% encoding sospechoso** → revisar decodificación del extractor de ese medio.

---

## 7. Alertas sombra (10_Alertas_Sombra)

Nuevas columnas explícitas escritas y validadas (readback ok, `mismatch=false`):
`prioridad_alerta, es_p1, es_p2, estado_alerta, motivo_bloqueo, es_duplicada,
cluster_id, cluster_key, cluster_tema, cluster_region, cluster_count, sin_envio,
canal, workflow, tier, fuente, shadow_client_allowlist, send_enabled,
whatsapp_enabled, email_enabled`.

Corrida de observación (`--observe-only`, sin envío):

```
menciones_evaluadas = 84
P1 inmediata        = 10
P2 resumen          = 35
BLOQUEADA           = 7
DUPLICADA           = 32
filas_10_escritas   = 84   readback = 84   mismatch = false
send = false  whatsapp = false  email = false
```

- **cluster_id** ahora se calcula estable y determinístico
  (`cliente_id | familia_keyword | región | fecha_cluster`) y permite medir
  duplicadas/fatiga. Las filas históricas quedan sin `cluster_id` (migran hacia
  adelante); las nuevas ya lo llevan.
- Histórico acumulado en 10: ~4.9k filas, con fuerte volumen de DUPLICADA
  (fatiga) — justamente lo que `cluster_id` + digest permiten consolidar.

---

## 8. Readiness por cliente (excluye CLI-PRUEBA)

> `readiness_excluye_cli_prueba = true`. CLI-PRUEBA / "Cobertura Local Prueba"
> se marcan `SOLO_TEST` y **no** cuentan en métricas ejecutivas (no se borran).

| cliente | cobertura_vs_pc | gap_real | precisión_est | extracción | alertas | estado | siguiente acción |
|---|---|---|---|---|---|---|---|
| CLI-0001 Jumex | 0% | — | baja | 15 | por poblar | **NO_LISTO** | auditoría dedicada de cobertura |
| CLI-0002 Bebidas alcohólicas (crisis) | 0%* | alto | media | alto en sus medios | P1 real | **SHADOW_ESTABLE / candidato piloto interno** | cerrar el 0-match y afinar precisión |
| CLI-0003 Reforma laboral | 0% | alto | media | mixto | P1 real | **NO_LISTO / shadow** | cerrar el 0-match; no real |
| CLI-PRUEBA | — | — | — | — | — | **SOLO_TEST** | excluir de readiness |

\* El 0% es efecto del `match=0` global (problema de comparación), no evidencia
de que CLI-0002 carezca de cobertura: sus medios de crisis (El Sol de Irapuato,
El Otro Enfoque, UNO MAS UNO) extraen excelente y generaron P1 shadow reales.

**Nota lista para `07.notas`** (emitida por el script; ver §11 sobre por qué no
se escribió automáticamente):

```
readiness_excluye_cli_prueba=true; readiness_global=0;
readiness_cli0001=NO_LISTO; readiness_cli0002=NO_LISTO; readiness_cli0003=NO_LISTO;
solo_pc_accionable_pct=92.6; alertas_con_cluster_id=<n filas nuevas>
```

---

## 9. Top 20 gaps accionables (para revisión humana primero)

Dominados por dos familias (a validar contra el 0-match antes de accionar):

1–14. **Tequila / bebidas** (CLI-0002): tequila adulterado, impuesto bebidas
alcohólicas, consejo regulador, Bacardí, Tequila Patrón — medios lado.mx,
Momento Diario, Marca México, Talajalisco, NTR Guadalajara.
15–18. **Reforma laboral** (CLI-0003): huelga/sindicato — La Crónica, El
Informador, Periódico Correo, Milenio.
19–20. **Jumex** (CLI-0001): bebidas azucaradas / programa escolar — La Crónica,
El Heraldo.

Exportable completo a `data/audit-replacement-readiness.json` con `--json`.

---

## 10. Medios prioritarios

- **Reparar extracción (alto impacto, alto volumen):** El Heraldo, El Imparcial,
  El Informador, El Economista, La Razón, El Financiero, Forbes, Proceso,
  Periódico Correo, La Crónica de Hoy — todos con cuerpo vacío en RSS. Evaluar si
  merece extraer cuerpo del universo base o solo de matches (decisión de costo).
- **Corregir encoding:** Uniradio Informa (MED-0087, 60% mojibake).
- **Mantener (ya excelentes):** El Sol de Irapuato, El Otro Enfoque, Revista
  Espejo, Zeta Tijuana, Uno TV, Publimetro, UNO MAS UNO.

Conteo de cobertura de medios (08): en_cron = 34, ready_no_cron = 27,
repairable = 25, blocked = 5.

---

## 11. Umbrales para sustituir (propuestos)

Por cliente, para pasar de shadow a **piloto interno** (nunca cliente externo aún):

- cobertura_ajustada ≥ 70%
- precisión estimada ≥ 85%
- extracción score ≥ 70% (texto ≥600 en medios del cliente)
- alertas con cluster_id ≥ 70% y duplicadas controladas
- 0-match resuelto (comparación reproducible)

Estados: `LISTO_PARA_PILOTO_INTERNO`, `SHADOW_ESTABLE_NO_REAL`,
`NECESITA_MAS_COBERTURA`, `NO_LISTO`, `SOLO_TEST`
(`src/comparators/replacementReadiness.ts`).

---

## 12. Plan 24–48h

1. **Diagnosticar el 0-match** (bloqueador #1): reproducir la comparación con la
   misma ventana de import PC vs menciones Ethos; revisar `normalizeUrl` y
   `diferencia_dias`. Sin esto, todo % de cobertura es ruido.
2. Reclasificar los 121 SOLO_PC ya con datos correctos (esperado: FP/sindicado
   suba, GAP_REAL baje muy por debajo de 112).
3. Revisar encoding de Uniradio Informa.

## 13. Plan 1 semana

1. Decidir política de extracción de cuerpo para medios base (universo vs match).
2. Afinar keywords CLI-0002 (tequila/alcohol adulterado) y CLI-0003 (huelga).
3. Consolidar fatiga de alertas usando `cluster_id` + digest (reducir DUPLICADA).
4. Volver a correr readiness y comparar contra estos umbrales.

## 14. Qué falta antes de sustituir

- Resolver 0-match y tener cobertura ajustada real (no artefacto).
- Subir extracción de cuerpo donde se necesita full-text.
- Validar precisión por cliente con muestra humana.
- **No hay envío real habilitado**; sustitución global sigue descartada.
  CLI-0002 es el único candidato a **piloto interno** (no externo) tras cerrar
  el 0-match.

---

### Anexos técnicos

- `10_Alertas_Sombra`: 25 columnas originales preservadas + 19 nuevas de
  observabilidad (append, sin reordenar). Writer: `ensureOutputHeaders` +
  `appendHistoryRows` en `run-shadow-alerts.ts`.
- Clasificador SOLO_PC: `src/comparators/soloPressclippingClassifier.ts`.
- Readiness: `src/comparators/replacementReadiness.ts` +
  `scripts/audit-replacement-readiness.ts`.
- Calidad extracción: `src/comparators/extractionQuality.ts` +
  `scripts/audit-extraction-quality.ts`.
- cluster_id: `computeClusterFields` en `src/notifications/grouping.ts`.
