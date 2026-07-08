# Paquete de Revisión — Piloto Interno CLI-0002 (P1)

> **SIN ENVÍO.** Este documento es una revisión humana de las alertas P1 que el
> módulo *generaría* para el piloto interno de CLI-0002. El módulo está
> **disabled by default**: en el dry-run todas quedaron `blocked`. No se envió
> nada, no hay destinatarios reales, no hay secretos.

- **Fecha**: 2026-07-08 (UTC-6).
- **Fuente de datos**: `10_Alertas_Sombra` (observación shadow).
- **Run shadow que las generó (crisis)**: `28915825440` · headSha `ab32bcb` ·
  `2026-07-08T03:42:38Z` · run_id shadow-alerts `SCA-2026-07-08T03-44-04-925Z`.
- **Comando dry-run**:

```bash
npm run send-internal-alerts -- --dry-run --client=CLI-0002 --severity=P1 --limit=10
```

- **Total P1 CLI-0002 disponibles**: 162 (histórico en `10_Alertas_Sombra`).
- **Seleccionadas para revisión**: 10 (últimas por orden de aparición).
- **Resultado del módulo**: `would_send=0`, `enviadas=0`, `bloqueadas=10`
  (procesadas 5 por `ALERTS_MAX_PER_RUN=5`, resto omitido por tope),
  `reason=real_alerts_disabled`, `envio_real_confirmado=false`.

---

## 1. Plantillas (ejemplo renderizado)

### Email (asunto + cuerpo)

```text
Asunto: [PILOTO INTERNO][CLI-0002][P1] Crisis bebidas — El Sol de Irapuato

🚨 Alerta crítica shadow / PILOTO INTERNO

Cliente:   Bebidas alcohólicas (CLI-0002)
Medio:     El Sol de Irapuato
Título:    Alcohol adulterado en Guanajuato: ahora muere hombre en Irapuato por intoxicación con metanol
URL:       https://oem.com.mx/elsoldeirapuato/local/alcohol-adulterado-en-guanajuato-ahora-muere-hombre-en-irapuato-por-intoxicacion-con-metanol-30829630
Fecha:     2026-07-...
Keyword:   tequila adulterado
Razón P1: P1 inmediata: crisis_bebidas.

Resumen breve: ...

Por qué importa: posible crisis reputacional para el cliente; requiere
revisión humana antes de cualquier acción o contacto con el cliente.

Estado: PILOTO INTERNO / NO CLIENTE. Este mensaje NO fue enviado al cliente.
```

### WhatsApp interno

```text
🚨 *PILOTO INTERNO — CLI-0002*
*Medio:* El Sol de Irapuato
*Título:* Alcohol adulterado en Guanajuato: ahora muere hombre en Irapuato por intoxicación con metanol
*Keyword:* tequila adulterado
*Razón:* P1 inmediata: crisis_bebidas.
*URL:* https://oem.com.mx/elsoldeirapuato/local/alcohol-adulterado-en-guanajuato-ahora-muere-hombre-en-irapuato-por-intoxicacion-con-metanol-30829630
_No enviado a cliente._
```

---

## 2. Las 10 alertas P1 (auditoría humana)

Clasificación: `REAL_CRISIS` · `BORDERLINE` · `FP` · `DUPLICADA` · `NO_ENVIAR`.

