```
README PASO A PASO - OPERACION EN PARALELO PARA REEMPLAZAR PRESSCLIPPING
Proyecto: PressClipping / Ethos News Lake
Rama: claude/ethos-pr-intelligence-design-q9GzX
Repo local esperado: C:\Users\Juanjo\ProyectosCursor\PressClipping\pressclipping
Fecha de operacion: 2026-09-01
```

```
======================================================================
```

# `1. OBJETIVO GENERAL` 

```
======================================================================
```

```
El servicio externo PressClipping ya no esta funcionando de forma confiable. El
objetivo urgente es operar Ethos News Lake como reemplazo propio para:
```

`1. Capturar notas del mayor numero posible de medios.` 

`2. Enriquecer cada nota con texto limpio y cuerpo completo.` 

`3. Guardar las notas en News Lake / Supabase.` 

`4. Detectar keywords por cliente despues de la captura.` 

`5. Exportar resultados por cliente a Google Sheets en tabs nuevas ETHOS_*.` 

`6. En paralelo, reparar medios fallidos para aumentar cobertura.` 

```
Arquitectura correcta:
```

```
CAPTURA GENERAL DE MEDIOS
```

- `-> ENRICH / TEXTO LIMPIO / CUERPO COMPLETO` 

- `-> NEWS LAKE` 

- `-> DETECCION DE KEYWORDS POR CLIENTE` 

- `-> EXPORT A SHEET POR CLIENTE` 

# `Regla clave:` 

```
Las keywords NO deciden que se captura. Primero se capturan medios. Despues se
detectan keywords por cliente.
```

```
======================================================================
```

# `2. ESTADO ACTUAL VALIDADO` 

```
======================================================================
```

```
Repo:
```

- `Branch activa: claude/ethos-pr-intelligence-design-q9GzX` 

- `HEAD esperado reciente: c3245ee chore(mery): add gap source audit script` 

```
News Lake:
```

- `news-lake-capture.yml funciona.` 

- `Captura medios por bloques/oleadas.` 

- `Inserta nuevas notas.` 

- `Omite duplicados.` 

- `Enrich funciona con texto limpio y cuerpo completo.` 

- `No envia email, WhatsApp, Twilio ni alertas.` 

- `No escribe Sheets.` 

```
Mery Pozos:
```

- `client_id: CLI-MERY-TEST` 

- `Sheet ID: 1rWl-yDibT91AiELV-bkzaFiMTm6HY4JUSlBxiq-eNq8` 

- `Tab prefix: ETHOS_MERY_CLIENT_TEST` 

- `Ya tuvo export real exitoso a Sheet.` 

- `Resultado validado previo:` 

- `18 noticias candidatas` 

- `9 menciones detectadas` 

- `8 revision humana` 

- `Export real escribio 5 notas capturadas, 4 menciones y 1 revision` 

- `mismatch:false` 

- `Ultimo dry-run posterior NO trajo incremento nuevo:` 

- `18 candidatas` 

- `9 menciones` 

- `8 revision` 

- `dry_run:true` 

- `no escribio nada` 

```
Conclusion actual:
```

- `Mery ya esta operativo minimo.` 

- `No bloquear mas por Mery si no hay incremento nuevo.` 

- `La prioridad ahora es aumentar cobertura de medios.` 

```
======================================================================
```

# `3. DIVISION DE TRABAJO EN PARALELO` 

```
======================================================================
```

# `A. Juan / Operacion` 

```
-------------------
```

```
Responsabilidad:
```

`1. Correr oleadas de captura controladas.` 

`2. Revisar logs de GitHub Actions.` 

`3. Pegar resultados a ChatGPT para decidir GO / NO-GO.` 

`4. Correr dry-runs por cliente.` 

`5. Autorizar export real a Sheet solo cuando el dry-run lo justifique.` 

`6. No modificar codigo directamente salvo que sea necesario.` 

# `B. Programador adicional / Cursor` 

```
---------------------------------
```

```
Responsabilidad:
```

`1. Auditar medios fallidos.` 

