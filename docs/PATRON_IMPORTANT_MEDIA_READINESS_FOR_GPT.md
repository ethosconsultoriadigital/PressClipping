# Patrón — Readiness de Medios Importantes (para auditoría externa GPT)

_Generado 2026-07-16 desde `npm run audit-patron-important-media-readiness -- --json`.
Ventana 7 días. CSV crudo en `data/patron-important-media-readiness-export.csv` (no versionado)._

## Contexto para el revisor

PressClipping ya no está disponible; Ethos opera como fuente principal para Patrón (CLI-0002:
Tequila Patrón / Casa Patrón / Bacardí / bebidas alcohólicas / crisis de tequila adulterado).
Patrón ya escribe notas aprobadas a la hoja final real `NoticiasPatron`. Necesitamos validar
externamente qué medios importantes estamos leyendo bien y cuáles no.

## Pregunta para GPT

1. ¿La priorización P1/P2/P3 por medio es correcta para una marca de tequila premium (Patrón)?
2. ¿Faltan medios importantes para Patrón que no están en la lista (nacionales, Jalisco,
   Guanajuato, económicos/sectoriales, industria de espirituosos)?
3. Del lote propuesto (§4 de `PATRON_IMPORTANT_MEDIA_READINESS.md`), ¿el orden de prioridad es
   correcto, o hay un medio que deba subir/bajar?
4. ¿Algún medio marcado `re-enrich` o `candidato a cron` debería en realidad descartarse por
   bajo valor editorial para Patrón?

## Datos (35 medios, ventana 7d)

| medio | región | imp | estado | cron | notas_7d | texto_ok | marca | sector |
|---|---|---|---|---|---|---|---|---|
| El Universal | nacional | P1 | BLOQUEADO(404) | no | 0 | — | 0 | 0 |
| Reforma | nacional | P1 | CATALOGO_NO_CRON(paywall) | no | 0 | — | 0 | 0 |
| Milenio | nacional | P1 | CATALOGO_NO_CRON(política) | no | 0 | — | 0 | 0 |
| Excélsior | nacional | P1 | LISTO_LEYENDO | sí | 20 | 100% | 0 | 0 |
| El Financiero | nacional | P1 | NECESITA_REENRICH | sí | 57 | 0% | 0 | 0 |
| El Economista | nacional | P1 | NECESITA_REENRICH | sí | 87 | 0% | 0 | 4 |
| Forbes México | nacional | P2 | NECESITA_REENRICH | sí | 12 | 0% | 0 | 0 |
| Expansión | nacional | P2 | NECESITA_REENRICH | sí | 1 | 0% | 0 | 2 |
| El Heraldo de México | nacional | P2 | NECESITA_REENRICH | sí | 144 | 0% | 0 | 2 |
| La Jornada | nacional | P1 | BLOQUEADO(403) | no | 0 | — | 0 | 0 |
| La Razón de México | nacional | P2 | NECESITA_REENRICH | sí | 83 | 0% | 0 | 0 |
| 24 Horas | nacional | P3 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 |
| Proceso | nacional | P2 | NECESITA_REENRICH | sí | 20 | 0% | 0 | 0 |
| Animal Político | nacional | P2 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 |
| Aristegui Noticias | nacional | P2 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 |
| LatinUS | nacional | P3 | NO_CATALOGADO | no | 0 | — | 0 | 0 |
| Uno TV | nacional | P3 | LISTO_LEYENDO | sí | 20 | 100% | 0 | 4 |
| Publimetro | nacional | P3 | LISTO_LEYENDO | sí | 26 | 88.5% | 0 | 2 |
| El Sol de México | nacional | P2 | NECESITA_REENRICH | sí | 27 | 0% | 0 | 0 |
| El Informador | jalisco | P1 | NECESITA_REENRICH | sí | 78 | 0% | 0 | 1 |
| Mural | jalisco | P1 | CATALOGO_NO_CRON(paywall) | no | 0 | — | 0 | 0 |
| NTR Guadalajara | jalisco | P2 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 |
| Milenio Jalisco | jalisco | P2 | CATALOGO_NO_CRON(=MED-0030) | no | 0 | — | 0 | 0 |
| Quadratín Jalisco | jalisco | P3 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 |
| AF Medios | jalisco | P3 | NO_CATALOGADO | no | 0 | — | 0 | 0 |
| Líder Informativo | guanajuato | P3 | CATALOGO_NO_CRON | no | 0 | — | 0 | 0 |
| Periódico Correo | guanajuato | P1 | LISTO_LEYENDO | sí | 21 | 95.2% | 0 | 9 |
| El Sol de Irapuato | guanajuato | P2 | LISTO_LEYENDO | sí | 1 | 100% | 0 | 1 |
| AM León | guanajuato | P2 | NO_CATALOGADO | no | 0 | — | 0 | 0 |
| Zona Franca | guanajuato | P3 | NO_CATALOGADO | no | 0 | — | 0 | 0 |
| Milenio Guanajuato | guanajuato | P3 | CATALOGO_NO_CRON(=MED-0030) | no | 0 | — | 0 | 0 |
| Food & Pleasure | sectorial | P3 | NO_CATALOGADO | no | 0 | — | 0 | 0 |
| Xataka México | sectorial | P3 | NECESITA_REENRICH | sí | 4 | 0% | 0 | 2 |
| Revista Espejo | sinaloa | P3 | LISTO_LEYENDO | sí | 8 | 100% | 0 | 4 |
| Vanguardia | coahuila | P2 | NECESITA_REENRICH | sí | 38 | 0% | 0 | 0 |

## Notas de honestidad para el revisor

- **0 menciones de marca directa** (Patrón/Bacardí) en 7d en TODOS los medios: la marca no
  apareció en el ciclo, no es fallo de captura (keyword de marca ya reforzada).
- Muchos P1 con `texto_ok=0%` (cuerpo vacío) por un problema estructural del cron base (no
  enriquece); no bloquea la detección por título ni la escritura a NoticiasPatron. Detalle en
  `PATRON_IMPORTANT_MEDIA_READINESS.md` §5.
- Reforma/Milenio/Mural: la herramienta sugiere "AGREGAR A CRON" pero son paywall/política —
  NO son candidatos válidos. Documentado como override manual.
