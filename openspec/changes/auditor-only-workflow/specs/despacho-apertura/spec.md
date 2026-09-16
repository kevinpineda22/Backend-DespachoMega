# Especificación: Apertura de auditoría (despacho-apertura)

## Propósito

Abrir un despacho es siempre una auditoría: el picking desaparece por completo del
módulo (escritura, lectura y cobertura) y el campo `modo` sale del contrato de la API.
Al abrir se elige un **despachador** del catálogo administrado por el admin
(`despacho_mega_despachadores`), y su nombre viaja en todas las respuestas. Como todos
los datos actuales son de prueba, la migración que habilita este cambio es destructiva:
trunca las tablas transaccionales y recrea los enums sin valores de picking. Los ítems
se entregan ordenados por línea para el modo cine.

## Requerimientos

### Requerimiento: Apertura en modo único auditoría

El sistema MUST abrir despachos únicamente como auditoría. El body de apertura y los
querys de lectura SHALL NO exponer un campo `modo`; si un cliente lo envía, el sistema
MUST ignorarlo sin fallar. Ninguna ruta, schema, vista, enum ni función del módulo
SHALL mencionar picking. La columna `despacho_mega_despachos.modo` MAY conservarse con
un enum de un solo valor y `DEFAULT 'auditoria'`, sin que el servicio la envíe.

#### Escenario: Abrir auditoría

- GIVEN una factura sin despacho previo
- WHEN el auditor abre con `despachador_id` válido
- THEN el despacho se crea contra Siesa sin requerir ningún despacho de origen
- AND la respuesta es el flujo de auditoría, sin contexto de picking

#### Escenario: Cliente envía `modo`

- GIVEN un request de apertura que incluye `modo` con cualquier valor
- WHEN se valida el body
- THEN el campo se descarta
- AND la apertura continúa como auditoría

#### Escenario: Sin rastro de picking

- GIVEN el esquema de base de datos y el código del backend tras el cambio
- WHEN se inspeccionan enums, columnas, vistas, schemas Zod y rutas
- THEN ninguno contiene valores, columnas ni ramas de picking
- AND `despacho_origen_id` no existe

### Requerimiento: Reset destructivo de datos de prueba

La migración `012` MUST truncar `despacho_mega_despachos`, `despacho_mega_despacho_items`,
`despacho_mega_escaneos`, `despacho_mega_alertas_inventario`, `despacho_mega_aprobaciones`
y `despacho_mega_eventos`, y MUST recrear `despacho_mega_modo` (`auditoria`),
`despacho_mega_modo_operario` (`auditoria`), `despacho_mega_resultado_escaneo`
(+ `pasado_sin_escanear`) y `despacho_mega_metodo_captura` (+ `pase`). MUST NOT truncar
`despacho_mega_operarios`, `despacho_mega_items`, `despacho_mega_codigos_barras` ni
`despacho_mega_facturas_dia`. La migración MUST estar marcada como destructiva y MUST
poder re-ejecutarse dejando el mismo estado.

#### Escenario: Tablas transaccionales vacías, catálogo intacto

- GIVEN la migración `012` ejecutada
- WHEN se cuentan filas
- THEN despachos, ítems, escaneos, alertas, aprobaciones y eventos están en cero
- AND operarios, catálogo Siesa y `facturas_dia` conservan sus filas

#### Escenario: Enums solo con valores vigentes

- GIVEN la migración `012` ejecutada
- WHEN se listan los valores de los cuatro enums
- THEN `despacho_mega_modo` y `despacho_mega_modo_operario` contienen solo `auditoria`
- AND `despacho_mega_resultado_escaneo` incluye `pasado_sin_escanear`
- AND `despacho_mega_metodo_captura` incluye `pase`

#### Escenario: Re-ejecución

- GIVEN la migración `012` ya ejecutada
- WHEN se vuelve a ejecutar completa
- THEN termina sin error
- AND el esquema resultante es idéntico

### Requerimiento: Catálogo de despachadores

El sistema MUST mantener un catálogo `despacho_mega_despachadores` (`id`, `nombre`,
`activo`, `created_at`, `updated_at`) con nombre único sin distinguir mayúsculas ni
espacios en los extremos. El admin MUST poder listar (todos), crear y editar nombre o
estado. La baja MUST ser lógica (`activo = false`); el sistema SHALL NO exponer borrado
físico. Cualquier usuario autenticado MUST poder listar los despachadores activos.

#### Escenario: Crear despachador

- GIVEN un admin y `nombre = "  Carlos Pérez "`
- WHEN crea el despachador
- THEN se persiste con el nombre recortado y `activo = true`
- AND responde 201

#### Escenario: Nombre vacío o duplicado

- GIVEN un nombre vacío o solo espacios
- WHEN un admin intenta crearlo
- THEN se rechaza con error de validación (400)
- AND GIVEN un nombre que ya existe ignorando mayúsculas y espacios
- WHEN un admin intenta crearlo
- THEN se rechaza con conflicto (409)

#### Escenario: Baja lógica

- GIVEN un despachador activo con despachos históricos
- WHEN un admin lo actualiza con `activo = false`
- THEN deja de aparecer en el listado por defecto
- AND sus despachos históricos siguen mostrando su nombre
- AND no existe ninguna operación que lo elimine físicamente

#### Escenario: Listado por rol

- GIVEN un operario autenticado
- WHEN pide `GET /api/despachadores`
- THEN recibe solo los activos
- AND GIVEN el mismo operario pide `?todos=1`
- THEN se rechaza con 403
- AND GIVEN un admin pide `?todos=1`
- THEN recibe activos e inactivos

### Requerimiento: Despachador obligatorio al abrir

El sistema MUST exigir `despachador_id` al **crear** una auditoría y MUST verificar que
exista (404 si no) y esté activo (400 si no). Reanudar un despacho en curso MUST NO
volver a pedirlo ni validarlo. Las respuestas de abrir y reanudar, el detalle admin,
`vw_facturas` y `vw_cobertura_dia` MUST incluir el nombre del despachador resuelto por
JOIN.

#### Escenario: Abrir con despachador

- GIVEN un auditor con JWT válido y un `despachador_id` activo
- WHEN abre la auditoría
- THEN el despacho guarda `despachador_id`
- AND la respuesta incluye `despacho.despachador` con `id` y `nombre`

#### Escenario: Sin despachador al crear

- GIVEN una apertura sin `despachador_id` para una factura sin despacho vigente
- WHEN se procesa
- THEN se rechaza con 400
- AND no se consulta Siesa ni se crea el despacho

#### Escenario: Despachador inexistente o inactivo

- GIVEN un `despachador_id` que no existe
- WHEN se abre la auditoría
- THEN se rechaza con 404
- AND GIVEN un `despachador_id` con `activo = false`
- WHEN se abre la auditoría
- THEN se rechaza con 400
- AND en ambos casos no se crea el despacho

#### Escenario: Reanudar no recaptura

- GIVEN un despacho en curso con `despachador_id` ya guardado
- WHEN el auditor lo reanuda sin enviar `despachador_id`
- THEN la respuesta incluye el despachador original
- AND no exige enviarlo ni valida su estado

### Requerimiento: Ítems ordenados por línea para modo cine

El sistema MUST entregar los ítems de la auditoría abierta o reanudada ordenados por
número de línea de la factura, con orden estable, para que la UI de avance automático
(cine) recorra el documento en orden.

#### Escenario: Orden por línea

- GIVEN una factura con ítems en líneas 1..N
- WHEN se obtienen los ítems de la auditoría
- THEN aparecen ordenados por línea ascendente
- AND el orden se mantiene entre consultas
