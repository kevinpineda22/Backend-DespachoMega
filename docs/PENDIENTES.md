# Pendientes — Despacho Mega

Estado al 10 de agosto de 2026. Ordenados por lo que bloquea a lo que no.

Convención: **[B]** bloqueante, **[A]** alto, **[M]** medio, **[B-]** bajo.

---

## 1. Consulta de facturas en Siesa — RESUELTO (6 ago 2026)

Publicada como **`merkahorro_Despacho_Factura_dev`** (Connekta v3). Fuente: las
tablas POS de Siesa (`t9820_pdv_d_doctos`, `t9830_pdv_d_movto_venta`), filtradas
a `f9820_id_cia = 2` (Megamayoristas).

`facturaSiesa.service.js` mapea las columnas reales — ya no hay tabla de alias
tentativos, que era lo peligroso de la versión anterior.

### Cómo se identifica una factura

El número que teclea el operario es **`CONSEC_DOCTO`**. Pero la identidad real de
un documento en Siesa es `Cia + CoDoc + ID_TIPO_DOCTO + CONSEC_DOCTO`, y conviven
varias series con numeraciones independientes (`P02`, `P05`, `P08`, `PN5`).

Si un consecutivo apareciera en dos series, `consultarFactura()` devuelve **409**
pidiendo el tipo de documento en vez de elegir una. Medido: hoy 0 colisiones, así
que ese camino es una red, no el flujo normal.

### Trampa de Connekta, verificada

Una consulta **no publicada** devuelve `HTTP 401` — *"No autorizado, los datos
proporcionados son incorrectos"* — con el mismo código y mensaje que unas
credenciales inválidas. **No devuelve 404.**

| Consulta                       | Respuesta                          |
| ------------------------------ | ---------------------------------- |
| `merkahorro_Ventas_Ecommmerce` | `HTTP 200` — "Transacción Exitosa" |
| `merkahorro_Despacho_Factura`  | `HTTP 401` (no existía)            |

Ante un 401, revisar **primero el nombre de la consulta**, no `CONNI_KEY`.
`siesaClient.js` distingue el caso: no reintenta —reintentar nunca lo arregla— y
el mensaje nombra la consulta y las dos causas posibles.

### Semántica de cantidades — no obvia y crítica

`CANTIDAD` viene en **unidades base**; `PrecioUnitDet` va **por paquete**. Están
en escalas distintas, así que `CANTIDAD × PrecioUnitDet` no cuadra con la línea.

La relación real, verificada en **95 de 95 líneas (100%)** y confirmada después
con una muestra independiente:

```
(CANTIDAD / factor_unidad) × PrecioUnitDet = VALOR_BRUTO + VrImptoDet
```

Ejemplo: `CANTIDAD 288`, `UNIDAD_MEDIDA "P24"`, `PrecioUnitDet 12150` →
288/24 = 12 paquetes → 12 × 12150 = 145.800 = `VALOR_BRUTO`.

`VALOR_BRUTO` es el valor **sin IVA** de la línea. Los productos exentos tienen
`VALOR_BRUTO` = `PrecioUnitDet`.

### Detalles del formato

- `CONSEC_DOCTO` e `id_item` llegan como **número**, no string.
- `FECHA_DOCTO` llega como ISO: `"2026-08-06T00:00:00"`.
- `UNIDAD_MEDIDA` llega con espacios de relleno: `"UND "`, `"P6  "`.
- No hay número de línea: el orden de llegada es la numeración. `RowidMvto` es
  el GUID del movimiento, por si hace falta reconciliar contra Siesa.
- `LineaRegistro` aparece en Postman pero **no** en la respuesta que entrega
  Connekta al backend. No depender de ese campo.
- Un mismo ítem puede repetirse en varias líneas del documento (medido: 2 de 11
  documentos). Por eso la unicidad de ítems es por línea, no por código.

---

## 1-bis. Catálogo de Megamayoristas — RESUELTO (6 ago 2026)

**No hizo falta ninguna consulta nueva en Siesa.**

`items_siesa` / `siesa_codigos_barras` guardan solo **Merkahorro (Cía 1)**: el
script `scripts/siesa_cron_sync.js` del frontend descartaba explícitamente el
resto. Pero las consultas estándar (`API_v2_ItemsExtensiones`,
`API_v2_ItemsBarras`) **ya devuelven todas las compañías**.

### Medido el 6 de agosto de 2026

| Dato                                          | Valor            |
| --------------------------------------------- | ---------------- |
| Registros en `API_v2_ItemsExtensiones`        | 36.463           |
| — Cía 1 (Merkahorro)                          | 23.287           |
| — Cía 2 (Megamayoristas)                      | 13.176           |
| Ítems **activos** de Cía 2                    | 1.734            |
| Cobertura de los ítems de facturas de Mega    | **69/69 (100%)** |

Los códigos de barras de Cía 2 están en `API_v2_ItemsBarras` (páginas ~900+),
con EANs reales: `7702001041725`, `7707324488615`.

