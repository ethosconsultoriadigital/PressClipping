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
- [x] **Fase 1** — Setup base (estructura, migraciones, clientes, pruebas de conexión) ← *estás aquí*
- [ ] **Fase 2** — Sincronización Sheets → Supabase
- [ ] **Fase 3** — Ingesta RSS / Sitemap
- [ ] **Fase 4** — Detección de menciones
- [ ] **Fase 5** — Exportación a Sheets
- [ ] **Fase 6** — XML propio
- [ ] **Fase 7** — IA controlada
- [ ] **Fase 8** — Interfaz futura (solo documentación)

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
