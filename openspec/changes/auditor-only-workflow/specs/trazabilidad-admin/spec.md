# Especificación: Trazabilidad admin — escaneados vs. pasados (trazabilidad-admin)

## Propósito

Las vistas de administración y el detalle de factura distinguen lo escaneado de lo
pasado sin escanear, tanto en conteos como por ítem, muestran quién despachó, y la
cobertura del día se mide sobre auditorías finalizadas. Nada en la lectura admin
menciona picking.

## Requerimientos

### Requerimiento: Distinción en vistas de calidad y picos

`vw_calidad_escaneo` y `vw_picos_trabajo` MUST exponer una columna
`pasados_sin_escanear` separada de `aceptados`/`escaneos_ok`, por operario (calidad) y
por ventana de tiempo (picos), de modo que la UI admin muestre ambos desgloses sin
mezclarlos. La agregación del backend (`agregacion.js`) MUST acumular
`pasados_sin_escanear` en calidad y en el mapa de calor.

#### Escenario: Calidad con ambos desgloses

- GIVEN un operario con 12 escaneados y 3 pasados sin escanear
- WHEN se consulta `vw_calidad_escaneo`
- THEN `aceptados = 12` y `pasados_sin_escanear = 3`
- AND `escaneos` no incluye los pasados

#### Escenario: Picos con ambos desgloses

- GIVEN un día y hora con escaneados y pasados sin escanear
- WHEN se consulta `vw_picos_trabajo`
- THEN `escaneos_ok` y `pasados_sin_escanear` son distinguibles
- AND el mapa de calor acumula ambos por celda

### Requerimiento: vw_facturas y tablero

`vw_facturas` MUST tener una fila por auditoría (sin pivote picking) e incluir
`despachador_id`, `despachador` (nombre por JOIN), `escaneados` y
`pasados_sin_escanear`. `etapa` MUST valer solo `auditando`, `auditada`, `aprobada` o
`rechazada`. Las agregaciones del tablero MUST mantener la distinción escaneado vs.
pasado. Los pasados sin escanear MUST NOT sumar en `escaneos_rechazados`.

#### Escenario: Factura con ambos tipos

- GIVEN una factura con 10 escaneados y 2 pasados sin escanear
- WHEN se consulta `vw_facturas`
- THEN `escaneados = 10` y `pasados_sin_escanear = 2`
- AND `escaneos_rechazados` no incluye los pasados
- AND la fila incluye `despachador`

#### Escenario: Sin columnas de picking

- GIVEN la vista `vw_facturas` tras la migración
- WHEN se listan sus columnas
- THEN no existe ninguna columna `picking_*`
- AND las columnas antes prefijadas `auditoria_*` aparecen sin prefijo (`despacho_id`, `estado`, `operario_*`, `finalizado_at`, `minutos`, `avance_pct`, …)

#### Escenario: Tablero agrega por separado

- GIVEN varias facturas con mezclas de escaneado y pasado
- WHEN se consulta el tablero
- THEN los agregados separan escaneado de pasado

### Requerimiento: Analítica sin modo

`vw_resumen_diario`, `vw_por_operario` y `vw_facturas_por_dia_semana` MUST agregar sin
columna `modo`. La analítica MUST devolver una fila por operario, una serie diaria única
`{ dia, despachos, items_validados }` y `facturas_por_dia_semana` sin
`facturas_picking`/`facturas_auditoria`. Los querys de analítica y de la bandeja de
novedades SHALL NO aceptar filtro `modo`.

#### Escenario: Una fila por operario

- GIVEN un operario con despachos en varios días
- WHEN se consulta `por_operario`
- THEN devuelve una sola fila para ese operario
- AND la fila no tiene campo `modo`

#### Escenario: Serie diaria única

- GIVEN despachos en varios días
- WHEN se consulta la serie diaria
- THEN cada día trae `{ dia, despachos, items_validados }`
- AND no hay claves `picking` ni `auditoria`

### Requerimiento: Cobertura sobre auditadas

`vw_cobertura_dia` MUST clasificar cada factura como `excluida`, `sin_tocar`,
`auditada` (auditoría finalizada) o `auditando`, y MUST exponer `despacho_id`,
`despacho_estado`, `operario_nombre`, `despachador` y `finalizado_at`.
`vw_cobertura_resumen` MUST exponer `auditando`, `cubiertas`, `mostrador_cubiertas` y
`con_cliente_cubiertas`, donde `cubiertas` = facturas auditadas. `cobertura_pct` MUST
ser `cubiertas / aplican`. MUST NOT existir `alistando`, `alistada`, `con_picking`,
`con_auditoria` ni `*_con_picking`.

#### Escenario: Factura auditada cuenta como cubierta

- GIVEN una factura del día con auditoría finalizada
- WHEN se consulta la cobertura
- THEN `cobertura = 'auditada'`
- AND suma en `cubiertas`

#### Escenario: Auditoría abierta no cubre

- GIVEN una factura del día con auditoría `en_proceso`
- WHEN se consulta la cobertura
- THEN `cobertura = 'auditando'`
- AND no suma en `cubiertas`

#### Escenario: Porcentaje

- GIVEN 10 facturas que aplican y 7 auditadas
- WHEN se consulta el tablero de cobertura
- THEN `cobertura_pct = 70`

### Requerimiento: Detalle de factura

El detalle de factura (admin) MUST devolver `{ resumen, auditoria: { despacho, items,
escaneos, alertas, eventos }, linea_tiempo }` sin `picking` ni `comparativo`; MUST
identificar cada escaneo por `resultado` (`aceptado` vs. `pasado_sin_escanear`), MUST
incluir el `motivo` del pase cuando exista y MUST mostrar `despachador` en `resumen`.

#### Escenario: Detalle por ítem

- GIVEN una factura con ítems escaneados y pasados
- WHEN se consulta el detalle admin
- THEN cada escaneo indica su `resultado` y `metodo`
- AND los pasados muestran `motivo` cuando existe
- AND `resumen.despachador` está presente

#### Escenario: Detalle sin motivo

- GIVEN un pase sin escanear guardado sin motivo
- WHEN se consulta el detalle
- THEN el escaneo se muestra como `pasado_sin_escanear`
- AND `motivo` es `null` (no un error)

#### Escenario: Detalle sin picking

- GIVEN cualquier factura
- WHEN se consulta el detalle admin
- THEN la respuesta no contiene claves `picking` ni `comparativo`
- AND `linea_tiempo` contiene solo eventos de la auditoría