`2. Buscar fuentes publicas conservadoras: RSS, feed, sitemap, WordPress endpoint.` 

`3. Proponer fixes minimos por medio.` 

`4. Probar fixes con dry-run por medio.` 

`5. Clasificar medios A/B/C/D/E.` 

`6. No tocar clientes, Sheets ni keywords.` 

`7. No hacer commit hasta revision.` 

```
======================================================================
```

# `4. RESTRICCIONES DURAS PARA TODOS` 

```
======================================================================
```

```
NO hacer:
```

- `No email.` 

- `No WhatsApp.` 

- `No Twilio.` 

- `No alertas.` 

- `No tocar Patron final.` 

- `No tocar Jumex final.` 

- `No tocar NOTAS ENVIADAS MERYPOZOS.` 

```
- No tocar test_pressclipping.
```

- `No borrar noticias.` 

```
- No borrar menciones.
```

- `No limpiar Sheets.` 

```
- No reemplazar tabs existentes.
```

- `No commitear data/.` 

```
- No commitear tmp/.
```

```
- No commitear .env ni secretos.
```

- `No usar proxy.` 

```
- No usar Playwright sin autorizacion explicita.
```

- `No bypass de paywall.` 

- `No crawl masivo sin limites.` 

- `No agregar keywords tematicas a clientes para cerrar gaps.` 

# `Permitido:` 

- `Crear o escribir solo tabs nuevas ETHOS_* cuando el dry-run ya fue aprobado. - Capturar medios con limites bajos.` 

- `Enriquecer notas con limites bajos.` 

# `- Reparar fuentes publicas conservadoras.` 

- `Probar por medio individual o por oleadas.` 

```
======================================================================
```

# `5. CLASIFICACION DE MEDIOS` 

```
======================================================================
```

```
Cada medio debe clasificarse asi:
```

```
A = Captura OK + cuerpo completo OK
    Accion: usar ya.
```

```
B = Captura OK + cuerpo parcial
    Accion: usar con revision.
```

```
C = Solo titulo/snippet/RSS
    Accion: usar como radar temporal.
```

```
D = Paywall/convenio/API
```

```
    Accion: no hacer scrape. Documentar como convenio/API necesario.
```

```
E = Roto/sin fuente/timeout/403/404/415/fetch failed
    Accion: reparar fuente o marcar no viable.
```

```
======================================================================
6. COMANDOS BASE DE VALIDACION LOCAL
```

```
======================================================================
```

```
En PowerShell:
```

```
cd C:\Users\Juanjo\ProyectosCursor\PressClipping\pressclipping
```

```
git status --short
git branch --show-current
git log -5 --oneline
npm run typecheck
npm test
```

```
Si npm test tarda demasiado o falla, reportar:
```

```
- que test fallo
```

```
- salida exacta
```

```
- si fue timeout
```

```
- si el fallo parece relacionado con los cambios
```

```
No hacer commit antes de revisar typecheck/test.
```

```
======================================================================
7. VALIDAR UN MEDIO INDIVIDUAL EN GITHUB ACTIONS
```

```
======================================================================
```

```
Usar cuando el programador quiera probar un medio especifico.
```

```
Paso 1: Dry-run, no escribe nada real.
```

# `PowerShell:` 

```
gh workflow run news-lake-capture.yml --ref claude/ethos-pr-intelligence-design-
q9GzX -f dry_run=true -f medio_ids="MED-XXXX" -f max_medios=1 -f max_notas=3 -f
enrich_limit=20 -f window_days=30 -f chunk_size=1
```

```
gh run list --workflow="news-lake-capture.yml" --limit 3
```

```
gh run watch RUN_ID --exit-status
gh run view RUN_ID --log
```

```
Paso 2: Si el dry-run esta correcto y se autoriza, correr real controlado.
```

```
PowerShell:
```

```
gh workflow run news-lake-capture.yml --ref claude/ethos-pr-intelligence-design-
q9GzX -f dry_run=false -f medio_ids="MED-XXXX" -f max_medios=1 -f max_notas=3 -f
enrich_limit=20 -f window_days=30 -f chunk_size=1
```

