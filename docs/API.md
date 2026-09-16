# API — Despacho Mega

Base: `/api`. Todas las respuestas son JSON con la forma `{ ok, data }` en éxito
y `{ ok: false, error }` en fallo.

Todos los endpoints, salvo `/health`, exigen:

```
Authorization: Bearer <access_token de Supabase>
```

Códigos de error transversales:

| Código | Cuándo                                                        |
| ------ | ------------------------------------------------------------- |
| 400    | El cuerpo o los parámetros no pasan el esquema Zod             |
| 401    | Token ausente, inválido o vencido                              |
| 403    | Usuario no habilitado, inactivo, o sin rol admin               |
| 404    | El recurso no existe                                           |
| 409    | Conflicto de estado (factura ya procesada, despacho ya cerrado)|
| 502    | Siesa no respondió o respondió mal                             |

---

## Salud

### `GET /api/health`

Público. Sin autenticación.

---

## Identidad

### `GET /api/yo`

Devuelve el usuario resuelto desde el token.

```json
{
  "ok": true,
  "data": {
    "userId": "uuid",
    "correo": "operario@merkahorrosas.com",
    "operarioId": "uuid",
    "nombre": "Juan Pérez",
    "rol": "operario",
    "sede": "Megamayoristas"
  }
}
```

---

## Facturas

### `GET /api/facturas/:numero`

Consulta la factura en Siesa **sin crear nada**. Sirve para confirmar antes de
abrir el despacho.

Responde `{ encabezado, items }`.

---

## Despachos

### `POST /api/despachos`

Abre la auditoría de la factura, o **reanuda** la que ya estaba en curso. El
módulo es **solo auditoría** desde la migración 012: no existe `modo`, y si un
cliente viejo lo manda, Zod lo descarta sin error.

```json
{ "numero_factura": "1520045", "despachador_id": "uuid", "tipo_documento": "P05" }
```

`despachador_id` identifica a quien **despachó físicamente** la factura (catálogo
`GET /api/despachadores`). Es obligatorio **solo al crear**; al reanudar no se
envía ni se valida.

| Situación del despachador | Respuesta |
| ------------------------- | --------- |
| Falta al crear | `400` |
| No existe | `404` |
| Existe pero `activo = false` | `400` |

`tipo_documento` es la **caja** (`ID_TIPO_DOCTO`: `P02`, `P08`, …) y es
**opcional a propósito**: viene en la consulta a Siesa, así que el flujo normal
la resuelve sola con el consecutivo. **No pedírsela al operario por adelantado** —
medido: 0 colisiones en 468 documentos, así que sería cobrar un paso por factura
para un empate que casi nunca ocurre.

- `201` si se creó, `200` si se reanudó.
- Responde `{ despacho, items, reanudado }` (con `despacho.tipo_documento`, para
  que el operario pueda verificar la caja contra el papel). `despacho` incluye
  `despachador_id` y `despachador: { id, nombre, activo }`.
- `409` si la factura ya fue auditada.
- `403` si el despacho en curso es de otro operario.

#### El único caso que pide la caja: consecutivo en varias cajas

Cuando el mismo número existe en más de una caja, la respuesta es `409` y trae
las opciones en **`datos`**, no en `detalle`:

```json
{ "ok": false,
  "error": "El consecutivo 75784 existe en 2 cajas (P02, P08). Indique de cual es la factura que tiene en la mano.",
  "datos": { "cajas": ["P02", "P08"], "requiere_caja": true } }
```

El cliente muestra el selector **solo con esas cajas** y repite el `POST` con
`tipo_documento`. Mandar una caja que no corresponde también da `409`, con
`datos.cajas` nombrando dónde sí está el número.

> **`datos` vs `detalle` — la distinción importa.** `detalle` es contexto de
> depuración y **el backend lo omite en producción** (arrastra nombres de tablas
> de Supabase y Siesa). `datos` viaja siempre: es lo que el cliente necesita para
> ofrecerle una salida al operario. Con las cajas en `detalle`, en producción
> llegaba un `409` sin opciones y el selector no tenía nada que mostrar — un
> callejón sin salida que en desarrollo no se veía. Al usar `datos`, solo lo que
> ya se le puede decir al operario en voz alta: nunca tablas ni columnas.

#### La referencia es lo facturado en Siesa

