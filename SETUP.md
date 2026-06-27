# Guía de configuración local — Ethos PR Intelligence

Sigue estos pasos en orden. Al final tendrás el sistema corriendo en tu PC con
datos reales y listo para el primer crawl.

---

## Requisitos previos

| Herramienta | Versión mínima | Verificar con |
|---|---|---|
| Node.js | 20 LTS | `node -v` |
| npm | 10+ (viene con Node 20) | `npm -v` |
| Git | cualquier reciente | `git --version` |

Descarga Node.js 20 LTS desde [nodejs.org](https://nodejs.org) si no lo tienes.

---

## Paso 1 — Clonar el repositorio

```bash
cd C:\Users\Juanjo\ProyectosCursor
git clone https://github.com/ethosconsultoriadigital/pressclipping.git PressClipping
cd PressClipping
git checkout pruebas-setup
```

> Si ya tienes la carpeta local, asegúrate de estar en la rama correcta:
> ```bash
> git fetch origin
> git checkout pruebas-setup
> git pull origin pruebas-setup
> ```

---

## Paso 2 — Instalar dependencias

```bash
npm install
```

Debería crear `node_modules/` sin errores. Si ves algún warning de peer
deps, es normal; lo importante es que no haya errores (`npm ERR!`).

Verifica que el código compila:

```bash
npm run typecheck
```

Y que los 74 tests de lógica pasan (sin necesitar red ni base de datos):

```bash
npm test
```

Resultado esperado: **74 tests passed**.

---

## Paso 3 — Crear el proyecto en Supabase

1. Entra a [supabase.com](https://supabase.com) y crea una cuenta (o inicia sesión).
2. Haz clic en **New project**.
3. Elige un nombre (p. ej. `ethos-pressclipping`) y una contraseña segura para
   la base de datos. Anótalas.
4. Región recomendada: **South America (São Paulo)** — es la más cercana a México.
5. Espera a que el proyecto esté listo (1-2 minutos).
6. Ve a **Project Settings → API**:
   - Copia la **Project URL** → será tu `SUPABASE_URL`
   - Copia la **service_role** key (la llave larga bajo "Secret") → será tu
     `SUPABASE_SERVICE_ROLE_KEY`

---

## Paso 4 — Aplicar las migraciones SQL

En el SQL Editor de Supabase (menú izquierdo → **SQL Editor → New query**):

Ejecuta cada archivo en este orden. Copia el contenido del archivo, pégalo en
el editor y haz clic en **Run**:

1. `supabase/migrations/0001_initial_schema.sql`
2. `supabase/migrations/0002_seed_configuracion.sql`
3. `supabase/migrations/0003_flags_procesamiento.sql`
4. `supabase/migrations/0004_ia_menciones.sql`

Tras ejecutarlos deberías ver estas tablas en **Table Editor**:
`medios`, `keywords`, `clientes`, `config`, `noticias`, `menciones`,
`clusters`, `logs_ingesta`.

---

## Paso 5 — Crear la cuenta de servicio de Google

> Si ya tienes una cuenta de servicio de otro proyecto, puedes reutilizarla
> añadiendo las variables correspondientes.

1. Ve a [console.cloud.google.com](https://console.cloud.google.com).
2. Crea un proyecto nuevo (o usa uno existente).
3. Activa la **Google Sheets API**:
   Menú → **APIs & Services → Library** → busca "Google Sheets API" → Enable.
4. Crea la cuenta de servicio:
   Menú → **APIs & Services → Credentials → Create Credentials →
   Service Account**.
   - Nombre: `ethos-pressclipping`
   - Rol: no es necesario asignar uno de Cloud; haz clic en **Done**.
5. En la lista de cuentas de servicio, haz clic en la que creaste →
   pestaña **Keys → Add Key → Create new key → JSON**.
   Se descargará un archivo `.json`. **Guárdalo en lugar seguro; no lo subas a Git.**
6. Del JSON extrae:
   - `client_email` → será tu `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → será tu `GOOGLE_PRIVATE_KEY` (incluye los saltos de línea
     `\n`; en Windows cópialo exactamente como aparece en el JSON)

---

## Paso 6 — Configurar la Google Sheet

La Sheet de control ya existe con ID `1aPGIO5zt5b2C1sdC2lOPsmjhcpudn_NvmlCJ8OW39es`.

1. Abre la Sheet en tu navegador.
2. Haz clic en **Compartir** (esquina superior derecha).
3. Agrega el `client_email` de tu cuenta de servicio como **Editor**.
4. Confirma que existan las pestañas: `01_Medios`, `02_Keywords`,
   `03_Clientes`, `04_Configuracion`, `05_Logs`, `06_Resultados`,
   `07_Diccionarios`. Si alguna falta, créala con ese nombre exacto.

---

## Paso 7 — Crear el archivo `.env`

En la raíz del proyecto crea un archivo llamado `.env` (sin extensión):

```bash
# En PowerShell:
copy .env.example .env
```

Abre `.env` en tu editor y rellena cada valor:

```env
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5...
GOOGLE_SERVICE_ACCOUNT_EMAIL=ethos-pressclipping@tu-proyecto.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=1aPGIO5zt5b2C1sdC2lOPsmjhcpudn_NvmlCJ8OW39es
ANTHROPIC_API_KEY=sk-ant-...
XML_SECRET_TOKEN=elige-un-token-secreto-largo
RUN_BY=local
LOG_LEVEL=info
LOG_FORMAT=pretty
```

> **Nota sobre `GOOGLE_PRIVATE_KEY` en Windows:** la clave privada del JSON
> tiene saltos de línea literales. Al copiarla al `.env` asegúrate de que quede
> entre comillas dobles y con `\n` donde corresponde (no saltos de línea reales).
> Si el archivo JSON tiene saltos reales, reemplázalos por `\n` antes de pegar.

`ANTHROPIC_API_KEY` es opcional para las primeras pruebas (solo necesaria para
`classify-ia`). Puedes dejarla vacía y agregarla cuando vayas a probar la IA.

---

## Paso 8 — Primera validación (sin crawl)

```bash
npm run healthcheck
```

Revisa la salida:
- `✅ Supabase` — conectó y encontró las tablas
- `✅ Google Sheets` — conectó y encontró las pestañas esperadas
- Cualquier `❌` indica qué falta configurar

```bash
npm run validate:supabase
npm run validate:sheets
```

Estos dos comandos son de solo lectura y te dirán si el esquema y las cabeceras
de Sheets están correctos.

---

## Paso 9 — Cargar datos de prueba en Sheets

Antes de correr el primer sync necesitas al menos una fila válida en cada
pestaña de configuración. Ver `docs/medios-ejemplo.md` para los valores exactos
a copiar en `01_Medios` y `02_Keywords`.

Estructura mínima requerida por pestaña:

**`01_Medios`** — cabeceras en fila 1 (exactas, respetando mayúsculas/acentos):
```
medio_id | nombre_medio | url_base | tipo_fuente | url_rss | activo | prioridad | requiere_javascript | requiere_proxy | region | notas
```

**`02_Keywords`** — cabeceras en fila 1:
```
keyword_id | keyword | cliente_id | tipo_match | activo | peso | variantes | contexto_incluir | contexto_excluir | alerta | prioridad_ia | notas
```

**`03_Clientes`** — cabeceras en fila 1:
```
cliente_id | nombre_cliente | activo | alertas_activas | prioridad | notas
```

**`04_Configuracion`** — cabeceras en fila 1:
```
clave | valor
```
Con filas: `usar_ia` / `false`, `modo_mvp` / `true`, `max_notas_por_medio_por_corrida` / `50`

---

## Paso 10 — Sincronizar panel y primer crawl

```bash
# Sincroniza Sheets → Supabase (medios, keywords, clientes, config)
npm run sync-sheets

# Valida los medios cargados (prueba feeds sin guardar noticias)
npm run validate:media -- --limit=5

# Primer crawl real (guarda noticias en Supabase)
npm run crawl

# Detectar menciones
npm run detect-mentions

# Ver qué se encontró
npm run export-results
```

---

## Paso 11 — Configurar Secrets en GitHub Actions (para el cron)

Para que la ingesta automática corra cada hora en GitHub Actions:

1. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**
2. Agrega un secret por cada variable del `.env`:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `GOOGLE_PRIVATE_KEY`
   - `GOOGLE_SHEET_ID`
   - `ANTHROPIC_API_KEY` (solo si usas IA)
3. El workflow `ingesta.yml` ya está configurado para leer estos secrets.
4. Para dispararlo manualmente: **Actions → Ingesta → Run workflow**.

---

## Comandos de referencia rápida

```bash
# Validación (solo lectura, sin efectos)
npm run healthcheck
npm run validate:supabase
npm run validate:sheets
npm run validate:media -- --limit=5

# Pipeline completo
npm run sync-sheets        # Sheets → Supabase
npm run crawl              # ingesta RSS/sitemap
npm run detect-mentions    # detección de keywords
npm run classify-ia -- --dry-run  # previsualiza IA sin gastar
npm run classify-ia        # clasifica con IA (requiere usar_ia=TRUE en Config)
npm run export-results     # vuelca a 06_Resultados y 05_Logs
npm run generate-xml       # genera XML local

# Desarrollo
npm test                   # 74 tests unitarios (sin red)
npm run typecheck          # verificación de tipos
```

---

## Solución de problemas frecuentes

| Síntoma | Causa probable | Solución |
|---|---|---|
| `❌ Supabase: relation "medios" does not exist` | Migraciones no aplicadas | Ejecuta los 4 archivos SQL en orden |
| `❌ Sheets: SpreadsheetNotFound` | Sheet no compartida con la cuenta de servicio | Compartir la Sheet con el `client_email` |
| `Error: GOOGLE_PRIVATE_KEY invalid` | Saltos de línea en la clave | Verifica que la clave tenga `\n` y esté entre comillas en `.env` |
| `No medios activos` | Columna `activo` en `01_Medios` no es `TRUE` | Revisa el valor exacto; el sistema acepta `TRUE`, `true`, `1`, `sí` |
| Tests fallan | Dependencias desactualizadas | `npm install` de nuevo |
| Worker no compila | Tipos de Cloudflare | `npm run worker:typecheck` para ver el error |
