# National Media Access Matrix — A/B/C/D/E

_Fase "ETHOS 200 MEDIA NEWS LAKE + AUTO ENRICH CHAIN" (2026-07-20). Clasifica
cada medio por **categoría de acceso**, no solo por si está o no en cron._

## Definición de categorías

| categoría | significado |
|---|---|
| A_PUBLICO_FACIL | RSS/sitemap público, HTML abierto — se agrega directo a cron |
| B_PUBLICO_DIRECT | Sin RSS/sitemap claro, pero páginas públicas estables — requeriría extractor DIRECT dedicado |
| C_ALTERNO_PUBLICO | El sitio principal falla, pero existe un feed/sección/sitemap alterno público legítimo |
| D_PAGO_CONVENIO_API | Paywall o requiere suscripción/convenio/API/proveedor autorizado — NO bypass |
| E_NO_VIABLE_ACTUAL | Sin fuente pública clara ni alternativa legal, bloqueo técnico duro |

## 1. Lote nuevo catalogado esta fase (12 medios, todos A_PUBLICO_FACIL)

| medio | medio_id | dominio | categoría_acceso | en_cron | acción |
|---|---|---|---|---|---|
| SDP Noticias | MED-0175 | sdpnoticias.com | A_PUBLICO_FACIL | sí | mantener |
| Bloomberg Línea México | MED-0176 | bloomberglinea.com | A_PUBLICO_FACIL | sí | mantener — 1er crawl real falló (`sin_fuente`); corregido: la URL de robots.txt es RSS real mal etiquetada como "Sitemap:", cambiado metodo_extraccion a RSS, verificado con 2do crawl (20/20) |
| DPL News | MED-0177 | dplnews.com | A_PUBLICO_FACIL | sí | mantener |
| N+ | MED-0178 | nmas.com.mx | A_PUBLICO_FACIL | sí | mantener |
| ADN40 | MED-0179 | adn40.mx | A_PUBLICO_FACIL | sí | mantener |
| TV Azteca Noticias | MED-0180 | tvazteca.com/aztecanoticias | A_PUBLICO_FACIL | sí | mantener |
| MVS Noticias | MED-0181 | mvsnoticias.com | A_PUBLICO_FACIL | sí | mantener |
| Diario de Yucatán | MED-0182 | yucatan.com.mx | A_PUBLICO_FACIL | sí | mantener |
| Contralínea | MED-0183 | contralinea.com.mx | A_PUBLICO_FACIL | sí | mantener |
| Alto Nivel | MED-0174 | altonivel.com.mx | A_PUBLICO_FACIL | sí | mantener |
| Merca2.0 | MED-0184 | merca20.com | A_PUBLICO_FACIL | **no** (prioridad baja) | catalogado, candidato a próximo lote |
| El CEO | MED-0185 | elceo.com | A_PUBLICO_FACIL | **no** (prioridad baja) | catalogado, candidato a próximo lote |

Catálogo: 173 → **185** medios (+12). En cron: 44 → **54** (+10).

## 2. Candidatos evaluados y NO catalogados

| medio | categoría_acceso | motivo |
|---|---|---|
| La Silla Rota | B_PUBLICO_DIRECT | sin sitemap/wp-sitemap descubrible; contenido público real |
| LatinUS | B_PUBLICO_DIRECT | sin sitemap descubrible; contenido público real |
| W Radio | B_PUBLICO_DIRECT | sin sitemap descubrible |
| PorEsto | B_PUBLICO_DIRECT | sin sitemap descubrible |
| Animal Político | B_PUBLICO_DIRECT | sitemap devuelve página "offline"/placeholder (no confiable) |
| NTR Guadalajara | B_PUBLICO_DIRECT | sitemap solo tiene secciones, no artículos |
| El Siglo de Torreón | E_NO_VIABLE_ACTUAL | 403 confirmado (igual que fase anterior) |
| SinEmbargo | E_NO_VIABLE_ACTUAL | 403 |
| Radio Fórmula | E_NO_VIABLE_ACTUAL | 403 |
| 24 Horas | E_NO_VIABLE_ACTUAL | 403 confirmado (2 fases seguidas) |
| Business Insider México | E_NO_VIABLE_ACTUAL | dominio no resuelve |
| Fortune en Español | E_NO_VIABLE_ACTUAL | dominio no resuelve |
| Imagen Radio | E_NO_VIABLE_ACTUAL | robots.txt mal configurado (apunta a Excelsior) — no confiable |
| COFEPRIS | E_NO_VIABLE_ACTUAL (por ahora) | portal gob.mx sin sitemap específico identificable |
| CNIT | B_PUBLICO_DIRECT | blog público real, muy relevante para Patrón, pero sin sitemap — candidato a extractor DIRECT dedicado |

Ya cataloged previamente bajo otro nombre (no duplicados): Reporte Índigo
(MED-0045/0054), Eje Central (MED-0033), Notisistema (MED-0112/0129),
Partidero (MED-0042), ZonaDocs (MED-0043), Canal 44/UDG TV (MED-0040), Línea
Directa (MED-0057), Noroeste (MED-0055), El Debate (MED-0056), El Norte
(MED-0046, grupo Reforma — ver §3).

## 3. D_PAGO_CONVENIO_API — medios de paywall duro

| medio | qué se necesita | suscripción individual sirve | feed comercial | API/convenio necesario | riesgo | recomendación |
|---|---|---|---|---|---|---|
| Reforma | Grupo Reforma tiene un feed de datos/API comercial para medios (no verificado en esta fase, requiere contacto comercial) | No determinado — probablemente no (paywall a nivel de artículo, no solo de cuenta) | No determinado | Sí, casi seguro | Bajo (no es bypass, es negociación comercial) | Contactar a Grupo Reforma para licencia de contenido/feed comercial si el volumen de menciones lo justifica |
| Mural | Mismo grupo que Reforma (Grupo Reforma) | Mismo caso que Reforma | No determinado | Sí | Bajo | Misma recomendación que Reforma (mismo convenio cubriría ambos) |
| El Norte | Mismo grupo que Reforma (Grupo Reforma) | Mismo caso | No determinado | Sí | Bajo | Misma recomendación — un solo convenio con Grupo Reforma cubriría Reforma+Mural+El Norte |
| El Siglo de Torreón | Bloqueo técnico (403) más que paywall de contenido — podría ser bloqueo por IP/user-agent | No determinado | No determinado | No determinado | Bajo | Investigar con el proveedor de hosting/CDN si el bloqueo es por política anti-bot general (no paywall real) |

**Nota importante:** ninguno de estos casos se investigó a fondo por vía
comercial en esta fase (no se contactó a ningún proveedor) — esto es una
recomendación de a quién contactar, no una confirmación de que el acceso
esté disponible o su costo.

## 4. Resumen de impacto

| métrica | antes (2026-07-17) | después (2026-07-20) |
|---|---|---|
| Total catálogo | 173 | **185** |
| En cron | 44 | **54** |
| Auto-enrich encadenado correctamente (recent-first, acotado por medio) | No (oldest-first, cupo compartido global) | **Sí** — cron base + 3 tiers aislados |
| Error de un timeout puntual tira todo el batch de enrich | Sí (bug confirmado en vivo) | **No** — aislado por nota, cuenta como fallida y continúa |