Trae la factura de Siesa y crea las líneas con las cantidades facturadas:
`cantidad_solicitada` de cada línea **es lo facturado**. La auditoría verifica la
factura tal como salió del punto de venta; no hay un alistamiento previo contra
el que comparar.

### `GET /api/despachos`

Listado. Query: `estado`, `operario_id`, `numero_factura`, `desde`, `hasta`,
`limite` (máx. 200), `offset`.

Responde `{ ok, despachos, total }`.

### `GET /api/despachos/:id`

Detalle completo: `{ despacho, items, escaneos, alertas, aprobaciones }`.

Cada elemento de `escaneos[]` trae `resultado`, `metodo` y `motivo` (solo tiene
valor en los pases sin escanear; en el resto es `null`).

Un operario solo puede ver los suyos; el admin ve todos.

### `POST /api/despachos/:id/validar`

Procesa un escaneo o un ingreso manual.

```json
{ "codigo": "7702011234567", "metodo": "escaner", "cantidad": 1 }
```

**Responde 200 incluso cuando rechaza el escaneo.** La petición se procesó bien y
el rechazo quedó registrado; el resultado va en el cuerpo:

| `resultado`       | Significado                                        |
| ----------------- | -------------------------------------------------- |
| `aceptado`        | Se sumó a la línea. Trae `item` y `despacho`.       |
| `no_pertenece`    | Producto conocido, pero no está en esta factura.    |
| `no_encontrado`   | El código no resuelve a ningún producto.            |
| `item_completo`   | Esa línea ya estaba completa.                       |
| `excede_cantidad` | El escaneo supera lo que falta. No se aplica nada.  |

Todos los casos quedan en `despacho_mega_escaneos`.

### `POST /api/despachos/:id/pasar`

Registra un producto **sin escanearlo** (código de barras dañado, empaque sin
etiqueta, etc.). Disponible en modo lista y en modo cine.

```json
{ "item_id": "uuid", "cantidad": 6, "motivo": "codigo de barras danado" }
```

- `cantidad`: entera positiva, en unidades base. Puede ser **parcial**: la
  línea queda `parcial` o `completa` según `validada + cantidad` frente a lo
  solicitado.
- `motivo`: opcional, máximo 500 caracteres. Se guarda tal cual (o `null`).

**Responde 200 incluso cuando rechaza**, igual que `validar`:

| `resultado`            | Significado                                                        |
| ---------------------- | ------------------------------------------------------------------ |
| `pasado_sin_escanear`  | Aceptado. Trae `item`, `despacho` y `motivo`.                       |
| `excede_cantidad`      | Rechazado entero: `cantidad_validada` no cambia. Trae `item`.       |

Otros códigos: `403` (despacho de otro operario), `404` (despacho o ítem
inexistente), `409` (despacho no `en_proceso`).

El pase queda en `despacho_mega_escaneos` con `metodo = "pase"`,
`resultado = "pasado_sin_escanear"`, `codigo_ingresado = codigo_item` y el
`motivo`, más un evento `item_pase_registrado`. **No cuenta como rechazo ni como
intento de escaneo** en ninguna vista: las columnas `escaneos` y
`escaneos_rechazados` lo excluyen, y se reporta aparte en `pasados_sin_escanear`.

### `GET /api/despachos/:id/resolver?codigo=<barra|item>`

Traduce un código (de barras o de ítem) a la línea que le corresponde, **sin
mutar nada**. Existe para que el frontend abra el modal de cantidad al escanear
una barra: el mapeo barra → ítem vive en el catálogo del backend, y la factura
solo trae el `codigo_item`.

Responde `200` siempre; el resultado va en el cuerpo:

```json
{ "pertenece": true, "resultado": "ok", "codigo_item": "40027",
  "item_id": "uuid", "factor": 12, "unidad": "P12" }
```

| `resultado`     | Significado                                             |
| --------------- | ------------------------------------------------------- |
| `ok`            | Pertenece. Trae `item_id` (primera línea con cupo).      |
| `no_pertenece`  | Producto conocido, pero no está en esta factura.        |
| `no_encontrado` | El código no resuelve a ningún producto.                |

### `POST /api/despachos/:id/items/:itemId/ajustar`

```json
{ "cantidad": 0 }
```

