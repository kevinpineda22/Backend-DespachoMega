# Especificación: Escaneo asistido — pasar sin escanear (escaneo-asistido)

## Propósito

El auditor puede registrar que un producto se despachó sin escanearlo, indicando una
cantidad parcial y un motivo opcional, tanto en modo lista como en modo cine. Este
registro es distinguible de un escaneo real, respeta el tope de lo facturado, participa
en la finalización y la bitácora, y no infla los conteos de rechazo.

## Requerimientos

### Requerimiento: Resultado "pasado sin escanear"

El sistema MUST exponer `POST /api/despachos/:id/pasar` con body `{ item_id, cantidad,
motivo? }` que registre un ítem como despachado sin escanear código de barras, con
`cantidad` entera positiva en unidades base que no exceda lo facturado restante y
`motivo` opcional nullable (máx 500). El registro MUST persistirse en
`despacho_mega_escaneos` con `resultado = 'pasado_sin_escanear'`, `metodo = 'pase'`,
`motivo` y `codigo_ingresado` igual al `codigo_item` del ítem (la columna es NOT NULL).
La respuesta MUST identificar el registro como pasado sin escanear.

#### Escenario: Pasar con cantidad parcial

- GIVEN un ítem con 10 unidades facturadas y 4 ya escaneadas
- WHEN el auditor lo pasa sin escanear con cantidad 6 y sin motivo
- THEN se registra con `resultado = 'pasado_sin_escanear'`, `metodo = 'pase'` y cantidad 6
- AND la respuesta lo identifica como pasado sin escanear
- AND el ítem queda completo

#### Escenario: Con motivo

- GIVEN la cantidad no excede lo facturado
- WHEN se pasa sin escanear incluyendo un motivo
- THEN el motivo se persiste
- AND queda visible en detalle y bitácora

#### Escenario: Sin motivo

- GIVEN una cantidad válida
- WHEN se pasa sin escanear omitiendo el motivo
- THEN se acepta con motivo nulo

#### Escenario: Cantidad inválida

- GIVEN un body con cantidad cero, negativa o no entera
- WHEN se valida
- THEN se rechaza con error de validación
- AND no se registra nada

### Requerimiento: Respetar el tope de lo facturado

El pase sin escanear MUST aplicar la misma regla que `validar()`: si la cantidad
acumulada (escaneos + pasados) excede lo facturado, MUST rechazar la operación entera y
registrarla como `excede_cantidad`, sin modificar la cantidad validada. `validar()` MUST
permanecer intacto.

#### Escenario: Exceso al pasar sin escanear

- GIVEN un ítem con 10 facturadas y 8 ya validadas
- WHEN se pasa sin escanear con cantidad 5
- THEN se rechaza entero con `excede_cantidad`
- AND la cantidad validada no cambia

#### Escenario: Tope tras ítem completo

- GIVEN un ítem con 10/10 validadas
- WHEN se escanea o se pasa cualquier cantidad adicional
- THEN se rechaza con `excede_cantidad`
- AND la regla existente de escaneo no se relaja

#### Escenario: Despacho cerrado o ajeno

- GIVEN un despacho que no está `en_proceso`
- WHEN se intenta pasar un ítem
- THEN se rechaza con 409
- AND GIVEN un despacho de otro operario (usuario no admin)
- WHEN se intenta pasar un ítem
- THEN se rechaza con 403

### Requerimiento: Finalización y bitácora

Los ítems pasados sin escanear MUST contar en la cantidad validada que usa la
finalización del despacho, y la bitácora MUST registrarlos con un evento propio
(`item_pase_registrado`) incluyendo el motivo cuando exista.

#### Escenario: Finalización incluye pasados

- GIVEN un despacho con escaneos reales y pasados sin escanear
- WHEN el despacho finaliza
- THEN los totales incluyen ambas cantidades

#### Escenario: Bitácora distingue el pase

- GIVEN un pase sin escanear con motivo
- WHEN se consulta la bitácora del despacho
- THEN el evento aparece como `item_pase_registrado`
- AND con su motivo en el payload

### Requerimiento: Exclusión de los conteos de rechazo

`vw_facturas`, `vw_calidad_escaneo` y `vw_picos_trabajo` MUST NOT contar un pase sin
escanear aceptado como rechazo ni como error de escaneo, y MUST NOT contarlo como
intento de escaneo (`escaneos`). Los conteos de rechazo MUST usar la lista blanca
`no_pertenece`, `item_completo`, `excede_cantidad`, `no_encontrado`. Solo la vía de
rechazo `excede_cantidad` de un pase cuenta como rechazo.

#### Escenario: Calidad sin falso rechazo

- GIVEN un operario con 3 pasados aceptados y 0 rechazos
- WHEN se consulta `vw_calidad_escaneo`
- THEN `rechazados` es 0 y `escaneos` no incluye los pasados

#### Escenario: Picos sin falso error

- GIVEN la misma situación en una ventana de pico
- WHEN se consulta `vw_picos_trabajo`
- THEN `escaneos_con_error` no los incluye

#### Escenario: Facturas sin falso rechazo

- GIVEN una factura con 2 pasados aceptados
- WHEN se consulta `vw_facturas`
- THEN `escaneos_rechazados` no los incluye
- AND `ultimo_movimiento_at` sí considera el pase como movimiento
