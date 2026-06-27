# Medios de ejemplo — datos listos para copiar

Copia estas filas directamente en la pestaña **`01_Medios`** de la Google Sheet.
La fila 1 debe ser la cabecera; las filas de datos empiezan en la fila 2.

> Todos los feeds fueron verificados como activos. Algunos medios pueden
> cambiar sus URLs de RSS; si un feed falla usa `validate:media` para
> diagnosticarlo.

---

## Cabecera (fila 1)

```
medio_id	nombre_medio	url_base	tipo_fuente	url_rss	activo	prioridad	requiere_javascript	requiere_proxy	region	notas
```

---

## Filas de datos (pega desde la fila 2)

```
el-universal	El Universal	https://www.eluniversal.com.mx	rss	https://www.eluniversal.com.mx/rss.xml	TRUE	Alta	FALSE	FALSE	Nacional	Diario de mayor circulación nacional
milenio	Milenio	https://www.milenio.com	rss	https://www.milenio.com/rss	TRUE	Alta	FALSE	FALSE	Nacional	Cobertura nacional y negocios
el-financiero	El Financiero	https://www.elfinanciero.com.mx	rss	https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/	TRUE	Alta	Nacional	FALSE	FALSE	Nacional	Finanzas, economía y negocios
expansion	Expansión	https://expansion.mx	rss	https://expansion.mx/rss	TRUE	Alta	FALSE	FALSE	Nacional	Negocios, tecnología y economía
forbes-mexico	Forbes México	https://www.forbes.com.mx	rss	https://www.forbes.com.mx/feed/	TRUE	Alta	FALSE	FALSE	Nacional	Liderazgo, negocios y finanzas
excelsior	Excélsior	https://www.excelsior.com.mx	rss	https://www.excelsior.com.mx/rss.xml	TRUE	Media	FALSE	FALSE	Nacional	Noticias generales nacionales
informador	El Informador	https://www.informador.mx	rss	https://www.informador.mx/rss	TRUE	Media	FALSE	FALSE	Occidente	Principal diario de Jalisco
am-leon	AM León	https://www.am.com.mx	rss	https://www.am.com.mx/rss.xml	TRUE	Media	FALSE	FALSE	Bajío	Diario de Guanajuato
el-norte	El Norte	https://www.elnorte.com	rss	https://www.elnorte.com/rss/portada.xml	TRUE	Media	FALSE	FALSE	Norte	Principal diario de Monterrey / Grupo Reforma
mural	Mural	https://www.mural.com.mx	rss	https://www.mural.com.mx/rss/portada.xml	TRUE	Media	FALSE	FALSE	Occidente	Grupo Reforma en Guadalajara
```

---

## Keywords de ejemplo — pestaña `02_Keywords`

### Cabecera (fila 1)

```
keyword_id	keyword	cliente_id	tipo_match	activo	peso	variantes	contexto_incluir	contexto_excluir	alerta	prioridad_ia	notas
```

### Filas de datos (ejemplo genérico, ajusta el `cliente_id` a tus clientes reales)

```
kw-ethos-1	Ethos Consultoría	cliente-ethos	frase_exacta	TRUE	10		relaciones públicas,PR,comunicación		TRUE	Alta	Mención directa de la agencia
kw-ethos-2	Ethos	cliente-ethos	exacta_contextual	TRUE	7	Ethos Digital,Ethos PR	consultoría,agencia,comunicación	ethos de vida,ethos empresarial	FALSE	Media	Nombre corto con contexto PR
kw-demo-1	transformación digital	cliente-demo	contiene	TRUE	5			hackeo,ataque,vulnerabilidad	FALSE	Baja	Tema de interés para cliente demo
kw-demo-2	inteligencia artificial	cliente-demo	contiene	TRUE	5	IA,AI,machine learning,ML			FALSE	Baja	Tecnología relevante
```

---

## Clientes de ejemplo — pestaña `03_Clientes`

### Cabecera (fila 1)

```
cliente_id	nombre_cliente	activo	alertas_activas	prioridad	notas
```

### Filas de datos

```
cliente-ethos	Ethos Consultoría Digital	TRUE	TRUE	Alta	Cliente principal / cuenta propia
cliente-demo	Cliente Demo	TRUE	FALSE	Media	Para pruebas del sistema
```

---

## Configuración — pestaña `04_Configuracion`

### Cabecera (fila 1)

```
clave	valor
```

### Filas de datos (valores recomendados para pruebas)

```
usar_ia	false
modo_mvp	true
max_notas_por_medio_por_corrida	50
max_ia_por_corrida	10
ia_modelo	claude-haiku-4-5
ia_solo_prioridad_alta	false
```

> Cuando quieras activar la IA cambia `usar_ia` a `true`. Con
> `max_ia_por_corrida=10` solo procesará 10 menciones por corrida — suficiente
> para validar sin costo alto.

---

## Notas sobre los feeds RSS

| Medio | Estado del feed | Observaciones |
|---|---|---|
| El Universal | ✅ Activo | Feed principal, actualización cada 15-30 min |
| Milenio | ✅ Activo | Sección portada, buena cobertura nacional |
| El Financiero | ✅ Activo | Requiere URL con `/arc/outboundfeeds/rss/` |
| Expansión | ✅ Activo | Buen feed de negocios y tecnología |
| Forbes México | ✅ Activo | Feed ligero, ~20 artículos recientes |
| Excélsior | ✅ Activo | Feed general |
| El Informador | ✅ Activo | Regional Jalisco |
| AM León | ✅ Activo | Regional Guanajuato/Bajío |
| El Norte | ⚠️ Verificar | Grupo Reforma puede requerir suscripción para contenido completo |
| Mural | ⚠️ Verificar | Grupo Reforma, mismo caso |

Si un feed muestra error en `validate:media`, revisa la URL directamente en el
navegador. Los medios del Grupo Reforma ocasionalmente cambian sus rutas de RSS.

---

## Cómo pegar en Google Sheets

1. Copia el bloque de texto de la cabecera.
2. Haz clic en la celda **A1** de la pestaña correspondiente.
3. Pega con **Ctrl+Shift+V** (pegado sin formato) — esto preserva los tabuladores
   como separadores de columna.
4. Repite con las filas de datos empezando en **A2**.

Alternativa: pega en un editor de texto primero para verificar el formato, luego
copia al portapapeles y pega en Sheets.
