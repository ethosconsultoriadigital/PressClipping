# Worker `/read-xml`

Cloudflare Worker que sirve por HTTP el XML propio tipo PressClipping, filtrable,
leyendo desde Supabase. Reutiliza la misma lógica pura que el script
`generate-xml`, así que la salida es idéntica.

## Endpoints

| Ruta | Auth | Descripción |
|---|---|---|
| `GET /read-xml` | sí | Devuelve `application/xml` con las menciones filtradas |
| `GET /health` | no | Sonda de salud (`200 ok`) |

## Autenticación

Protegido por `XML_SECRET_TOKEN`. Envíalo como header o query param:

```bash
curl -H "Authorization: Bearer $TOKEN" "https://<worker>/read-xml?cliente=Jumex"
curl "https://<worker>/read-xml?token=$TOKEN&keyword=tequila"
```

## Filtros (query params)

`cliente`, `keyword`, `medio`, `region`, `estado_revision`, `desde`, `hasta`
(fechas ISO `YYYY-MM-DD`), `limit` (máx. 5000). Mismos criterios que
`npm run generate-xml`.

```
/read-xml?token=...&cliente=Jumex&desde=2026-06-01&hasta=2026-06-05&region=Occidente
```

## Despliegue

Desde la raíz del repo (wrangler se instala con `npm install`):

```bash
# 1. Configura los secrets en Cloudflare (no van en wrangler.toml)
npx wrangler secret put SUPABASE_URL            --config worker/wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config worker/wrangler.toml
npx wrangler secret put XML_SECRET_TOKEN        --config worker/wrangler.toml

# 2. Verifica tipos y despliega
npm run worker:typecheck
npm run worker:deploy
```

Para desarrollo local crea `worker/.dev.vars` (ya está en `.gitignore`):

```
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
XML_SECRET_TOKEN=...
```

y corre `npm run worker:dev`.

## Notas de seguridad

- Usa la **Service Role Key** de Supabase (lee sin RLS): es un secret de
  servidor, nunca se expone al navegador. El endpoint exige `XML_SECRET_TOKEN`.
- Si en el futuro se activa RLS y un rol de solo lectura, conviene cambiar a una
  key restringida.
- `cache-control: no-store` evita cachear datos sensibles en intermediarios.
