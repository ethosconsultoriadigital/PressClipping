# Fase 0 — Auditoría brownfield (brief de traspaso a sesión local)

> **Propósito:** este documento permite que una sesión de Claude Code corriendo
> **localmente** en `C:\Users\Juanjo\ProyectosCursor` retome la auditoría de
> arquitectura exactamente donde la dejó la sesión remota. Pégalo como contexto
> o pídele al agente local que lo lea primero.
>
> **MODO AUDITORÍA ESTRICTO. No editar, no refactorizar, no migrar, no borrar
> nada. Solo leer, mapear y proponer un plan que se apruebe antes de tocar código.**

---

## 1. Encuadre (rol y principio)

Actúa como **Director de Arquitectura / CTO fraccional**, no como programador de
tickets. Objetivo de la etapa: **alinear** la presentación comercial (visión del
"Agente Integral de RP / PR Intelligence") con lo que **ya existe** en código, y
definir cómo `PressClipping` se vuelve el **cerebro común** (memoria de
notas/menciones) del que cuelgan las demás capas, **sin romper producción**.

Decisiones ya tomadas con el cliente (Juan José, Ethos):
- **Piloto priorizado:** *Press clipping + menciones* (endurecer el core con un
  cliente real antes que regulatorio/alertas/reportes).
- **Vía de auditoría:** local, porque todos los servicios brownfield están en
  `C:\Users\Juanjo\ProyectosCursor`.
- **Migración gradual:** los servicios que hoy toman RSS directo para alertas
  WhatsApp deben **migrar a consumir desde PressClipping**, no borrarse de golpe.
- **Proveedor IA:** el core usa **Claude/Anthropic**; el brownfield usa **OpenAI**.
  Decisión pendiente: unificar o convivir.
- **Memoria:** Supabase/PostgreSQL es la base histórica; Google Sheets sigue como
  panel de control. (Confirmar cuánto tiempo conviven.)

---

## 2. Mapa de capas de la plataforma (estado auditado del core)

```
6. COMMERCIAL / SaaS      planes·límites·usuarios·white-label      ❌ no existe
5. PR INTELLIGENCE AGENT  RAG·narrativa·posturas·crisis            ❌ (FTS ya listo)
4. REPORTING              semanal·mensual·crisis·ejecutivo·PDF     ❌ (XML como base)
3. ALERTING               WhatsApp·email·reglas·severidad          🟡 solo flag requiere_alerta
2. REGULATORY INTEL       DOF·oficiales·cámaras·reformas           ❌ en core (existe en brownfield)
1. PRESSCLIPPING CORE     ingesta·dedupe·menciones·IA·histórico    ✅ Fases 0–7 construidas
   ── Google Sheets (control) · Supabase/PostgreSQL (memoria) ──
```

### Qué tiene HOY el core (`PressClipping`, auditado)
- 8 tablas: `configuracion, medios, clientes, keywords, clusters, noticias,
  menciones, logs_ingesta` (ver `supabase/migrations/0001_initial_schema.sql`).
- FTS español (`tsvector` GIN) + `pg_trgm` + `unaccent` → base lista para RAG/buscador.
- Ingesta RSS→sitemap, normalización, dedupe (`hash_url` único + `cluster_id`
  anti-borrado de republicaciones).
- Detección de menciones: 5 reglas (exacta, frase_exacta, contiene, booleana,
  exacta_contextual) con alias y puertas de contexto.
- Clasificación IA con Claude (apagada por defecto, `usar_ia=false`, con límites
  de costo: `max_ia_por_corrida`, `--dry-run`).
- Export a Sheets + XML propio `<pressclipping_ethos>` + Worker `/read-xml`.
- **Aún no se ha ejecutado contra Supabase/Sheets/Claude reales** (74 tests de
  lógica pura sí pasan). El primer objetivo operativo es correrlo local
  (ver `SETUP.md`).

---

## 3. Inventario brownfield (mapeado por metadatos; falta leer el código)

Repos de la org `ethosconsultoriadigital` relevantes a la plataforma. En la
sesión local, las carpetas equivalentes están en `C:\Users\Juanjo\ProyectosCursor`.

