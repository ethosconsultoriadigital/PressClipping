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

1. Shadow (48h / 7d) — esta fase  
2. Canary humano  
3. Producción con `BODY_MATCHING_V2=true` **solo con autorización**

## Guardrails

- No WhatsApp / email / Twilio / alertas
- No Apps Script / triggers / vistas derivadas
- No append BODY_ONLY a MASTER hasta autorización
- No backfill
- Fast Lane default permanece título+resumen+sección
- Agent A / catálogo de medios: no tocar

## Métricas

`body_available`, `body_trusted`, `body_fallback_clean`, `body_rejected`, `signal_matches`, `body_matches`, `body_only_matches`, `multi_field_matches`, `raw_text_rejected`, `dedupe_suppressed`, `rows_appended` (+ desglose cliente/keyword/medio en shadow).

Script: `npm run mentions-matching:shadow-v2`

## Rollback

Dejar `BODY_MATCHING_V2` unset/false. No hay filas V2 en MASTER si no se escribió. Código flag-off = política CURRENT.

## Política V1 recomendada (pendiente de autorización)

Activar **solo** `body_high` (`texto_cuerpo_nota` + calidad alta). No fallback limpia automático. No proximity automática. No RAW.
