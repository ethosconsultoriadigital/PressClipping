# Unified Matching V2 — cuerpo editorial confiable

Ancla arquitectónica. **No está activo en producción.** Flag: `BODY_MATCHING_V2=false` (default).

## Motivo

El clipping real contiene menciones cuyo nombre **no aparece en título/resumen**. Ejemplos: título “No hay agua nuevamente en Guadalajara” con la empresa en el cuerpo; editorial “La Tremenda Corte” con “Mery Gómez Pozos” solo en el cuerpo.

La exclusión previa del BODY fue una defensa temporal contra **texto_extraido contaminado** (notas relacionadas, scroll infinito, teasers, nav, footer). El extractor ya produce `texto_cuerpo_nota` / `texto_nota_limpia`. El problema no era el cuerpo editorial; era el RAW concatenado.

## Fuga vs ruido

- Fuga demostrada: canary Milenio `noticia_id=498630e1-5b8e-42d2-b6c5-cbc70387004f` (Mery en cuerpo, no en título). `public.menciones` sí; MASTER no.
- Ruido histórico: 166 filas MASTER `campo_match=TEXTO_EXTRAIDO` en ventana 2026-09-29 20:46–21:07 UTC. No reescribir esas filas. Impedir que vuelvan a nacer.

## Política de campos

**Señal (siempre):** `titulo`, `subtitulo`, `resumen`, `seccion`.

**BODY:**

1. `texto_cuerpo_nota` (prioridad)
2. `texto_nota_limpia` solo como fallback medido (`body_high_plus_clean`)

**Prohibido como evidencia productiva:** `texto_extraido` RAW.

## Trusted body

`selectTrustedBody` / `buildTrustedMatchingFields`:

| Status | Significado |
| --- | --- |
| BODY_TRUSTED | cuerpo ≥ 80 chars, `calidad_extraccion=alta`, sin contaminación fuerte |
| BODY_FALLBACK_CLEAN | solo modo plus_clean: limpia ≥ 80, calidad alta o media |
| BODY_REJECTED | hay texto pero no pasa el gate |
| NO_BODY | sin capas de cuerpo |

Contaminación fuerte: encabezado de relacionadas y ≥35% del texto después del corte.

## Matching

Se evalúan **todos** los campos confiables (no se corta al primer hit). Consolidación 1 noticia + 1 cliente = 1 fila. Dedupe `cliente_id//noticia_id`. `keywords_matched` puede unir hits de varios campos. `campo_match` del mejor score: `TEXTO_CUERPO_NOTA` (nunca `TEXTO_EXTRAIDO` en V2 productivo).

Pesos: título 1.0, subtítulo 0.8, resumen 0.6, sección 0.5, cuerpo 0.4, limpia 0.35.

Keywords específicas (nombre completo, marca, razón social) conservan alta confianza en cuerpo. Keywords amplias conservan `tipo_keyword`, `contexto_incluir/excluir` y `contextualKeywordRules`.

## Proximity (shadow)

Candidato ±400 chars alrededor del hit **solo** para términos amplios/contextual. No se aplica a frases inequívocas (p.ej. “Mery Gómez Pozos”). No activar en producción sin autorización.

## Canary

URL: https://www.milenio.com/opinion/editoriales/la-tremenda-corte-jalisco/la-tremenda-corte_2462  
EXPECTED V2: MATCH `CLI-MERY-TEST`, `campo_match=TEXTO_CUERPO_NOTA`, `dedupe_key=cli-mery-test//498630e1-5b8e-42d2-b6c5-cbc70387004f`.

## Rollout

1. Shadow 48h / 7d (completado, e9f7f905)
2. **Canary selectivo Mery frase_exacta EN FAST LANE** — KEY-0040..0047, KEY-0076, KEY-0077
3. Detector (`DETECT_MENTIONS_BODY_V2`) permanece apagado
4. Marcas / CLI-0003 / KEY-0048..0051: sin BODY

`nota completa` en MASTER: `texto_cuerpo_nota` → `texto_nota_limpia` → `resumen`. Nunca `texto_extraido` RAW.

## Flags (separados)

| Flag | Superficie | Default |
| --- | --- | --- |
| `MENTIONS_MASTER_BODY_V2` | Fast Lane → MASTER | false |
| `MENTIONS_MASTER_BODY_V2_KEYWORD_IDS` | Allowlist `KEY-…` | vacío = no BODY |
| `DETECT_MENTIONS_BODY_V2` | `detectMentionsCore` / `public.menciones` | false |
| `BODY_MATCHING_V2` | **deprecado**; no habilita MASTER ni detector | false |

Semántica MASTER: todas las keywords siguen evaluando título/subtítulo/resumen/sección. BODY_TRUSTED (`texto_cuerpo_nota` + calidad alta) **solo** para IDs allowlisted. 1 noticia + 1 cliente = 1 fila.

Canary 1 **activo en Fast Lane GHA**: KEY-0040..0047, KEY-0076, KEY-0077. Excluye KEY-0048..0051.

Canary 2 marcas (shadow only): KEY-0060, 0061, 0070–0073.

No BODY para KEY-0017/0019/0021 ni tequila/mezcal/COFEPRIS/aranceles.

## Guardrails

- No WhatsApp / email / Twilio / alertas
- No Apps Script / triggers / vistas derivadas
- No append BODY_ONLY de keywords no allowlisted
- No backfill histórico forzado
- Fast Lane canary Mery frase_exacta vía env GHA; resto CURRENT
- No activar `BODY_MATCHING_V2` global
- GHA Fast Lane define `MENTIONS_MASTER_BODY_V2` + allowlist Mery. No define `DETECT_MENTIONS_BODY_V2` ni `BODY_MATCHING_V2`.
- Agent A / catálogo de medios: no tocar

## Métricas

`body_available`, `body_trusted`, `body_fallback_clean`, `body_rejected`, `signal_matches`, `body_matches`, `body_only_matches`, `multi_field_matches`, `raw_text_rejected`, `dedupe_suppressed`, `rows_appended` (+ desglose cliente/keyword/medio en shadow).

Script: `npm run mentions-matching:shadow-v2`  
Canary shadow (sin writes): `npm run mentions-matching:selective-canary-shadow`

## Rollback

Dejar `MENTIONS_MASTER_BODY_V2` unset/false y allowlist vacía. Fast Lane vuelve a CURRENT. Detector no se toca.

## Política V1 recomendada (pendiente de autorización)

Activar **solo** `body_high` (`texto_cuerpo_nota` + calidad alta). No fallback limpia automático. No proximity automática. No RAW.