Fija el total **absoluto** validado de una línea (no un incremento). `0` la
**devuelve a pendientes**. Recalcula `estado_item` e `items_validados` y deja un
evento `item_ajustado` con el de/a.

- `400` si `cantidad` supera lo solicitado.
- `409` si el despacho ya no está `en_proceso`.
- Responde `{ resultado: "ajustado", item, despacho, mensaje }`.

### `POST /api/despachos/:id/finalizar`

```json
{ "observaciones": "texto opcional" }
```

Cierra el despacho. **No exige que todo esté completo:** las líneas cortas se
marcan `faltante` o `parcial` y el despacho queda `con_novedad`. Si todo cuadró y
no hay alertas abiertas, queda `completado`.

### `POST /api/despachos/:id/cancelar`

Libera el número de factura para reintentar, sin borrar historial.

### `POST /api/despachos/:id/aprobar` · solo admin

```json
{ "item_id": "uuid (opcional)", "decision": "aprobado", "observacion": "..." }
```

Sin `item_id` la decisión aplica al despacho completo y cambia su estado. Con
`item_id` queda registrada sobre la línea y el despacho no cambia.

`400` si el despacho todavía está `en_proceso`.

### `GET /api/despachos/:id/eventos`

Bitácora del despacho en orden cronológico: quién lo abrió, cada rechazo, la
finalización y la decisión del admin.

No exige admin: aplica la misma regla que el resto del módulo — un operario ve
lo suyo, el admin ve todo.

```json
{
  "ok": true,
  "data": [
    {
      "id": 41,
      "evento": "despacho_abierto",
      "actor_correo": "operario@merkahorrosas.com",
      "payload": { "numero_factura": "75812", "despachador_id": "uuid" },
      "created_at": "2026-08-10T13:02:11.000Z"
    }
  ]
}
```

---

## Panel de facturas · solo admin

Una fila por **factura** (su auditoría). El resto de la API razona en despachos
(una sesión de trabajo); esto razona en facturas, que es la unidad que supervisa
el administrador.

> No confundir con `GET /api/facturas/:numero`, que consulta **Siesa**. Esto
> consulta lo que pasó con la factura **dentro del módulo**.

### `GET /api/panel/facturas`

Query: `etapa`, `operario_id`, `texto`, `sede`, `desde`, `hasta`,
`con_novedades`, `con_diferencia`, `estancadas_minutos`, `limite`, `offset`.

- `etapa`: `auditando` · `auditada` · `aprobada` · `rechazada`.
  **`con_novedad` no es una etapa**, es una bandera (`novedades_abiertas`):
  como estado tapaba el dato de si la factura ya se había auditado.
- `texto` busca en número de factura **y** en nombre del cliente.
- `operario_id` es el operario de la auditoría.
- `con_novedades` y `con_diferencia` son booleanos por texto: `"true"` /
  `"false"`. Solo se aplican con `"true"`.
- `estancadas_minutos` filtra facturas sin movimiento hace más de N minutos y
  todavía en curso. El "movimiento" sale del último escaneo, no de
  `updated_at`: un escaneo rechazado es trabajo y no toca la fila del despacho.

```json
{
  "ok": true,
  "facturas": [
    {
      "numero_factura": "75812",
      "cliente_nombre": "DISTRIBUIDORA X SAS",
      "etapa": "auditando",
      "despacho_id": "uuid",
      "estado": "en_proceso",
      "operario_nombre": "Ana Gómez",
      "despachador_id": "uuid",
      "despachador": "Carlos Pérez",
      "avance_pct": 60,
      "minutos": 42.5,
      "escaneos": 30,
      "escaneos_rechazados": 3,
      "escaneados": 27,
      "pasados_sin_escanear": 2,
      "novedades_abiertas": 1,
      "tiene_diferencia": false,
      "unidades_diferencia": null,
      "ultimo_movimiento_at": "2026-08-10T14:21:00.000Z"
    }
  ],
  "total": 37,
  "conteo_por_etapa": { "auditando": 4, "auditada": 12 }
}
```

- Las columnas ya no llevan prefijo `auditoria_*` ni existen `picking_*`:
  `despacho_id`, `estado`, `operario_*`, `finalizado_at`, `minutos`,
  `total_items`, `items_validados`, `unidades_*`, `escaneos`,
  `escaneos_rechazados`, `avance_pct`.
