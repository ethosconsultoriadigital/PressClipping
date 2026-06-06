# Ethos PR Intelligence — Sistema Propio de Press Clipping

Sistema interno para monitorear medios digitales, construir un **universo propio
de noticias** y detectar menciones relevantes de clientes, marcas y temas —
sin depender de un proveedor externo de PressClipping/XML.

> **Principio rector:** Google Sheets **controla**, Supabase/PostgreSQL
> **almacena**, el código **recolecta, normaliza, busca y clasifica**.

| Capa | Rol | Tecnología |
|---|---|---|
| Control / Operación | Panel editable: medios, keywords, clientes, config, revisión | Google Sheets |
| Almacenamiento | Universo histórico real de noticias y menciones | Supabase / PostgreSQL |
| Motor | Ingesta (RSS→sitemap→secciones), normalización, dedupe, match, export | Node.js + TypeScript |
| Cron | Ejecución periódica de la ingesta | GitHub Actions |
| Salida | XML propio tipo PressClipping mejorado | (Cloudflare Worker, fase posterior) |

---

## Estado del proyecto

Desarrollo por fases (ver [`docs/architecture.md`](docs/architecture.md)):

- [x] **Fase 0** — Diseño y validación
- [x] **Fase 1** — Setup base (estructura, migraciones, clientes, pruebas de conexión)
- [x] **Fase 2** — Sincronización Sheets → Supabase
- [x] **Fase 3** — Ingesta RSS / Sitemap
- [x] **Fase 4** — Detección de menciones
- [x] **Fase 5** — Exportación a Sheets
- [x] **Fase 6** — XML propio
- [x] **Fase 7** — IA controlada
- [x] **Fase 8** — Interfaz futura (documentada en [`docs/fase-8-interfaz.md`](docs/fase-8-interfaz.md)) ← *estás aquí*

---

## Requisitos

- **Node.js 20+**
- Un proyecto **Supabase** (PostgreSQL)
- Una **cuenta de servicio de Google** con acceso a la Sheet de control

---

## Configuración inicial

### 1. Instalar dependencias

```bash
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env
```

Completa los valores en `.env` (ver detalle de cada uno en el propio archivo):

| Variable | Para qué sirve |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio (solo backend) |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Email de la cuenta de servicio |
| `GOOGLE_PRIVATE_KEY` | Clave privada de la cuenta de servicio |
| `GOOGLE_SHEET_ID` | ID de la Google Sheet de control |

### 3. Crear la cuenta de servicio de Google (una sola vez)

1. En Google Cloud Console, crea un proyecto (o usa uno existente).
2. Habilita la **Google Sheets API**.
3. Crea una **Service Account** y genera una **clave JSON**.
4. Del JSON, copia `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL` y
   `private_key` → `GOOGLE_PRIVATE_KEY`.
5. **Comparte la Google Sheet** con ese `client_email` como **Editor**.

### 4. Aplicar las migraciones en Supabase

Las migraciones están en [`supabase/migrations/`](supabase/migrations/). Aplícalas
con el método que prefieras:

- **Supabase Studio** → SQL Editor → pega el contenido de cada archivo en orden
  (`0001_…` y luego `0002_…`) y ejecútalo.
- **Supabase CLI** → `supabase db push` (si tienes el CLI configurado).

### 5. Probar las conexiones

```bash
npm run test:connection            # prueba Supabase y Sheets
npm run test:connection -- supabase
npm run test:connection -- sheets
```

Si ves `✅` en ambos, la Fase 1 está lista.

---

## Validación y diagnóstico (solo lectura)

Comandos no destructivos para confirmar el estado del sistema antes de operar.
**Ninguno guarda noticias ni modifica `01_Medios`.**

```bash
npm run healthcheck                      # entorno + Supabase (tablas) + Sheets (pestañas)
npm run validate:supabase                # existencia y conteo de cada tabla esperada
npm run validate:sheets                  # conexión, pestañas y mapeo de cabeceras
npm run validate:media                   # diagnostica cada medio activo (probe RSS/sitemap)
npm run validate:media -- --limit=10     # solo los primeros 10
npm run validate:media -- --priority=Alta # solo prioridad "Alta"
```

`validate:media` lee `01_Medios`, **omite inactivos y duplicados** (por `medio_id`
y `url_base`), prueba las fuentes de cada medio **sin guardar noticias**,
recomienda el método de extracción y clasifica los medios "especiales". Escribe
el diagnóstico en **`08_Validacion_Medios`** y los especiales en
**`09_Medios_Especiales`** (las crea si no existen; solo anexa filas).

---

## Uso del pipeline

```bash
npm run sync-sheets       # Fase 2: Sheets → Supabase (medios, keywords, clientes, config)
npm run crawl             # Fase 3: ingesta RSS/sitemap de los medios activos
npm run detect-mentions   # Fase 4: detecta menciones de keywords en noticias nuevas
npm run export-results    # Fase 5: vuelca menciones a 06_Resultados y logs a 05_Logs
npm run generate-xml      # Fase 6: genera XML propio tipo PressClipping (con filtros)
npm run classify-ia       # Fase 7: clasifica menciones con IA (solo si usar_ia=TRUE)
npm test                  # tests unitarios (parsers, normalización, hashing, matcher, xml, ia, mappers)
npm run typecheck         # verificación de tipos
```

**Sincronización (Fase 2):** lee `01_Medios`, `02_Keywords`, `03_Clientes` y
`04_Configuracion`, valida cada fila con `zod` (mapeo por nombre de cabecera,
no por posición), descarta filas inválidas con aviso y hace upsert en Supabase.