```
gh run list --workflow="news-lake-capture.yml" --limit 3
gh run watch RUN_ID --exit-status
gh run view RUN_ID --log
```

```
Buscar en log:
- dry_run:false
- dirigido:true
- total_seleccionados:1
- estado: ok / error / sin_fuente
- insertadas
- duplicados
- totalErrores
- conTextoLimpio
- conCuerpoNota
```

```
======================================================================
```

# `8. VALIDAR UNA OLEADA DE MEDIOS` 

```
======================================================================
```

```
Usar bloques de 10 o 20 medios. No repetir 196 de golpe.
```

```
Dry-run:
```

```
gh workflow run news-lake-capture.yml --ref claude/ethos-pr-intelligence-design-
q9GzX -f dry_run=true -f medio_ids="MED-0001,MED-0002,MED-0003" -f max_medios=20
-f max_notas=3 -f enrich_limit=80 -f window_days=30 -f chunk_size=10
```

```
Real controlado:
```

```
gh workflow run news-lake-capture.yml --ref claude/ethos-pr-intelligence-design-
q9GzX -f dry_run=false -f medio_ids="MED-0001,MED-0002,MED-0003" -f
max_medios=20 -f max_notas=3 -f enrich_limit=80 -f window_days=30 -f
chunk_size=10
```

```
Ver resultados:
```

```
gh run list --workflow="news-lake-capture.yml" --limit 3
gh run watch RUN_ID --exit-status
gh run view RUN_ID --log
```

```
Interpretacion:
```

```
- success + chunks_ok => workflow estable
- insertadas > 0 => nuevas notas entraron
```

```
- duplicados > 0 => dedupe funciona
```

```
- conTextoLimpio/conCuerpoNota > 0 => enrich funciona
```

```
- totalErrores alto => medios a reparar por programador
```

```
======================================================================
```

# `9. DRY-RUN GENERAL PARA MAPEAR LOS 196 MEDIOS` 

```
======================================================================
```

```
Este comando no escribe nada. Sirve para obtener el mapa de chunks y seguir
oleadas sin adivinar IDs.
```

```
PowerShell:
```

```
gh workflow run news-lake-capture.yml --ref claude/ethos-pr-intelligence-design-
q9GzX -f dry_run=true -f max_medios=196 -f max_notas=3 -f enrich_limit=80 -f
window_days=30 -f chunk_size=10
```

```
gh run list --workflow="news-lake-capture.yml" --limit 3
gh run watch RUN_ID --exit-status
gh run view RUN_ID --log
```

```
Despues de obtener el log, pegarlo a ChatGPT para extraer:
- chunks restantes
```

```
- IDs por oleada
- medios que ya entraron
- medios fallidos
- siguiente comando exacto
```

```
======================================================================
10. VALIDACION DE MERY EN CLIENT LIVE SHEET EXPORT
```

```
======================================================================
```

```
Usar cuando ya hubo nuevas capturas y se quiere ver si subieron menciones de
Mery.
```

```
Dry-run de Mery:
```

```
gh workflow run client-live-sheet-export.yml --ref claude/ethos-pr-intelligence-
design-q9GzX -f dry_run=true -f sheet_id=1rWl-yDibT91AiELV-
bkzaFiMTm6HY4JUSlBxiq-eNq8 -f tab_prefix=ETHOS_MERY_CLIENT_TEST -f
client_id=CLI-MERY-TEST -f client_name="Mery Pozos" -f window_days=30 -f
limit=250 -f max_rows=250
```

```
gh run list --workflow="client-live-sheet-export.yml" --limit 3
gh run watch RUN_ID --exit-status
gh run view RUN_ID --log
```

```
Buscar en log:
- dry_run:true
- keywords:12
- terminos_busqueda:15
- noticias_encontradas
- notas_capturadas
- menciones_detectadas
- revision_humana
- mensaje: NO se crea tab ni se escribe nada
```

```
GO para export real si:
- hay incremento nuevo relevante
- el dry-run es correcto
- solo va a tabs ETHOS_*
- no toca tabs protegidas
```