- `escaneados` (resultado `aceptado`) y `pasados_sin_escanear` van **separados**.
  `escaneos` son los intentos reales de lectura (`aceptados + rechazados`); el
  pase no entra en ninguno de los dos.
- `avance_pct` sale de **unidades**, no de líneas completas: `items_validados`
  cuenta líneas y como barra de progreso salta a escalones.

### `GET /api/panel/facturas/:numero`

Todo lo del panel lateral en una sola llamada:

```json
{
  "resumen": { "numero_factura": "75812", "etapa": "auditada", "despachador": "Carlos Pérez", "...": "..." },
  "auditoria": { "despacho": {}, "items": [], "escaneos": [], "alertas": [], "eventos": [] },
  "linea_tiempo": []
}
```

- `resumen` es la fila de `vw_facturas` (incluye `despachador`).
- `auditoria.escaneos[]` trae `resultado` y `motivo` por escaneo: así el panel
  distingue lo leído con el lector (`aceptado`) de lo pasado a mano
  (`pasado_sin_escanear`) y muestra el motivo cuando el operario lo escribió
  (`null` si no).
- `linea_tiempo` son los eventos de la auditoría en orden cronológico.

`404` si la factura no tiene ningún despacho registrado.

---

## Control de cobertura diaria · solo admin

Responde: **"de todo lo que Siesa facturó hoy, ¿qué pasó por el módulo?"**

El resto de la API solo conoce las facturas que alguien tecleó. Una factura que
nadie abrió nunca es invisible — y es justo la que hay que encontrar antes de
cerrar el día. Medido el 10/8/2026, antes de que esto existiera: de 36
documentos en la ventana de Siesa, 5 habían pasado por el módulo.

> **Se lee de un snapshot propio, no de Siesa.** Las tablas POS conservan ~4 días
> (§1-ter), así que consultar en vivo haría imposible revisar la semana pasada.
> La captura la hace `scripts/sync-facturas-dia.js` desde un cron diario; el
> endpoint de sincronización es un complemento, **no** el mecanismo.

### `GET /api/panel/cobertura`

Query: `desde`, `hasta`, `cobertura`, `tipo_documento`, `texto`.
Sin rango, **hoy en horario de Bogotá** (no en UTC: después de las 19:00 serían
días distintos).

Estados de `cobertura`: `sin_tocar` · `auditando` · `auditada` · `excluida`.

```json
{
  "ok": true,
  "rango": { "desde": "2026-08-10", "hasta": "2026-08-10" },
  "facturas": [
    {
      "numero_factura": "7679",
      "tipo_documento": "P08",
      "cliente_nombre": "OROZCO BRAVO JUAN DIEGO",
      "lineas": 11,
      "valor_neto": 213150,
      "despacho_id": null,
      "despacho_estado": null,
      "operario_nombre": null,
      "despachador": null,
      "finalizado_at": null,
      "cobertura": "sin_tocar"
    }
  ],
  "resumen_por_dia": [
    { "dia": "2026-08-10", "facturadas": 4, "aplican": 4, "cubiertas": 1, "auditando": 0, "sin_tocar": 3 }
  ],
  "totales": {
    "aplican": 4, "cubiertas": 1, "auditando": 0, "sin_tocar": 3,
    "mostrador_aplican": 2, "mostrador_cubiertas": 0,
    "con_cliente_aplican": 2, "con_cliente_cubiertas": 1,
    "cobertura_pct": 25, "cobertura_mostrador_pct": 0, "cobertura_identificado_pct": 50
  }
}
```

**`cubiertas` = auditorías finalizadas** (`finalizado_at` no nulo). Una
auditoría abierta (`auditando`) todavía puede cancelarse, y contarla como
cubierta sería mentir justo en el momento en que el dato importa.
`cobertura_pct = cubiertas / aplican`; los ángulos mostrador y cliente
identificado usan sus propias `*_cubiertas` / `*_aplican`.

`cobertura_pct` es `null` —no 100— cuando no hay facturas: un día sin ventas no
es un día perfecto, es un día sin datos.

### `POST /api/panel/cobertura/sincronizar`

```json
{ "fecha": "2026-08-09" }
```

Sin `fecha`, guarda **toda la ventana** que Siesa tenga. Es idempotente (clave
única `cia + co_docto + tipo_documento + numero_factura`), así que reintentar es
seguro — y guardar la ventana entera hace que una corrida recupere el día que el
cron se haya perdido.