**Ingesta (Fase 3):** recorre los medios activos aplicando la cascada
**RSS → sitemap**, normaliza (URL canónica, fechas a UTC, limpieza de HTML),
deduplica por `hash_url` y agrupa republicaciones por `cluster_id` **sin perder
impactos**. Respeta `max_notas_por_medio_por_corrida` y omite medios con
`requiere_javascript`/`requiere_proxy` mientras `modo_mvp=true`. Solo guarda
metadata + resumen (no el texto íntegro).

**Detección de menciones (Fase 4):** carga las keywords activas y analiza las
noticias aún no procesadas. Aplica las reglas `exacta`, `frase_exacta`,
`contiene`, `exacta_contextual` y `booleana` (AND/OR/NOT con paréntesis y
frases entre comillas), con alias/variantes y puertas de `contexto_incluir`/
`contexto_excluir`. Calcula un score por peso de campo (título > resumen > …)
y guarda un fragmento de evidencia. El constraint `UNIQUE(noticia_id,keyword_id)`
evita menciones duplicadas; las noticias se marcan como procesadas.

**Exportación (Fase 5):** vuelca a `06_Resultados` las menciones nuevas (vista
operativa, **no** el histórico) y a `05_Logs` los logs de ingesta pendientes,
marcando lo exportado para no duplicar filas. Los campos de IA (sentimiento,
tema, etc.) los rellena la Fase 7 antes del export.

**XML propio (Fase 6):** genera un documento `<pressclipping_ethos>` con una
`<nota>` por mención (ver ejemplo en [`docs/ejemplo-salida.xml`](docs/ejemplo-salida.xml)).
Los campos de texto libre van en CDATA y el resto se escapa; `<texto>` contiene
el **resumen/extracto**, no la nota íntegra (política legal). Soporta filtros:

```bash
npm run generate-xml -- --cliente=Jumex --keyword=tequila
npm run generate-xml -- --desde=2026-06-01 --hasta=2026-06-05 --region=Occidente
npm run generate-xml -- --estado-revision=pendiente --out=output/clip.xml --marcar
```

`--marcar` marca las menciones incluidas como `exportado_xml`. Esta lógica de
filtros y formato es la base del futuro endpoint `/read-xml` (Cloudflare Worker).

**Clasificación con IA (Fase 7):** clasifica menciones con Claude (SDK oficial de
Anthropic, salida estructurada con Zod) produciendo sentimiento, relevancia,
tema/subtema, resumen ejecutivo, riesgo reputacional y recomendación PR.
**Deliberadamente controlada en costo**:

- **Gate duro**: solo corre si `usar_ia=TRUE` en `04_Configuracion` (default `false`).
- Solo procesa menciones **pendientes** (`ia_procesado=false`); no reprocesa.
- Límite por corrida (`max_ia_por_corrida`, default 50; override con `--limit`).
- Modelo configurable (`ia_modelo`, default `claude-haiku-4-5`; puede subirse a
  `claude-sonnet-4-6` o `claude-opus-4-8`).
- Opción `ia_solo_prioridad_alta` para limitar a clientes prioritarios.
- `--dry-run` cuenta cuántas se procesarían **sin** llamar a la IA ni gastar.
- Registra los tokens usados por corrida en `logs_ingesta` / `05_Logs`.

Requiere `ANTHROPIC_API_KEY`. Corre **antes** del export para que `06_Resultados`
muestre los campos de IA.

```bash
npm run classify-ia -- --dry-run     # previsualiza sin gastar
npm run classify-ia -- --limit=10    # clasifica como máximo 10
```

### Ejecución automática (GitHub Actions)

- `.github/workflows/ci.yml` — typecheck + tests en cada push.
- `.github/workflows/ingesta.yml` — corre `sync-sheets` + `crawl` por cron
  (cada hora, UTC) y bajo demanda. Requiere los Secrets del repositorio
  equivalentes a las variables de `.env.example`.

---

## Estructura del proyecto

```
.
├── src/
│   ├── config/        # carga y validación de variables de entorno
│   ├── sheets/        # cliente Google Sheets (panel de control)
│   ├── supabase/      # cliente Supabase (base histórica)
│   ├── crawlers/      # ingesta RSS / sitemap / secciones   (Fase 3)
│   ├── parsers/       # parseo de feeds y documentos          (Fase 3)
│   ├── normalizers/   # limpieza, fechas, URL canónica, hash  (Fase 3)
│   ├── matchers/      # reglas de keyword y menciones         (Fase 4)
│   ├── exporters/     # export a Sheets y a XML               (Fase 5/6)
│   ├── ai/            # interfaz de clasificación (preparada) (Fase 7)
│   ├── logs/          # escritura de logs a DB y Sheets       (Fase 2+)
│   ├── utils/         # logger, http, hashing, fechas
│   └── types/         # contrato de datos compartido (zod)
├── scripts/           # entrypoints ejecutables (thin wrappers)
├── supabase/migrations/  # esquema SQL versionado
└── docs/              # architecture · data-contract · operations
```

---

## Seguridad

- **Nunca** se hardcodean credenciales: todo va por variables de entorno.
- `.env` y archivos `*-service-account*.json` están en `.gitignore`.
- La `SUPABASE_SERVICE_ROLE_KEY` omite RLS: úsala solo en backend / Actions.
- En GitHub Actions, configura las variables como **Secrets** del repositorio.

---

## Documentación

- [`docs/architecture.md`](docs/architecture.md) — arquitectura y plan por fases
- [`docs/data-contract.md`](docs/data-contract.md) — contrato Sheets ↔ Supabase ↔ XML
- [`docs/operations.md`](docs/operations.md) — operación y scraping responsable
- [`docs/fase-8-interfaz.md`](docs/fase-8-interfaz.md) — diseño de la interfaz futura (dashboard, buscador, alertas)