```
NO-GO si:
- no hay incremento nuevo
- hay mismatch
- sheet_id incorrecto
- tab_prefix incorrecto
- aparecen datos raros o duplicados inesperados
```

```
Export real de Mery SOLO si hay GO:
```

```
gh workflow run client-live-sheet-export.yml --ref claude/ethos-pr-intelligence-
design-q9GzX -f dry_run=false -f sheet_id=1rWl-yDibT91AiELV-
bkzaFiMTm6HY4JUSlBxiq-eNq8 -f tab_prefix=ETHOS_MERY_CLIENT_TEST -f
client_id=CLI-MERY-TEST -f client_name="Mery Pozos" -f window_days=30 -f
limit=250 -f max_rows=250
```

```
Ver resultados:
```

```
gh run list --workflow="client-live-sheet-export.yml" --limit 3
gh run watch RUN_ID --exit-status
gh run view RUN_ID --log
```

```
Buscar:
```

```
- dry_run:false
- filas_notas_capturadas
- filas_menciones
- filas_revision
- filas_omitidas_dedupe
- mismatch:false
```

```
======================================================================
11. MEDIOS FALLIDOS PRIORITARIOS PARA PROGRAMADOR
```

```
======================================================================
```

```
Estos medios ya fallaron en oleadas y deben ser revisados/reparados primero:
```

```
MED-0103 El Peninsular Digital - sin_fuente
MED-0104 Cabo Mil Noticias - sitemap 404
MED-0105 Radar Politico BCS - fetch failed
MED-0110 Diario El Zalate - fetch failed
MED-0115 DK 1250 - fetch failed
MED-0117 Cronica Jalisco - fetch failed
MED-0099 BCS Noticias - sitemap 415
MED-0107 Diario Humano - sitemap 415
MED-0123 CPS Noticias - fetch failed
MED-0125 Vallarta Uno - sitemap 404
MED-0126 Noticias PV - sitemap 404
MED-0127 Semanario Laguna - sitemap 404
MED-0128 Pagina Que Si Se Lee - sin_fuente
MED-0132 Zapotlan Noticias - fetch failed
MED-0133 Diario Regional de Zapotlan - fetch failed
MED-0137 Lagos Noticias - fetch failed
MED-0139 Mi Region Jalisco - fetch failed
MED-0140 Ameca Noticias - fetch failed
MED-0141 Colotlan Noticias - fetch failed
MED-0143 Arandas Noticias - fetch failed
MED-0144 La Voz del Norte Jalisco - fetch failed
MED-0121 Vallarta Opina - fetch failed
```

```
Tambien revisar medios excluidos/no procesados:
MED-0109
MED-0114
MED-0191
```

```
======================================================================
12. COMO BUSCAR FUENTES ALTERNATIVAS
======================================================================
```

```
Para cada medio fallido, buscar fuentes publicas conservadoras:
```

```
/feed/
/rss
/rss.xml
/sitemap.xml
/sitemap_index.xml
/post-sitemap.xml
/page-sitemap.xml
/wp-sitemap.xml
/wp-sitemap-posts-post-1.xml
```

```
/news-sitemap.xml
/wp-json/wp/v2/posts
```

```
Si es WordPress, probar especialmente:
- /feed/
- /wp-sitemap-posts-post-1.xml
- /wp-json/wp/v2/posts
```

```
No usar:
- proxy
- Playwright
- paywall bypass
- scraping agresivo
```

```
Si no hay fuente publica viable, clasificar como E o D segun corresponda.
```

```
======================================================================
13. COMO PROPONER UN FIX
======================================================================
```

```
Un fix debe ser minimo y por medio.
```

```
Ejemplos:
Caso 1: sitemap incorrecto
Actual:
https://medio.com/sitemap.xml
Propuesto:
https://medio.com/sitemap_index.xml
```

```
Caso 2: sin_fuente
Se encontro feed publico:
https://medio.com/feed/
Caso 3: WordPress
Se encontro:
https://medio.com/wp-sitemap-posts-post-1.xml
```

```
Caso 4: paywall
Clasificacion:
D_PAGO_CONVENIO_API
No hacer scraping.
No modificar logica global si solo falla un medio.
```

