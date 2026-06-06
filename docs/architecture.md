# Arquitectura — Ethos PR Intelligence

## 1. Principio rector

> **Google Sheets controla. Supabase/PostgreSQL almacena. El código recolecta,
> normaliza, busca y clasifica.**

Tres capas con responsabilidades estrictamente separadas:

- **Google Sheets** = panel editable (medios, keywords, clientes, config) y
  salida operativa (resultados, logs). **No** es base de datos.
- **Supabase / PostgreSQL** = verdad histórica del universo de noticias.
- **Motor Node.js/TypeScript** = lee config, recolecta, normaliza, deduplica,
  detecta menciones y exporta.

## 2. Diagrama lógico

```
GOOGLE SHEETS (panel)
  00_README 01_Medios 02_Keywords 03_Clientes 04_Config
  05_Logs 06_Resultados 07_Diccionarios
        ▲ lee config            ▲ escribe resultados/logs
        │                       │
MOTOR Node.js / TypeScript
  sync-sheets ─► crawl (RSS→sitemap→secciones) ─► normalize
       └─► dedupe ─► detect-mentions ─► (IA opcional) ─► export ─► Sheets / XML
        │ SQL (service role)
        ▼
SUPABASE / POSTGRESQL (histórico)
  medios · clientes · keywords · noticias · menciones · clusters · logs_ingesta
```

## 3. Dónde corre cada cosa

| Componente | Runtime | Justificación |
|---|---|---|
| Ingesta / sync / export | **GitHub Actions** (cron) | Jobs batch periódicos; secretos y logs integrados; sin servidor que mantener. |
| Endpoint `/read-xml` | **Cloudflare Worker** (implementado en `worker/`) | HTTP de baja latencia y barato para servir XML filtrable. |
| Base histórica | **Supabase** | PostgreSQL con FTS, `pg_trgm`, REST y RLS. |

El motor vive en `src/`; los `scripts/` son envoltorios delgados. Esto permite
portar el cron a otro runtime sin reescribir la lógica.

## 4. Stack

TypeScript + Node 20 · Supabase (`@supabase/supabase-js`) ·
`google-spreadsheet` + `google-auth-library` · `rss-parser` / sitemap (Fase 3) ·
`cheerio` (Fase posterior, solo metadata) · `luxon` · `zod` · `pino` ·
`xmlbuilder2` (Fase 6) · Claude/Anthropic (Fase 7).

## 5. Plan por fases

| Fase | Entregable | Definición de "hecho" |
|---|---|---|
| 0 Diseño | Documento de diseño | Aprobado |
| **1 Setup** | Estructura, `.env.example`, README, migraciones SQL, clientes, test de conexión | Conecta a ambos y existen las tablas |
| 2 Sync | `sync-sheets.ts` con validación zod y upsert | Editar Sheets se refleja en Supabase |
| 3 Ingesta | `crawl.ts`, parsers RSS+sitemap, normalizador, dedupe | Noticias nuevas en DB sin duplicados |
| 4 Menciones | `detect-mentions.ts` (exacta/frase/contiene/booleana) | Match crea mención sin duplicar |
| 5 Export | `export-results-to-sheets.ts`, logs a Sheets | Menciones visibles en el panel |
| 6 XML | `generate-xml.ts` + Worker `/read-xml` | XML válido y filtrable |
| 7 IA | Clasificador sobre menciones relevantes | Solo con `usar_ia=TRUE`, con límites |
| 8 Interfaz | Solo docs (dashboard, alertas) | Documentado en `fase-8-interfaz.md` |

## 6. Deduplicación (resumen)

Triple clave, **respetando el valor de PR**:

1. `hash_url` (UNIQUE) → duplicado exacto, no se inserta.
2. `(titulo, medio_id, fecha)` → probable duplicado dentro del mismo medio.
3. `hash_contenido` cross-medio → **se agrupa por `cluster_id`, NUNCA se borra**.
   Una nota republicada en 10 medios = 10 impactos válidos.

## 7. IA con control de costo

Solo corre sobre **menciones que ya hicieron match**, con gate `usar_ia=TRUE`,
modelo barato por defecto (Claude Haiku) y escalamiento selectivo por
`prioridad_ia`. Nunca sobre el universo completo.