### Cómo quedó

- **Un solo script parametrizado**, no una bifurcación:
  `SIESA_SYNC_CIA`, `SIESA_SYNC_TABLA_ITEMS`, `SIESA_SYNC_TABLA_BARRAS`,
  `SIESA_SYNC_CON_FACTOR`. Los defaults reproducen el comportamiento anterior,
  así que `siesa-sync.yml` no se enteró del cambio.
- **Workflow propio**: `.github/workflows/siesa-sync-mega.yml`, una hora después
  del de Merkahorro.
- `factor` se deriva del **código de unidad** (`P12` = 12 unidades).

### El factor NO viene en ningún campo numérico de Siesa

Primero se asumió que era `f131_cant_unidad_medida`. **Es falso.** Verificado
sobre filas con unidad `P3`, `P6`, `P12` y `P15`: todos los candidatos valen 1 o
0 sin importar el tamaño del paquete.

```
f131_cant_unidad_medida  1     f131_factor          0
f131_ind_factor          1     f131_cant_interna_1  1
```

El tamaño solo vive en `f131_id_unidad_medida`. Se deriva con `/^P(\d+)$/`;
`UND` y `KL` quedan en 1. Respaldo independiente: la fórmula de cantidades del
punto 1 se cumplió en 95/95 líneas de facturas.

**Resultado de la primera sincronización de Cía 2** (617 s): 1.734 ítems
activos, 4.548 códigos de barras, **504 de paquete**. Criterios: 1.734 grupos,
1.734 subgrupos, 1.726 marcas, 0 sin clasificar.

### El filtro por compañía va del lado del servidor

`parametros=f120_id_cia=N` hace que Siesa devuelva **solo** esa compañía. Sin
esto, cada sincronización se bajaba todo y descartaba lo ajeno: con dos
compañías, el doble de carga sobre Siesa para el mismo resultado.

Verificado el 6 de agosto de 2026:

| Prueba                        | Resultado                                          |
| ----------------------------- | -------------------------------------------------- |
| Misma página, `cia=1` vs `cia=2` | ids `[5,7,9]` vs `[1,2,3]` — datos distintos     |
| Página 150                    | `cia=1` con datos, `cia=2` ya vacía                 |
| ItemsExtensiones `cia=2`      | 13.176 (sin filtro: 36.463)                         |
| ItemsBarras `cia=2`           | 20.552, con EANs reales                             |
| ItemsCriterios `cia=2`        | ≥60.000                                             |

**El filtro en cliente por `f120_id_cia` NO se quitó.** Si algún día Siesa
ignora el parámetro, la sincronización sigue siendo correcta — solo vuelve a ser
lenta. Barato de mantener, caro de no tener.

Como efecto secundario, la sincronización de **Merkahorro también quedó más
rápida**: antes descargaba los 13.176 ítems de Cía 2 para tirarlos.

### Requiere un secreto nuevo en GitHub

`SUPABASE_SERVICE_ROLE_KEY`. Las tablas de Despacho Mega tienen RLS activo y sin
políticas de escritura, así que la anon key **no puede insertar**.

---

## 1-ter. [A] El histórico NO está en las tablas POS — ampliar la ventana no sirve

**Ampliar el `DATEADD` fue un callejón sin salida, y la razón importa.**

El `WHERE` de la consulta se amplió a 30 días y **funciona perfectamente**. Lo
demuestran las columnas de diagnóstico que se agregaron a la consulta
(`db/siesa/merkahorro_Despacho_Factura_dev.sql`), medidas el 10/8/2026:

```
FechaServidor  -> 20260810     el servidor está en la fecha correcta
CorteAplicado  -> 20260711     el filtro sí aplica los 30 días
Día más viejo con datos -> 20260807
```

El corte es el 11 de julio y el documento más antiguo es del 7 de agosto. **El
filtro no está recortando nada: simplemente no existen documentos POS más viejos
que ~4 días.**

`t9820_pdv_d_doctos` / `t9830_pdv_d_movto_venta` son tablas de **staging del
punto de venta**. Los documentos se contabilizan y salen de ahí. Poner `-90` o
`-365` daría exactamente el mismo resultado.

### Consecuencia operativa

**Una factura de más de ~4 días no se puede abrir en Despacho Mega.** Si el
negocio audita con más rezago que eso, hace falta otra fuente — no otro rango.

### Si hace falta histórico

Pedirle a Siesa una **segunda consulta sobre las tablas de facturación**
(`t350_co_docto` / `t351_co_docto_movto` y afines), que es donde quedan los
documentos ya contabilizados. Mismas columnas lógicas que la actual: encabezado
repetido por línea, con `f350_id_consec_docto`, `f120_id`, cantidad, unidad y
precio.

El backend la usaría como **respaldo**: primero la consulta POS (rápida, cubre
el flujo normal del día); si el consecutivo no aparece, recién ahí la histórica.
Ese encadenamiento ya tiene su lugar natural en `consultarFactura()`, donde hoy
se fuerza el refresco antes de dar por inexistente una factura.

