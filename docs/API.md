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
    "modoHabilitado": "ambos",
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

Abre la factura, o **reanuda** el despacho que ya estaba en curso.

```json
{ "numero_factura": "1520045", "modo": "picking", "tipo_documento": "P05" }
```

`tipo_documento` es opcional: solo hace falta para desempatar si el consecutivo
existe en varias series.

- `201` si se creó, `200` si se reanudó.
- Responde `{ despacho, items, reanudado }`.
- `409` si la factura ya fue procesada en ese modo.
- `403` si el despacho en curso es de otro operario.

#### `modo: "picking"` — contra la factura

Trae la factura de Siesa y crea las líneas con las cantidades facturadas.

#### `modo: "auditoria"` — contra el picking, **no** contra la factura

Una auditoría verifica **lo que se alistó**, así que exige un picking ya
finalizado de esa misma factura:

| Estado del picking | Respuesta |
| ------------------ | --------- |
| No existe | `409` *"no tiene picking registrado"* |
| `en_proceso` | `409` *"todavía está en proceso"* |
| `rechazado` | `409` *"está en estado rechazado y no se puede auditar"* |
| Cerró sin alistar nada | `409` *"no hay nada que auditar"* |
| `completado`, `con_novedad`, `aprobado` | Abre |

Al abrir:

- **No consulta Siesa.** Las líneas salen del picking. Esto permite auditar
  despachos viejos, aunque la factura ya se haya caído de la ventana de días de
  Siesa (ver `PENDIENTES.md` §1-ter).
- `cantidad_solicitada` de cada línea = **lo que el picker validó**, no lo
  facturado. Si el picking cerró con un faltante ya reportado, auditar contra la
  factura lo marcaría como faltante otra vez.
- Solo entran las líneas con cantidad validada mayor a cero: lo que nunca se
  alistó no tiene nada físico que verificar.
- `despacho.despacho_origen_id` apunta al picking verificado.
- La respuesta agrega `picking` con el contexto para el auditor:

```json
{
  "picking": {
    "id": "uuid",
    "estado": "con_novedad",
    "operario_id": "uuid",
    "finalizado_at": "2026-08-10T11:19:17-05:00",
    "lineas_factura": 24,
    "lineas_alistadas": 3
  }
}
```

### `GET /api/despachos`

Listado. Query: `estado`, `modo`, `operario_id`, `numero_factura`, `desde`,
`hasta`, `limite` (máx. 200), `offset`.

Responde `{ ok, despachos, total }`.

### `GET /api/despachos/:id`

Detalle completo: `{ despacho, items, escaneos, alertas, aprobaciones }`.

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
      "payload": { "numero_factura": "75812", "modo": "picking" },
      "created_at": "2026-08-10T13:02:11.000Z"
    }
  ]
}
```

---

## Panel de facturas · solo admin

Una fila por **factura**, con el picking y la auditoría pivotados. El resto de
la API razona en despachos (una sesión de trabajo); esto razona en facturas, que
es la unidad que supervisa el administrador.

> No confundir con `GET /api/facturas/:numero`, que consulta **Siesa**. Esto
> consulta lo que pasó con la factura **dentro del módulo**.

### `GET /api/panel/facturas`

Query: `etapa`, `operario_id`, `texto`, `sede`, `desde`, `hasta`,
`con_novedades`, `con_diferencia`, `estancadas_minutos`, `limite`, `offset`.

- `etapa`: `alistando` · `alistada` · `auditando` · `auditada` · `aprobada` ·
  `rechazada`. **`con_novedad` no es una etapa**, es una bandera
  (`novedades_abiertas`): como estado tapaba el dato de si la factura ya se
  había auditado.
- `texto` busca en número de factura **y** en nombre del cliente.
- `operario_id` matchea al operario de **cualquiera** de las dos etapas.
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
      "picking_operario_nombre": "Juan Pérez",
      "picking_avance_pct": 100,
      "picking_minutos": 42.5,
      "auditoria_operario_nombre": "Ana Gómez",
      "auditoria_avance_pct": 60,
      "novedades_abiertas": 1,
      "escaneos_rechazados": 3,
      "tiene_diferencia": false,
      "unidades_diferencia": null,
      "ultimo_movimiento_at": "2026-08-10T14:21:00.000Z"
    }
  ],
  "total": 37,
  "conteo_por_etapa": { "alistando": 4, "auditada": 12 }
}
```

Los `*_avance_pct` salen de **unidades**, no de líneas completas:
`items_validados` cuenta líneas y como barra de progreso salta a escalones.

### `GET /api/panel/facturas/:numero`

Todo lo del panel lateral en una sola llamada: `resumen`, `picking`,
`auditoria`, `comparativo` y `linea_tiempo`.

`comparativo` cruza las líneas de las dos etapas:

```json
{
  "linea": 3,
  "codigo_item": "188745",
  "facturado": 24,
  "alistado": 24,
  "auditado": 22,
  "diferencia_picking": 0,
  "diferencia_auditoria": -2
}
```