| # | medio | título (resumen) | keyword | razón P1 | clasificación | posible FP | observación humana |
|---|---|---|---|---|---|---|---|
| 1 | El Sol de Irapuato | "Piratas del alcohol" contaminan comercio local con bebidas adulteradas en Guanajuato | tequila adulterado | crisis_bebidas | **REAL_CRISIS** | No | Evento núcleo de la crisis GTO. |
| 2 | El Sol de Irapuato | Alerta en Guanajuato por consumo de tequila adulterado: avanzan investigaciones | alcohol adulterado | crisis_bebidas | **REAL_CRISIS** | No | Avance de investigación oficial. |
| 3 | El Sol de Irapuato | Alcohol adulterado en Guanajuato: muere hombre en Irapuato por intoxicación con metanol | tequila adulterado | crisis_bebidas | **REAL_CRISIS** | No | Muerte por metanol — máxima gravedad. |
| 4 | El Sol de Irapuato | Investigan posible caso de intoxicación por alcohol adulterado en Irapuato | intoxicación por alcohol | crisis_bebidas + keyword prioritaria | **REAL_CRISIS** | No | Caso de intoxicación concreto. |
| 5 | El Sol de Irapuato | Casos de intoxicación por alcohol adulterado en GTO y CDMX: batalla contra el tiempo | tequila adulterado | crisis_bebidas + keyword prioritaria | **REAL_CRISIS** | No | Expansión geográfica de la crisis. |
| 6 | El Sol de Irapuato | Irapuato busca frenar reutilización de botellas para combatir alcohol adulterado | alcohol adulterado | crisis_bebidas + keyword prioritaria | **BORDERLINE** | No | Nota de política pública / seguimiento, no evento nuevo. Digest, no inmediata. |
| 7 | Xataka México | El alcohol adulterado encontró un nuevo mercado en México: Facebook y WhatsApp | alcohol adulterado | crisis_bebidas + keyword prioritaria | **BORDERLINE** | No | Reportaje/análisis nacional, no evento local nuevo. Relevante como contexto. |
| 8 | Uno TV Noticias | EE. UU. alerta a turistas por bebidas adulteradas en México | intoxicación por alcohol | crisis_bebidas + keyword prioritaria | **REAL_CRISIS** | No | Alerta sanitaria de gobierno extranjero — impacto reputacional. |
| 9 | Periódico Correo | Familia denuncia a vinatería y hospital tras caso de presunto alcohol adulterado en Irapuato | tequila adulterado | crisis_bebidas + keyword prioritaria | **REAL_CRISIS** | No | Denuncia formal ante Fiscalía. |
| 10 | Notus Noticias | Fiscalía investiga casos de alcohol adulterado en Salamanca e Irapuato | alcohol adulterado | crisis_bebidas + keyword prioritaria | **REAL_CRISIS** | No | Investigación oficial multi-municipio. |

---

## 3. Métricas de la revisión

| métrica | valor |
|---|---|
| P1 revisadas | 10 |
| REAL_CRISIS | 8 |
| BORDERLINE | 2 |
| FP | 0 |
| DUPLICADA (exacta) | 0 |
| NO_ENVIAR | 0 |
| **FP estimado** | **0 %** |
| Cluster temático | 8/10 pertenecen a la misma crisis "alcohol adulterado GTO" (sub-eventos distintos) |

**Observaciones**:

- **Precisión P1 muy alta**: 0 falsos positivos severos; las 2 borderline son
  relevantes (política pública / análisis), no ruido. Ninguna es aranceles/T-MEC,
  turismo sin crisis, clima/deportes ni boilerplate.
- **Riesgo real = fatiga por volumen**, no FP: 8 de 10 son la misma crisis GTO.
  Para envío real conviene **agrupar en digest por cluster** (una alerta P1
  "cabecera" + seguimiento), no 8 mensajes separados. El pipeline ya calcula
  `dedupe_key` y clusters; usarlos para consolidar.
- **Cobertura amplia de medios**: El Sol de Irapuato (OEM), Xataka, Uno TV,
  Periódico Correo, Notus — señal robusta multi-fuente de la misma crisis.

---

## 4. Recomendación de la revisión

- **Preview aprobado**: plantillas correctas, marcadas PILOTO INTERNO, sin datos
  sensibles, con "No enviado a cliente".
- **Precisión suficiente** para piloto interno (FP 0 %).
- **Antes de cualquier envío real**: (a) implementar agrupación por cluster para
  evitar 8 alertas de la misma crisis, (b) configurar destinatarios internos,
  (c) GO firmado (ver `PILOTO_INTERNO_CLI0002_GO_NO_GO.md`).
- **No enviar todavía**: sin credenciales, sin autorización, módulo bloqueado.

---

## 5. Preview agrupado / digest (v2)

