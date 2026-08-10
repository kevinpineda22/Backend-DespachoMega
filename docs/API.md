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
{ "estado": "resuelta", "respuesta": "texto opcional" }
```

Estados: `abierta`, `en_gestion`, `resuelta`, `descartada`.

---

## Operarios · solo admin

### `GET /api/operarios`

Query opcional: `activos=true`.

### `POST /api/operarios`

Crea el usuario en Supabase Auth **y** la fila del módulo.

```json
{
  "correo": "operario@merkahorrosas.com",
  "nombre": "Juan Pérez",
  "documento": "1020304050",
  "password": "temporal-12345",
  "rol": "operario",
  "modo_habilitado": "ambos",
  "sede": "Megamayoristas"
}
```

`409` si el correo ya está en el módulo, o si ya tiene cuenta en la intranet por
otro módulo (en ese caso hay que vincular, no crear).

### `PATCH /api/operarios/:id`

Campos: `nombre`, `documento`, `rol`, `modo_habilitado`, `sede`, `activo`.

---

## Analítica · solo admin

Query común: `desde`, `hasta` (`YYYY-MM-DD`), `modo`, `operario_id`, `limite`.
Sin rango, los últimos 30 días.

| Endpoint                      | Devuelve                                   |
| ----------------------------- | ------------------------------------------ |
| `/analitica/tablero`          | Todo lo de abajo en una sola llamada        |
| `/analitica/resumen`          | Totales por día, modo y estado              |
| `/analitica/por-operario`     | Despachos por usuario                       |
| `/analitica/productos-top`    | Productos más despachados                   |
| `/analitica/picos-trabajo`    | Escaneos por día de semana y hora           |
| `/analitica/novedades`        | Novedades de inventario con tiempo abierta  |

`/analitica/tablero` agrega `totales` (facturas, despachos, líneas) para las
tarjetas de cabecera.
