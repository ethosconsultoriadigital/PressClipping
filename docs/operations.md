# Operación y scraping responsable — Ethos PR Intelligence

## Orden de extracción (fallback en cascada)

1. **RSS** — fuente publicada intencionalmente por el medio. Preferida.
2. **Sitemap** — incluye sitemaps de noticias (`<news:news>`).
3. **Páginas de sección** — listados HTML de portada/sección.
4. **Buscador interno** del medio (fase posterior).
5. **HTML scraping** (fase posterior, solo metadata).
6. **Fuentes especiales / API** (fase posterior).

En el **MVP** solo se implementan (1) y (2). Medios con
`requiere_javascript=TRUE` o `requiere_proxy=TRUE` se omiten salvo aprobación
explícita.

## Reglas de scraping responsable

- Respetar `robots.txt` y la `frecuencia_minutos` por medio.
- User-Agent identificable (no suplantar navegadores).
- Límite `max_notas_por_medio_por_corrida` por corrida.
- Timeouts y reintentos con backoff; un medio que falla **no** tumba la corrida.
- **Guardar solo metadata + extracto** (título, URL, fecha, autor, resumen).
  No redistribuir el texto íntegro de notas con copyright.
- Si un medio bloquea, marcar `ultimo_estado=bloqueado` y considerarlo complejo.
- **Sin proxies** en el MVP.

## Logging (triple destino)

1. **Consola** (`pino`) — visibilidad inmediata / GitHub Actions.
2. **Tabla `logs_ingesta`** — histórico estructurado y consultable.
3. **Pestaña `05_Logs`** — panel operativo para revisión humana.

Cada corrida por medio registra: URLs detectadas, notas nuevas, duplicados,
errores, duración y quién ejecutó.

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Legal por scraping | RSS/sitemap; respetar robots; solo metadata/extracto |
| Copiar contenido completo | Guardar resumen, no nota íntegra; XML enlaza al original |
| Bloqueo de medios | Rate-limit, backoff, marcar complejo |
| HTML cambiante | Priorizar RSS/sitemap; parsers HTML aislados por medio |
| Costos de IA | IA solo sobre menciones; gate `usar_ia`; modelo barato |
| Sheets cuello de botella | Sheets nunca es BD; `06_Resultados` acotado; batch |
| Duplicados | `hash_url` UNIQUE + heurística título/medio/fecha |
| Falsos positivos | `contexto_incluir`/`contexto_excluir`; reglas tipadas |
| Perder republicaciones | `cluster_id` agrupa pero NO borra impactos |
| Dependencia de Google | Vamos directo a la fuente, sin índice de Google |
| Medios mal estructurados | Fallback en cascada; marcar complejos |
| Credenciales | Solo env/Secrets; nunca en cliente; `.env` en gitignore |
| Falta de logs | Logging triple obligatorio |

## Ejecución manual (desarrollo)

```bash
npm run test:connection     # valida Supabase + Sheets
npm run sync-sheets         # Fase 2
npm run crawl               # Fase 3
npm run detect-mentions     # Fase 4
npm run export-results      # Fase 5
npm run generate-xml        # Fase 6
```