```
======================================================================
14. PROMPT PARA CURSOR DEL PROGRAMADOR
======================================================================
```

```
Pegar en Cursor del programador:
```

```
Lee y sigue este README completo.
```

```
Estamos en el repo PressClipping, rama claude/ethos-pr-intelligence-design-
q9GzX.
```

```
Contexto urgente:
El servicio externo PressClipping dejo de funcionar. Estamos usando Ethos News
Lake como reemplazo operativo. Ya se valido que el sistema captura, enriquece y
exporta por cliente. Tu trabajo NO es tocar clientes; tu trabajo es aumentar
cobertura de medios.
```

```
Objetivo de tu trabajo:
```

```
Auditar, reparar y validar medios fallidos para que News Lake capture el mayor
```

```
numero posible de notas con texto limpio y cuerpo completo.
```

```
No toques:
- Sheets
- clientes
- keywords
- Mery
- Patron final
- Jumex final
- alertas
- WhatsApp
- email
- Twilio
```

```
No uses:
- proxy
- Playwright
- paywall bypass
- scraping agresivo
- crawl masivo sin limites
```

```
Medios fallidos prioritarios:
- MED-0103 El Peninsular Digital - sin_fuente
- MED-0104 Cabo Mil Noticias - sitemap 404
- MED-0105 Radar Politico BCS - fetch failed
- MED-0110 Diario El Zalate - fetch failed
- MED-0115 DK 1250 - fetch failed
- MED-0117 Cronica Jalisco - fetch failed
- MED-0099 BCS Noticias - sitemap 415
- MED-0107 Diario Humano - sitemap 415
- MED-0123 CPS Noticias - fetch failed
- MED-0125 Vallarta Uno - sitemap 404
- MED-0126 Noticias PV - sitemap 404
- MED-0127 Semanario Laguna - sitemap 404
- MED-0128 Pagina Que Si Se Lee - sin_fuente
- MED-0132 Zapotlan Noticias - fetch failed
- MED-0133 Diario Regional de Zapotlan - fetch failed
- MED-0137 Lagos Noticias - fetch failed
- MED-0139 Mi Region Jalisco - fetch failed
- MED-0140 Ameca Noticias - fetch failed
- MED-0141 Colotlan Noticias - fetch failed
- MED-0143 Arandas Noticias - fetch failed
- MED-0144 La Voz del Norte Jalisco - fetch failed
- MED-0121 Vallarta Opina - fetch failed
```

```
Tambien revisar:
- MED-0109
```

```
- MED-0114
- MED-0191
```

```
Tareas:
```

`1. Inspecciona el catalogo/configuracion del repo para esos medios.` 

```
2. Identifica para cada medio:
```

```
   - medio_id
   - nombre
   - url base
   - fuente actual
   - RSS actual si existe
   - sitemap actual si existe
   - extractor si existe
   - razon de falla
```

`3. Busca fuente publica alternativa conservadora:` 

```
   - /feed/
```

```
   - /rss
```

```
   - /rss.xml
   - /sitemap.xml
   - /sitemap_index.xml
   - /post-sitemap.xml
   - /wp-sitemap.xml
   - /wp-sitemap-posts-post-1.xml
   - /wp-json/wp/v2/posts
4. Clasifica cada medio:
   A = captura OK + cuerpo completo
   B = captura OK + cuerpo parcial
   C = solo titulo/snippet
   D = paywall/API/convenio
   E = roto/sin fuente/no viable
5. PropÃ³n cambios minimos.
```

`6. No modifiques logica global salvo que sea estrictamente necesario.` 

`7. Si modificas codigo/config:` 

```
   - no commit todavia
   - corre typecheck
   - corre tests
   - prepara diff para revision
```

```
Comandos minimos:
cd C:\Users\Juanjo\ProyectosCursor\PressClipping\pressclipping
git status --short
git branch --show-current
git log -5 --oneline
npm run typecheck
npm test
```

```
Para probar un medio individual en GitHub Actions:
```