| Carpeta / repo | Qué es (según descripción) | Capa | Prioridad piloto |
|---|---|---|---|
| `AtlasFC` | Captura de notas para BOT WhatsApp (JS) | Captura → Alerta | 🔴 Alta |
| `MOTA-ENGIL-NOTAS` | Captura de notas para envío WhatsApp | Captura → Alerta | 🔴 Alta |
| `Parabuses` | PARABUSES NOTAS (JS) | Captura | 🔴 Alta |
| `NoticiasMeryPozo` | Notas (figura pública) | Captura | 🔴 Alta |
| `ElRealito` | Realito Proyecto Noticias (JS) | Captura | 🟠 Media |
| `correoRPJUMEX` | Correo JUMEX (JS) | Cliente real → correo | 🔴 Alta |
| `CorreoFIXPatron` | PATRÓN (JS) | Cliente real → correo | 🔴 Alta |
| `CorreoDOFs` | DOFs, resumen de los 4 más importantes | Regulatory | 🟡 Capa 2 |
| `GacetaDiputados` | Correo Gaceta Cámara de Diputados | Regulatory (cámaras) | 🟡 Capa 2 |
| `Judiciales-Laborales` | Portal judicial laboral | Regulatory | 🟡 Capa 2 |
| `radarmx`, `diariocontexto`, `vocesmx` | Medios / newsletter (TS) | ¿Fuentes? | 🟢 Revisar |
| LiveTradingCripto · InversionesFinancieras · ProtegeTuBase · Visualizador-F1 · ethos-web · community-manager | Trading, juegos, web | — | ⚪ Excluir |

**Patrón confirmado:** `AtlasFC`, `MOTA-ENGIL-NOTAS`, `Parabuses` son
*captura RSS → WhatsApp*. Son el blanco principal de la migración "consumir
desde PressClipping en vez de RSS directo".

---

## 4. Plantilla de auditoría por servicio (rellenar leyendo cada carpeta)

Para **cada** repo brownfield relevante, producir una ficha:

```
### <nombre-servicio>
- Propósito:
- Lenguaje / runtime (Node, GAS, Python…):
- Entradas (RSS, scraping, sitemap, APIs, Sheets…):
- Salidas (WhatsApp, correo HTML, Sheets, DB…):
- Cliente(s) que toca:
- APIs/servicios externos (OpenAI, Meta/Twilio WhatsApp, Google…):
- Cron / disparador (GAS trigger, GitHub Action, manual…):
- Lógica reutilizable para el Core:
- Solapamiento con PressClipping (dedupe, normalización, keywords…):
- Riesgo de tocarlo (qué se rompe en producción):
- Ruta de migración a consumir PressClipping (incremental, sin romper):
```

### Preguntas a responder leyendo el código de WhatsApp (crítico)
1. ¿Qué servicio envía WhatsApp (API oficial Meta / Twilio / otro)?
2. ¿Qué formato/plantilla espera el mensaje?
3. ¿Qué dispara el envío hoy (cron, evento, match)?
4. ¿Qué reglas de filtrado/dedupe de alertas existen?
5. ¿Qué pasa si falla el envío (reintentos, logs)?
6. ¿Qué clientes lo usan en producción?

---

## 5. Entregables de Fase 0 (documentos, SIN código)

1. `docs/fase-0-inventario.md` — fichas por servicio (plantilla §4) + mapa core.
2. `docs/contrato-datos-unificado.md` — modelo común: nota, mención, cliente,
   medio, keyword, alerta, reporte, **evento_regulatorio**, reforma, recomendación IA.
   Decisión clave: ¿nota periodística y evento regulatorio en una tabla con
   contrato compatible, o tablas separadas relacionadas?
3. `docs/matriz-capacidades.md` — 40 capacidades × (core / brownfield / estado /
   riesgo / próximo paso).
4. `docs/matriz-comercial.md` — 10 promesas × (estado técnico / qué existe / qué
   falta / riesgo de venderlo hoy / recomendación: vendible / beta / no prometer).
5. `docs/riesgos-produccion.md` — qué es peligroso tocar y por qué.
6. `docs/roadmap-migracion.md` — plan incremental por capas + backlog priorizado,
   empezando por el piloto *press clipping + menciones* y la migración del trío
   WhatsApp a consumir del Core.

**Criterio de éxito:** queda claro qué es Core, qué queda fuera, dónde están los
puntos de integración, y un plan que no rompe nada — aprobado antes de codificar.

---

## 6. Reglas de trabajo (recordatorio permanente)

- Antes de tocar código: explicar qué archivo, por qué, riesgo, cómo probar, cómo
  revertir → **esperar aprobación**.
- Cambios pequeños y conceptuales; no mezclar refactor con feature.
- No romper contratos (Sheets, Supabase, XML, GAS, cron, WhatsApp).
- No hardcodear clientes ni secretos. Logs claros, manejo de errores, pruebas mínimas.
- Nada reemplaza automáticamente lo anterior: migración gradual con compatibilidad.
```