> Resuelve el hallazgo de la §3 (fatiga por volumen). El agrupador
> (`src/notifications/grouping.ts`) convierte muchas P1 de la misma crisis en un
> solo **digest** por evento+región. Sigue **sin envío**.

- **Comando**:

```bash
npm run send-internal-alerts -- --dry-run --client=CLI-0002 --severity=P1 --limit=20 --digest
```

- **Total P1 revisadas**: 20 (últimas CLI-0002 P1).
- **Clusters creados**: **2** → **reducción de volumen 20 → 2 (–90 %)**.
- **Resultado módulo**: `would_send=0`, `enviadas=0`, `bloqueadas=4` (2 clusters ×
  2 canales), `reason=real_alerts_disabled`, `envio_real_confirmado=false`.

### Cluster principal — Alcohol/tequila adulterado (Guanajuato)

- **Notas dentro del cluster**: 14.
- **Zonas**: Guanajuato / Irapuato / Salamanca / León.
- **Señales**: alcohol_adulterado, tequila_adulterado, metanol, intoxicación_alcohol.
- **Borderline incluidas**: la nota preventiva de "reutilización de botellas"
  (Irapuato) entra porque comparte evento+región; una revisión humana puede
  degradarla a seguimiento dentro del mismo digest (no genera aviso extra).

**Preview email (digest)**:

```text
Asunto: [PILOTO INTERNO][CLI-0002][P1] Crisis: alcohol/tequila adulterado — Guanajuato / Irapuato / Salamanca / León (14 notas)

🚨 PILOTO INTERNO — CLI-0002
Crisis: alcohol/tequila adulterado
Ubicación: Guanajuato / Irapuato / Salamanca / León
Alertas agrupadas: 14
Nivel: P1
Señales: alcohol_adulterado, tequila_adulterado, metanol, intoxicacion_alcohol

Fuentes:
  1. El Sol de Irapuato — "Piratas del alcohol" contaminan comercio local... — https://oem.com.mx/...
  2. El Sol de Irapuato — Alerta en Guanajuato por consumo de tequila adulterado... — https://oem.com.mx/...
  3. El Sol de Irapuato — Alcohol adulterado en Guanajuato: muere hombre por metanol — https://oem.com.mx/...
  ... (hasta 14)

Por qué importa: múltiples medios reportan la misma crisis; concentra el
seguimiento en un solo aviso para evitar fatiga por volumen. Requiere revisión
humana antes de cualquier acción o contacto con el cliente.

Estado: PILOTO INTERNO / NO CLIENTE. Este mensaje NO fue enviado al cliente.
```

**Preview WhatsApp (digest, compacto)**:

```text
🚨 *PILOTO INTERNO — CLI-0002*
*Crisis:* alcohol/tequila adulterado
*Zona:* Guanajuato/Irapuato/Salamanca/León
*Notas agrupadas:* 14
*Fuentes principales:*
1. El Sol de Irapuato: "Piratas del alcohol" contaminan comercio local...
2. El Sol de Irapuato: Alerta en Guanajuato por consumo de tequila adulterado...
3. El Sol de Irapuato: Alcohol adulterado en Guanajuato: muere hombre por metanol
_(+11 notas más)_
_No enviado a cliente._
```

### Cluster secundario — Nacional (6 notas)

- Ángulo nacional/analítico: Xataka ("nuevo mercado en Facebook/WhatsApp"),
  Uno TV ("EE. UU. alerta a turistas"), El Heraldo (Edomex 900 casos), etc.
- Se mantiene **separado** del cluster GTO por región (no se mezclan eventos de
  zonas distintas), como exige la regla de agrupación.

### Reducción de volumen y fatiga

| | antes | después |
|---|---|---|
| Avisos que recibiría el equipo | 20 individuales | **2 digests** |
| Reducción | — | **–90 %** |

- **FP estimado**: 0 % (igual que la revisión individual; el digest no introduce FP).
- **Riesgo de fatiga**: **mitigado** — de 20 mensajes a 2. El humano ve el evento
  completo con sus fuentes en un solo aviso por región.