Nunca pisa `excluida` ni su motivo: son decisiones humanas y una sincronización
no puede borrarlas.

### `PATCH /api/panel/cobertura/:id/exclusion`

```json
{ "excluida": true, "motivo": "anulada en Siesa" }
```

Saca una factura del conteo. **Excluir exige motivo** (`400` sin él): sin
explicación escrita nadie puede auditar después por qué ese día dio 100%.
Reactivar (`excluida: false`) no lo pide.

---

## Alertas de inventario

### `POST /api/alertas`

```json
{
  "despacho_id": "uuid",
  "item_id": "uuid (opcional)",
  "codigo_item": "188745",
  "cantidad_faltante": 3,
  "motivo": "sin_fisico",
  "comentario": "texto opcional"
}
```

Motivos: `sin_fisico`, `averiado`, `ubicacion_errada`, `diferencia_cantidad`,
`otro`.

La alerta llega al panel del admin por Supabase Realtime.

### `GET /api/alertas`

Query: `estado`, `despacho_id`, `desde`, `hasta`, `limite`.

### `PATCH /api/alertas/:id` · solo admin

```json
{ "estado": "resuelta", "respuesta": "se ajustó el inventario" }
```

Estados: `abierta`, `en_gestion`, `resuelta`, `descartada`.

**Cerrar exige `respuesta`.** Con `estado` en `resuelta` o `descartada` y sin
texto (ni uno guardado antes) responde `400`. Descartar sobre todo: significa
"el reporte no correspondía", y eso hay que poder sustentarlo después.

Al reabrir (`en_gestion`) se limpia `resuelta_at`, porque `minutos_abierta` usa
`COALESCE(resuelta_at, NOW())` y una fecha vieja congelaría el reloj.

### `GET /api/panel/novedades` · solo admin

Bandeja del administrador. Es una lectura distinta de `GET /api/alertas` —esa la
usa también el operario— y agrega lo que la tabla sola no da: antigüedad, la
factura del despacho y el **nombre** de quien atendió (`atendida_por` apunta a
`auth.users`, así que PostgREST no lo resuelve con un join automático).

Query: `estado`, `motivo`, `desde`, `hasta`, `limite`.

```json
{
  "ok": true,
  "novedades": [
    {
      "codigo_item": "188745",
      "cantidad_faltante": 3,
      "motivo": "sin_fisico",
      "estado": "en_gestion",
      "minutos_abierta": 142.5,
      "comentario": "no había físico en la ubicación",
      "respuesta": null,
      "reportada_por_nombre": "Juan Pérez",
      "atendida_por_nombre": "Ana Gómez"
    }
  ],
  "conteo_por_estado": { "abierta": 4, "en_gestion": 1 }
}
```

Toda novedad es de auditoría: significa que el producto facturado no estaba
físicamente al despachar.

---

## Operarios · solo admin

### `GET /api/operarios`

Query opcional: `activos=true`.

> **No hay `POST /api/operarios`, y es deliberado.** El alta de personas vive en
> AdminUsuarios: quien tiene la ruta `/despacho-mega/operario` o
> `/despacho-mega/admin` queda registrado solo la primera vez que entra. Una
> segunda lista de habilitados garantizaba que tarde o temprano dijeran cosas
> distintas.

### `PATCH /api/operarios/:id`

Campos: `nombre`, `documento`, `sede`, `activo`.

`rol` **no** se edita: se deriva de la ruta asignada en cada request, así que
ponerlo a mano duraría hasta el próximo ingreso de la persona.

`modo_habilitado` **ya no se acepta** (Zod lo descarta): la columna sigue en la
tabla con el único valor `auditoria` y viaja así en las respuestas de
`GET /api/operarios`.

### `GET /api/operarios/:id/actividad`

Qué hizo esa persona, de corrido. Query opcional: `limite` (1–500, por defecto
200).

```json
{ "ok": true, "data": { "operario": { "...": "..." }, "eventos": [] } }
```

La bitácora se indexa por correo del **actor**, no por dueño del despacho: un
admin que aprueba el despacho de otro aparece acá y no allá.

---

## Despachadores

Catálogo de quienes **despachan físicamente** la mercancía. No son usuarios de
la intranet: son nombres que el auditor elige al abrir una factura, para que
quede registrado quién la despachó. Lo administra el admin; el operario solo lo
lee.