### Lo que sí quedó resuelto

- El `-30` está publicado y activo.
- Las columnas `FechaServidor` y `CorteAplicado` quedan en la consulta: la
  respuesta ahora dice por sí misma qué fecha cree el servidor que es y desde
  cuándo filtra. El backend las ignora.

> **Dos trampas que costaron tiempo y conviene no repetir:**
>
> 1. **Había una URL de Connekta de pruebas.** Postman apuntaba ahí y devolvía
>    datos congelados de julio, mientras el backend —que usa la de producción—
>    traía agosto. Dos fuentes distintas dando respuestas distintas a la misma
>    consulta. La URL de producción es
>    `https://servicios.siesacloud.com/api/connekta/v3`.
> 2. **La factura 75794 nunca existió en producción**: era del ambiente de
>    pruebas. Se perdió un rato buscándola en los datos reales.

---

## 2. Primer administrador — HECHO (6 ago 2026)

`juanmerkahorro@gmail.com` quedó con `rol = 'admin'` y `modo_habilitado = 'ambos'`
en `despacho_mega_operarios`. Los siguientes ya se crean desde la pestaña
**Operarios** del panel.

> **Trampa del `INSERT ... SELECT` del README:** si el correo no existe en
> `auth.users`, inserta **0 filas** y el editor igual responde "Success".
> Verificar el conteo después. Así se detectó que el correo que se había asumido
> no existía entre los 158 usuarios.

---

## 3. [A] Forzar cambio de contraseña en el primer ingreso

Hoy el admin define una contraseña temporal y se la dicta al operario. Esa
contraseña queda vigente indefinidamente.

Opción más simple con lo que ya hay: marcar `user_metadata.debe_cambiar_password`
al crear el usuario y que el frontend redirija a cambio de contraseña mientras la
bandera esté puesta.

---

## 4. [M] Concurrencia en la validación de ítems

`despacho.service.js → validar()` lee el ítem, calcula la cantidad nueva y
escribe. Entre la lectura y la escritura hay una ventana: dos escaneos casi
simultáneos del mismo producto pueden leer el mismo valor y perder uno.

En la práctica el riesgo es bajo (un solo operario por despacho), pero un lector
disparando doble por rebote lo puede provocar.

**Solución propuesta:** escritura condicional — agregar al `UPDATE` un filtro
`cantidad_validada = <valor leído>` y, si no afectó filas, releer y reintentar
una vez. Es un cambio acotado a `actualizarItem` en el repositorio.

---

## 5. ~~Estado `sobrante`~~ — RESUELTO (5 ago 2026)

**Decisión de negocio: no se permite ingresar más de lo que dice la factura.**

Un escaneo que excede la cantidad solicitada se **rechaza**; queda registrado en
`despacho_mega_escaneos` con `resultado = 'excede_cantidad'` y la línea nunca
supera lo solicitado.

Se sacó `sobrante` del enum `despacho_mega_estado_item`. Si algún día cambia la
regla, agregar el valor al enum **no alcanza**: hay que cambiar `validar()` en
`despacho.service.js`, que es donde vive el rechazo.

---

## 6. ~~Notificación a inventario fuera del panel~~ — HECHO (5 ago 2026)

Implementado en `src/lib/correo.js`, disparado desde `alerta.service.js` después
del insert. Nodemailer sobre el SMTP de Office 365.

**Apagado por defecto.** Requiere `SMTP_HOST`, `EMAIL_USER`, `EMAIL_PASS` **y**
`EMAIL_ALERTAS_INVENTARIO`. Sin destinatario explícito no sale nada, aunque el
SMTP esté completo — para que nadie empiece a recibir correos por un despliegue
que no esperaba.

### Caveat abierto: entrega no garantizada en Vercel [B-]

El envío va sin `await` para no hacer esperar al operario. En una función
serverless, la instancia puede congelarse al responder, antes de que el correo
salga.

**No se pierde la alerta** (ya está en la base y viajó por Realtime), pero el
correo es best-effort de verdad. Si algún día tiene que ser confiable, el camino
es una cola o un trigger de base de datos, **no** poner un `await` acá.

---

## 7. [B-] Tests

El proyecto tiene `vitest` configurado pero todavía no hay pruebas. Los
candidatos con mejor relación valor/esfuerzo, porque son lógica pura sin I/O:

- `facturaSiesa.service.js → normalizarFactura()` — el manejo de alias y de
  números con formato colombiano (`1.000,00`).
- `siesaClient.js → extraerFilas()` — las seis formas en que Siesa envuelve los
  datos.
- La máquina de estados de `validar()` con ítems repetidos en varias líneas.

---

## 8. [B-] Paginación en analítica

`/analitica/tablero` trae hasta 500 filas por vista. Con un año de operación las
vistas por día crecen y la respuesta se va a poner pesada.

Cuando pase: agregar agregación por semana/mes en las vistas SQL en vez de
paginar en el cliente.