El cruce **no** es por número de línea: `abrirAuditoria` renumera desde 1 sobre
las líneas efectivamente alistadas. Se cruza por código de ítem y en orden,
consumiendo de a uno, porque una factura puede repetir el mismo producto en
varias líneas.

`404` si la factura no tiene ningún despacho registrado.

---

## Control de cobertura diaria · solo admin

Responde: **"de todo lo que Siesa facturó hoy, ¿qué pasó por el módulo?"**

El resto de la API solo conoce las facturas que alguien tecleó. Una factura que
nadie abrió nunca es invisible — y es justo la que hay que encontrar antes de
cerrar el día. Medido el 10/8/2026, antes de que esto existiera: de 36
documentos en la ventana de Siesa, 5 tenían picking.

> **Se lee de un snapshot propio, no de Siesa.** Las tablas POS conservan ~4 días
> (§1-ter), así que consultar en vivo haría imposible revisar la semana pasada.
> La captura la hace `scripts/sync-facturas-dia.js` desde un cron diario; el
> endpoint de sincronización es un complemento, **no** el mecanismo.

### `GET /api/panel/cobertura`

Query: `desde`, `hasta`, `cobertura`, `tipo_documento`, `texto`.
Sin rango, **hoy en horario de Bogotá** (no en UTC: después de las 19:00 serían
días distintos).

Estados de `cobertura`: `sin_tocar` · `alistando` · `alistada` · `auditando` ·
`auditada` · `excluida`.

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
      "picking_hecho": false,
      "auditoria_hecha": false,
      "cobertura": "sin_tocar"
    }
  ],
  "resumen_por_dia": [
    { "dia": "2026-08-10", "facturadas": 4, "con_picking": 1, "sin_tocar": 3 }
  ],
  "totales": { "aplican": 4, "con_picking": 1, "sin_tocar": 3, "cobertura_pct": 25 }
}
```

`picking_hecho` es **finalizado**, no abierto: un picking en curso todavía puede
cancelarse, y contarlo como cubierto sería mentir justo en el momento en que el
dato importa.

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
usa también el operario— y agrega lo que la tabla sola no da: antigüedad, etapa
en la que se detectó y el **nombre** de quien atendió (`atendida_por` apunta a
`auth.users`, así que PostgREST no lo resuelve con un join automático).

Query: `estado`, `motivo`, `modo`, `desde`, `hasta`, `limite`.

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
      "modo": "auditoria",
      "comentario": "no había físico en la ubicación",
      "respuesta": null,
      "reportada_por_nombre": "Juan Pérez",
      "atendida_por_nombre": "Ana Gómez"
    }
  ],
  "conteo_por_estado": { "abierta": 4, "en_gestion": 1 }
}
```

Una novedad con `modo = "auditoria"` pesa más que una de picking: significa que
el picking la dejó pasar.

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

Campos: `nombre`, `documento`, `modo_habilitado`, `sede`, `activo`.

`rol` **no** se edita: se deriva de la ruta asignada en cada request, así que
ponerlo a mano duraría hasta el próximo ingreso de la persona.

### `GET /api/operarios/:id/actividad`

Qué hizo esa persona, de corrido. Query opcional: `limite` (1–500, por defecto
200).

```json
{ "ok": true, "data": { "operario": { "...": "..." }, "eventos": [] } }
```

La bitácora se indexa por correo del **actor**, no por dueño del despacho: un
admin que aprueba el despacho de otro aparece acá y no allá.

---

## Analítica · solo admin

Query común: `desde`, `hasta` (`YYYY-MM-DD`), `modo`, `operario_id`, `limite`.
Sin rango, los últimos 30 días.

| Endpoint                       | Devuelve                                      |
| ------------------------------ | --------------------------------------------- |
| `/analitica/tablero`           | Todo lo de abajo en una sola llamada           |
| `/analitica/resumen`           | Serie diaria: picking vs auditoría por día     |
| `/analitica/por-operario`      | Una fila por operario y modo, no por día       |
| `/analitica/productos-top`     | Top del rango, no de pares producto-día        |
| `/analitica/picos-trabajo`     | Grilla día de semana × hora                    |
| `/analitica/novedades`         | Novedades con tiempo abierta                   |
| `/analitica/calidad-escaneo`   | Aciertos y rechazos por operario, por tipo     |

### Todo llega ya agregado al rango

Las vistas agrupan **por día**; estos endpoints devuelven el rango colapsado. No
es un detalle de comodidad: las vistas diarias no se pueden sumar a ojo.

- **`COUNT(DISTINCT …)` no es aditivo.** `total_facturas` del resumen diario está
  por día+modo+estado; sumarlo contaba la misma factura una vez por picking, otra
  por auditoría y otra si cambiaba de estado. Por eso `totales.facturas` sale de
  `despacho_mega_vw_facturas`, que tiene una fila por factura.
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

`tasa_discrepancia` es de lo auditado cuánto no coincidió con lo alistado —
**la métrica que justifica el módulo**. Solo cuenta auditorías cerradas: mientras
una corre, todo lo que el auditor aún no escaneó se vería como diferencia.