```
gh workflow run news-lake-capture.yml --ref claude/ethos-pr-intelligence-design-
q9GzX -f dry_run=true -f medio_ids="MED-XXXX" -f max_medios=1 -f max_notas=3 -f
enrich_limit=20 -f window_days=30 -f chunk_size=1
gh run list --workflow="news-lake-capture.yml" --limit 3
gh run watch RUN_ID --exit-status
gh run view RUN_ID --log
```

```
Si el dry-run es correcto y se autoriza:
```

```
gh workflow run news-lake-capture.yml --ref claude/ethos-pr-intelligence-design-
q9GzX -f dry_run=false -f medio_ids="MED-XXXX" -f max_medios=1 -f max_notas=3 -f
enrich_limit=20 -f window_days=30 -f chunk_size=1
gh run list --workflow="news-lake-capture.yml" --limit 3
gh run watch RUN_ID --exit-status
gh run view RUN_ID --log
```

```
Entregable final:
```

- `A) Tabla de medios revisados.` 

- `B) Clasificacion A/B/C/D/E.` 

- `C) Causa exacta de falla.` 

- `D) Fuente alternativa propuesta.` 

- `E) Cambios de codigo/config si aplica.` 

- `F) Resultado de typecheck.` 

- `G) Resultado de tests.` 

- `H) Resultado de dry-runs.` 

- `I) Riesgos.` 

- `J) Recomendacion GO / NO-GO.` 

- `K) No hacer commit hasta que se autorice.` 

# `Recuerda:` 

```
La meta no es que todos queden perfectos hoy.
```

```
La meta es aumentar cobertura operativa de News Lake sin romper produccion.
```

```
======================================================================
15. ENTREGABLE ESPERADO DEL PROGRAMADOR
======================================================================
```

```
Formato recomendado:
```

```
medio_id | medio | estado actual | causa | fuente propuesta | clase | accion
MED-XXXX | Nombre | error | sitemap 404 | /feed/ | A/B/C/D/E | cambiar config
```

```
Debe entregar:
A) Medios revisados
B) Clasificacion A/B/C/D/E
C) Causa exacta de falla
D) Fuente alternativa encontrada
E) Cambio propuesto
F) Archivos modificados
G) Comandos ejecutados
H) Resultado de typecheck
I) Resultado de tests
J) Resultado de dry-run por medio
K) Resultado de real controlado si se autorizo
L) Riesgos
M) Recomendacion GO / NO-GO
```

```
======================================================================
16. REGLAS DE COMMIT
======================================================================
```

```
No hacer commit sin revision.
```

```
Antes de commit:
```

```
git status --short
git diff --stat
git diff
npm run typecheck
npm test
Nunca incluir:
- data/
- tmp/
- .env
- logs locales
- secrets
```

```
Commit message sugerido:
```

```
fix(media): repair public feeds for selected sources
O:
```

```
chore(media): audit failed sources batch 0100-0210
```

```
======================================================================
17. QUE DEBE PEGARSE A CHATGPT DESPUES DE CADA RUN
======================================================================
```

```
Pegar siempre:
- comando ejecutado
- RUN_ID
- status final
- bloque del log donde salga:
  - dry_run
```

```
  - total_seleccionados
```

- `chunks` 

- `medio_id` 

- `estado` 

- `insertadas` 

- `duplicados` 

- `totalErrores` 

- `conTextoLimpio` 

- `conCuerpoNota` 

- `mismatch si fue export Sheet` 

```
Con eso ChatGPT puede decidir:
```

- `GO siguiente oleada` 

- `NO-GO` 

- `export real` 

- `reparar medios` 

- `repetir con menor limite` 

```
======================================================================
18. PRINCIPIO OPERATIVO
```

```
======================================================================
```

```
No buscamos perfeccion inmediata.
```

```
Buscamos:
```

- `mas medios capturando` 

- `mas cuerpo completo` 

- `mas News Lake` 

- `mas deteccion por cliente` 

- `mas Sheets ETHOS_* confiables` 

```
Regla practica:
A y B se usan ya.
C sirve como radar.
D se documenta.
E se repara o se descarta.
```