### `GET /api/despachadores` · operario o admin

Por defecto devuelve solo `activo = true`, ordenados por `nombre`.

Query: `todos=1` (o `true`) incluye los inactivos. **Solo admin**: otro rol
recibe `403`.

```json
{ "ok": true, "despachadores": [ { "id": "uuid", "nombre": "Carlos Pérez", "activo": true, "created_at": "…", "updated_at": "…" } ] }
```

### `POST /api/despachadores` · solo admin

```json
{ "nombre": "Carlos Pérez" }
```

- `201 { despachador }`.
- `400` si el nombre está vacío (se recorta antes de validar; 2–80 caracteres).
- `409` si ya existe otro con el mismo nombre, sin distinguir mayúsculas ni
  espacios al borde (índice único sobre `lower(trim(nombre))`).

### `PATCH /api/despachadores/:id` · solo admin

```json
{ "nombre": "Carlos A. Pérez", "activo": false }
```

Al menos un campo. `200 { despachador }`; `404` si no existe; `409` si el nombre
nuevo choca con otro.

**No hay `DELETE`.** La baja es `activo = false`: el despachador deja de
ofrecerse al abrir auditorías nuevas, pero sigue apareciendo por JOIN en los
despachos históricos que ya lo tienen.

---

## Analítica · solo admin

Query común: `desde`, `hasta` (`YYYY-MM-DD`), `operario_id`, `limite`.
Sin rango, los últimos 30 días. No existe filtro `modo`: si llega, se descarta.

| Endpoint                       | Devuelve                                      |
| ------------------------------ | --------------------------------------------- |
| `/analitica/tablero`           | Todo lo de abajo en una sola llamada           |
| `/analitica/resumen`           | Serie diaria `{ dia, despachos, items_validados }` |
| `/analitica/por-operario`      | Una fila por operario, no por día              |
| `/analitica/productos-top`     | Top del rango, no de pares producto-día        |
| `/analitica/picos-trabajo`     | Grilla día de semana × hora, con `pasados_sin_escanear` |
| `/analitica/novedades`         | Novedades con tiempo abierta                   |
| `/analitica/calidad-escaneo`   | Aciertos, rechazos y `pasados_sin_escanear` por operario |

`facturas_por_dia_semana` devuelve `{ dia_semana, facturas, dias_con_datos }`
para los siete días. En calidad y picos, `pasados_sin_escanear` va **aparte** de
`aceptados` / `escaneos_ok` y no cuenta como intento ni como rechazo: la tasa de
acierto mide solo lecturas reales del lector.

### Todo llega ya agregado al rango

Las vistas agrupan **por día**; estos endpoints devuelven el rango colapsado. No
es un detalle de comodidad: las vistas diarias no se pueden sumar a ojo.

- **`COUNT(DISTINCT …)` no es aditivo.** `total_facturas` del resumen diario está
  por día+estado; sumarlo contaba la misma factura otra vez si cambiaba de
  estado. Por eso `totales.facturas` sale de `despacho_mega_vw_facturas`, que
  tiene una fila por factura.
- **`AVG(…)` tampoco.** `minutos_promedio` es por día, y promediar promedios le
  da el mismo peso a un día de 2 despachos y a uno de 20. La migración 007 agregó
  `minutos_totales` y `despachos_finalizados` para recalcularlo exacto.
- **El recorte va después de agrupar.** Antes `limite` cortaba las filas
  producto-día, así que un producto repartido en muchos días quedaba fuera del
  top aunque fuera el más despachado del rango.

La regla vive en `src/services/agregacion.js` y está cubierta por tests.

### `totales` de `/analitica/tablero`

```json
{
  "facturas": 37,
  "despachos": 52,
  "items_solicitados": 610,
  "items_validados": 588,
  "novedades_abiertas": 3,
  "facturas_auditadas": 21,
  "facturas_con_diferencia": 2,
  "unidades_diferencia": 9,
  "tasa_discrepancia": 9.52
}
```

`tasa_discrepancia` es, de las auditorías cerradas, cuántas quedaron con
faltante frente a lo facturado — **la métrica que justifica el módulo**. Solo
cuenta auditorías cerradas: mientras una corre, todo lo que el auditor aún no
escaneó se vería como diferencia.
