# Design: Auditor-only Workflow

## Technical Approach

Un solo modo (`auditoria`): `abrir()` deja de bifurcar, la apertura siempre
consulta Siesa (flujo que hoy existe como `abrirAuditoriaSinPicking`) y exige
`despachador_id` de un catálogo administrado. El "pasar sin escanear" es un
resultado nuevo del enum `despacho_mega_resultado_escaneo` persistido en
`despacho_mega_escaneos` con una columna nueva `motivo`.

Como todos los datos actuales son de prueba (D8), la limpieza de picking se
hace **desde cero**: la migración `012` trunca las tablas transaccionales,
recrea los cuatro enums con solo los valores vigentes, elimina
`despacho_origen_id` y redefine todas las vistas afectadas con nombres limpios.
No hay compatibilidad hacia atrás que sostener: el frontend se despliega junto
con el backend (D10).

Referencias: proposal.md; specs `despacho-apertura`, `escaneo-asistido`,
`trazabilidad-admin`; plan maestro `docs/PLAN-AUDITOR-ONLY-WORKFLOW.md`.

## Architecture Decisions

### D1: Representación de "pasado sin escanear"

| Opción | Tradeoffs |
|--------|-----------|
| **A. Valor `pasado_sin_escanear` en `resultado_escaneo` + columna `motivo`** | Discriminator único ya usado por todo: `validar()` registra con `resultado`, las vistas filtran por `resultado`, `escaneosDe()` lo expone crudo. Requiere redefinir los filtros `<> 'aceptado'` → lista blanca y excluir el pase de `escaneos` (conteo de intentos). |
| B. Columna flag `es_pase`/extender solo `metodo` | Dos fuentes de verdad que pueden discrepar; `aceptados`/`escaneos_ok` incluirían el pase y habría que filtrar por flag en cada vista igual. |

**Elección**: A, más el valor `pase` en `despacho_mega_metodo_captura` (método
honesto: no hubo captura; además excluye al pase de `manuales` sin tocar ese
filtro). Columna `motivo TEXT` nullable. El rechazo por exceso de un pase se
registra con el valor existente `excede_cantidad`. Como los enums se recrean
en `012` (D8), los valores nuevos entran en el `CREATE TYPE`, no vía `ADD VALUE`.

### D2: Endpoint para "pasar sin escanear"

| Opción | Tradeoffs |
|--------|-----------|
| **A. Endpoint nuevo `POST /despachos/:id/pasar`** | El pase es una acción guiada por ítem (`item_id`), sin código ni factor; `validar()` es guiado por código (`resolverCodigo`). Body propio `{ item_id, cantidad, motivo? }`. |
| B. Flag en `validarItemBody` | `codigo` es obligatorio (min 1); el pase no tiene código. Contrato ambiguo. |

**Elección**: A. `pasarSinEscanear(id, { item_id, cantidad, motivo }, usuario)`
reutiliza las reglas internas de `validar()`: guard `en_proceso`,
`asegurarAcceso`, tope `restante` contra `cantidad_solicitada`,
`actualizarItem` + recálculo de `items_validados`. Exceso: escaneo
`excede_cantidad` + evento `ESCANEO_RECHAZADO`. Éxito: escaneo
`{ resultado: 'pasado_sin_escanear', metodo: 'pase', motivo: motivo ?? null,
codigo_ingresado: codigo_item, cantidad }` (columna NOT NULL) y evento nuevo
`item_pase_registrado` (`EVENTO.ITEM_PASE_REGISTRADO`, texto libre).

### D3: `despachador` — catálogo administrado, FK obligatoria

| Opción | Tradeoffs |
|--------|-----------|
| A. Texto libre en `despachos.despachador` | Cero fricción, pero sin normalización: "Carlos", "carlos p", "C. Perez" son tres personas; imposible reportar por despachador. |
| **B. Tabla `despacho_mega_despachadores` + `despachos.despachador_id UUID NOT NULL`** | Una identidad por persona; el admin controla el catálogo; reportes por despachador triviales. Exige CRUD admin y un select en el operario. |

**Elección**: B. Tabla `(id uuid pk, nombre text not null, activo boolean not
null default true, created_at, updated_at)`, índice único
`LOWER(TRIM(nombre))`, trigger `despacho_mega_touch_updated_at`, RLS con
SELECT para `authenticated` (patrón 003/004; escritura solo por backend con
`service_role`). **Baja lógica** (`activo=false`), nunca DELETE: la FK desde
despachos es NOT NULL y un despachador con historial no puede desaparecer.

`despachador_id` es **NOT NULL sin default** porque la tabla se trunca en
`012` (D8): no hay filas que rellenar. En `abrirDespachoBody` viaja como
`uuid.optional()`; `abrir()` lo exige **solo en la rama de creación** (sin
`vigente`) y valida con `despachadorService.exigirActivo(id)` → 404 si no
existe, 400 si `activo=false`. Al reanudar no se pide (spec). El schema no
puede distinguir crear de reanudar: la regla vive en el servicio, igual que
`tipo_documento`.

Nombre resuelto por JOIN: `vw_facturas.despachador` (y `despachador_id`),
`vw_cobertura_dia.despachador`, y en abrir/obtener/detalle vía embed de
PostgREST en `CAMPOS_DESPACHO`
(`despachador:despacho_mega_despachadores!despachador_id (id, nombre, activo)`).

Endpoints: `GET /api/despachadores` (cualquier autenticado; por defecto solo
activos; `?todos=1` solo admin → 403 para otros), `POST /api/despachadores`
(admin), `PATCH /api/despachadores/:id` (admin; `nombre?`, `activo?`).
Duplicado: el servicio recorta y deja que el índice único falle (`23505` →
`409 conflicto`); no se hace pre-check + insert (carrera).

### D4: Alcance de la limpieza de picking — total

Escritura, lectura y cobertura. Consecuencias por camino:

- **`vw_facturas`**: una fila por auditoría, sin pivote ni `FULL OUTER JOIN`.
  Nombres limpios (D9): `despacho_id`, `estado`, `operario_*`,
  `despachador_id`, `despachador`, `finalizado_at`, `minutos`, `avance_pct`,
  `escaneos`, `escaneos_rechazados`, `escaneados`, `pasados_sin_escanear`.
  `etapa ∈ {auditando, aprobada, rechazada, auditada}`.
  `unidades_diferencia`/`tiene_diferencia` conservan la fórmula sobre la
  sesión de auditoría (al abrir contra Siesa, `cantidad_solicitada` es lo
  facturado). `tasa_discrepancia` (facturas.repository) pasa a medir
  auditorías cerradas con faltante frente a lo facturado.
- **Comparativo**: `compararLineas` y su test se eliminan; `detalle()`
  devuelve `{ resumen, auditoria: { despacho, items, escaneos, alertas,
  eventos }, linea_tiempo }` sin `picking` ni `comparativo`.
- **Agregación**: `agruparPorOperario` una fila por operario, sin campo
  `modo`; `serieDiaria` → `{ dia, despachos, items_validados }`;
  `facturasPorDiaSemana` → `{ dia_semana, facturas, dias_con_datos }`;
  `CAMPOS_NOVEDADES` sin `detectadas_en_auditoria`. Las vistas
  `vw_resumen_diario`, `vw_por_operario`, `vw_novedades_inventario` se
  recrean sin columna `modo`; `vw_novedades_por_item` sin
  `detectadas_en_auditoria`.
- **Cobertura**: ver D6.
- **`despacho_origen_id`**: `DROP COLUMN` en `012` (el índice cae con la
  columna); `auditoriaDerivada` desaparece.
- **`requireModo`** (auth.js): eliminar (código muerto). `sincronizarOperario`
  y `operario.service` dejan de enviar `modo_habilitado: "ambos"`: el DB
  default `'auditoria'` cubre el alta.
- **Correo de alerta**: `alerta.service.js` deja de pasar `modo`; `correo.js`
  retira la fila "Proceso".

### D5: `modo` — se elimina del contrato de API

| Opción | Tradeoffs |
|--------|-----------|
| A. `modo: z.enum(["auditoria"])` obligatorio en body y querys | Campo con un solo valor legal: ruido para el cliente, una forma más de obtener 400 y un recordatorio permanente de algo que ya no existe. |
| **B. Eliminar `modo` de `abrirDespachoBody`, `bandejaNovedadesQuery`, `rangoFechasQuery`, `listarDespachosQuery`** | Contrato honesto. Zod descarta claves desconocidas: un cliente que aún mande `modo` no rompe (se ignora, no 400). El único costo es que `modo: "picking"` ya no produce un error explícito: tampoco hace falta, no existe nada que seleccionar. |

**Elección**: B. `export const modo` desaparece del schema. La columna
`despacho_mega_despachos.modo` **se conserva** con enum de un solo valor y
`DEFAULT 'auditoria'`: eliminarla obligaría a reescribir el índice único
`despacho_mega_despachos_factura_modo_idx` y no aporta; el servicio y el
repositorio simplemente no la envían. `despachoVigente(numeroFactura)` pierde
el parámetro `modo`. `actualizarOperarioBody` pierde `modo_habilitado`; la
columna queda en DB con `DEFAULT 'auditoria'` y sigue viajando en respuestas
(siempre `'auditoria'`).

### D6: Cobertura = auditadas

`cubiertas` = facturas cuya auditoría **finalizó** (`finalizado_at IS NOT
NULL`). Una auditoría abierta puede cancelarse: contarla como cubierta
mentiría al cierre del día. CASE de `vw_cobertura_dia`:
`excluida → sin_tocar → auditada → auditando`. `vw_cobertura_resumen` expone
`auditando`, `cubiertas`, `mostrador_cubiertas`, `con_cliente_cubiertas` y
retira `alistando`, `con_picking`, `con_auditoria`, `*_con_picking`.
`cobertura_pct = cubiertas / aplican` (y los dos ángulos mostrador/cliente).
`vw_cobertura_dia` deja de exponer `picking_*`/`auditoria_*`/`picking_hecho`/
`auditoria_hecha` y expone `despacho_id`, `despacho_estado`,
`operario_nombre`, `despachador`, `finalizado_at`.

### D7: Conteos en vistas — `escaneos` pasa a "intentos de escaneo"

`escaneos` = `resultado <> 'pasado_sin_escanear'`; `escaneos_rechazados` /
`rechazados` / `escaneos_con_error` = lista blanca `IN ('no_pertenece',
'item_completo','excede_cantidad','no_encontrado')`; `escaneados` =
`'aceptado'`; `pasados_sin_escanear` = `'pasado_sin_escanear'`. Así
`escaneos = aceptados + rechazados` exacto y `tasa_acierto`
(`aceptados/escaneos`) no se contamina. `ultimo_escaneo_at` sigue siendo MAX
sobre todas las filas: un pase es trabajo. `manuales` no incluye pases porque
su `metodo` es `'pase'`.

### D8: Reset destructivo — por qué es aceptable y por qué no se repite

Todo el dato actual es de prueba (confirmado por el negocio). Eso habilita:

- **TRUNCATE** de `despachos`, `despacho_items`, `escaneos`,
  `alertas_inventario`, `aprobaciones`, `eventos` (`RESTART IDENTITY` para
  los `BIGSERIAL`). **No** se truncan `operarios` (usuarios reales ligados a
  `auth.users`; solo se actualiza `modo_habilitado`), `items` y
  `codigos_barras` (catálogo Siesa, 9 minutos de sincronización) ni
  `facturas_dia` (snapshot irrecuperable: Siesa conserva ~4 días).
- **Recrear enums** en vez de `ADD VALUE`: columna → TEXT (con `DROP
  DEFAULT` previo), `DROP TYPE`, `CREATE TYPE`, cast de vuelta con `USING`,
  restaurar defaults. Exige dropear antes **toda vista que referencie la
  columna** (Postgres rechaza `ALTER COLUMN TYPE` con dependientes): son diez
  (todas menos `vw_productos_top`).
- **`despachador_id NOT NULL` sin default** y **`DROP COLUMN
  despacho_origen_id`**: triviales sobre tabla vacía.
- Una **sola transacción**: sin `ADD VALUE`, nada impide `BEGIN … COMMIT`;
  todo aplica o nada aplica.

Rollback = backup/branch de Supabase. **Este patrón no se reutiliza en
producción con histórico real**: ahí la regla vuelve a ser "solo `ADD
VALUE`, nunca `DROP`", y `CREATE OR REPLACE VIEW` solo agrega columnas al final.

### D9: Nombres limpios en `vw_facturas` y cobertura

El prefijo `auditoria_*` existía para distinguirse de `picking_*`. Sin
picking, y sin frontend que preservar (D10), se renombra:
`auditoria_id → despacho_id`, `auditoria_estado → estado`,
`auditoria_operario_* → operario_*`, `auditoria_finalizado_at →
finalizado_at`, `auditoria_minutos → minutos`, `auditoria_total_items →
total_items`, `auditoria_items_validados → items_validados`,
`auditoria_unidades_* → unidades_*`, `auditoria_escaneos → escaneos`,
`auditoria_escaneos_rechazados → escaneos_rechazados`,
`auditoria_avance_pct → avance_pct`. Consumidores a tocar en el mismo PR:
`facturas.repository` (operario filter, estancadas, indicadores),
`factura.service.detalle` (`resumen.despacho_id`), `vw_cobertura_dia`.

### D10: Despliegue conjunto backend + frontend

El backend nuevo rompe al frontend actual (apertura sin `modo` y con
`despachador_id` obligatorio, renombres de `vw_facturas`, cobertura sin
`alistando`/`con_picking`, detalle sin `comparativo`) y el frontend nuevo no
funciona contra el backend actual (`/despachadores`, `/pasar`). No hay
ventana intermedia válida: se coordina un despliegue conjunto. El contrato
que el frontend debe consumir está en el plan §7.5; su implementación queda
fuera de este repo.

## Data Flow

```
ABRIR (solo auditoria)
  POST /despachos {numero_factura, despachador_id?, tipo_documento?}
    │  schema: sin `modo` (se descarta si llega)
    ├─ vigente? → reanuda (NO pide despachador) → { despacho(con despachador embed), items(orden linea), reanudado:true }
    └─ crear → exigir despachador_id (400) → exigirActivo (404/400)
              → consultarFactura(Siesa) → crearConItems({..., despachador_id}, items)   [modo por DEFAULT de DB]
              → evento despacho_abierto {despachador_id} → { despacho, items, reanudado:false }

PASAR SIN ESCANEAR
  POST /despachos/:id/pasar {item_id, cantidad, motivo?}
    │  guard en_proceso + acceso → item por id (404) → restante = solicitada - validada
    ├─ cantidad > restante → escaneo {resultado:'excede_cantidad'} + evento escaneo_rechazado → {resultado:'excede_cantidad'}
    └─ cabe → actualizarItem(+cantidad, completo/parcial) → items_validados
           → escaneo {resultado:'pasado_sin_escanear', metodo:'pase', motivo, codigo_ingresado: codigo_item}
           → evento item_pase_registrado {motivo} → {resultado:'pasado_sin_escanear', item, despacho, motivo}

DESPACHADORES (catalogo)
  GET  /despachadores[?todos=1]  → listar (activos | todos si admin)
  POST /despachadores {nombre}   → crear (trim; 23505 → 409)
  PATCH /despachadores/:id {nombre?, activo?} → actualizar (baja logica)

LECTURA ADMIN (solo auditoria)
  vw_facturas (una fila por auditoria; JOIN despachadores) ──> panel facturas (despachador, escaneados, pasados_sin_escanear, rechazos sin pases)
  vw_por_operario / vw_resumen_diario / vw_facturas_por_dia_semana (sin modo) ──> analitica (una fila por operario, serie unica)
  vw_calidad_escaneo / vw_picos_trabajo ──> analitica (escaneado vs pasado, rechazos sin pases)
  vw_cobertura_dia (JOIN vw_facturas) / vw_cobertura_resumen ──> cobertura (cubiertas = auditadas)
  escaneosDe(despacho) ──> detalle factura (resultado + motivo por item; sin picking ni comparativo)
```

## File Changes

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `db/migrations/012_auditor_only_reset.sql` | Create | DROP 10 vistas → TRUNCATE 6 tablas → DROP `despacho_origen_id` → 4 enums recreados → tabla despachadores + RLS → `despachador_id`, `motivo` → CREATE 10 vistas (plan §5.3) |
| `src/schemas/despachoMega.schema.js` | Modify | Sin `modo`; `despachador_id` opcional en apertura; `pasarSinEscanearBody`; `crearDespachadorBody`, `actualizarDespachadorBody`, `listarDespachadoresQuery`; `etapaFactura`/`estadoCobertura` sin alistando/alistada; `actualizarOperarioBody` sin `modo_habilitado` |
| `src/services/despacho.service.js` | Modify | `abrir({ numeroFactura, despachadorId, usuario, tipoDocumento })` única; exige despachador en creación; borra `contextoPicking`, `PICKING_AUDITABLE`, `abrirAuditoria`, `abrirAuditoriaSinPicking`; `pasarSinEscanear()`; `validar()` intacto |
| `src/services/despachador.service.js` | Create | `listar`, `crear`, `actualizar`, `exigirActivo` |
| `src/repositories/despachadores.repository.js` | Create | `listar({ soloActivos })`, `porId`, `crear`, `actualizar` sobre `despacho_mega_despachadores` |
| `src/controllers/despachadores.controller.js` | Create | `listar` (403 si `todos` sin admin), `crear`, `actualizar` |
| `src/repositories/despachos.repository.js` | Modify | `CAMPOS_DESPACHO` −`despacho_origen_id` +`despachador_id` + embed despachador; `despachoVigente(numeroFactura)`; `escaneosDe` += `motivo`; `registrarEscaneo` recibe `motivo`; `listar` sin `modo` |
| `src/repositories/facturas.repository.js` | Modify | `.eq("operario_id")`; estancadas `auditando`; indicadores por `finalizado_at`; cabecera sin pivote |
| `src/repositories/analitica.repository.js` | Modify | `resumenDiario`/`porOperario` sin `modo` |
| `src/repositories/alertas.repository.js` | Modify | `bandeja` sin `modo`; embed sin `modo` |
| `src/repositories/eventos.repository.js` | Modify | `ITEM_PASE_REGISTRADO` |
| `src/controllers/despachos.controller.js` | Modify | `abrir` con `despachadorId`, sin `modo`; handler `pasar` |
| `src/routes/index.js` | Modify | `POST /despachos/:id/pasar`; `GET/POST/PATCH /despachadores` |
| `src/middleware/auth.js` | Modify | Eliminar `requireModo`; alta sin `modo_habilitado: "ambos"` |
| `src/lib/correo.js` | Modify | Sin fila "Proceso" |
| `src/services/factura.service.js` | Modify | `detalle()` sin picking/comparativo; `resumen.despacho_id` |
| `src/services/cobertura.service.js` | Modify | `CAMPOS_RESUMEN` sobre `cubiertas`/`auditando`; pcts sobre `cubiertas` |
| `src/services/agregacion.js` | Modify | Sin llave de modo; `pasados_sin_escanear`; sin `detectadas_en_auditoria` |
| `src/services/alerta.service.js`, `src/services/operario.service.js` | Modify | Sin `modo` en correo; sin `modo_habilitado: "ambos"` |
| `src/services/comparativo.js`, `src/services/comparativo.test.js` | Delete | Cruce picking↔auditoría |
| `src/schemas/despachoMega.schema.test.js`, `src/services/despacho.service.test.js`, `src/services/despachador.service.test.js` | Create | Ver Testing Strategy |
| `src/services/agregacion.test.js` | Modify | 16 tests reescritos al contrato sin modo |
| `docs/API.md`, `docs/PENDIENTES.md`, `docs/ESTADO-REPOS.md`, `docs/PENDIENTES-OPERARIO.md` | Modify | Contrato nuevo; despliegue conjunto |

## Interfaces / Contracts

Ver plan maestro §7 (fuente única de los contratos). Resumen:

- `POST /api/despachos` `{ numero_factura, despachador_id?, tipo_documento? }`
  → `201/200 { despacho, items, reanudado }`; `despacho.despachador = { id, nombre, activo }`.
- `POST /api/despachos/:id/pasar` `{ item_id, cantidad, motivo? }` →
  `200 { resultado: 'pasado_sin_escanear' | 'excede_cantidad', ... }`.
- `GET /api/despachadores[?todos=1]`, `POST /api/despachadores { nombre }`,
  `PATCH /api/despachadores/:id { nombre?, activo? }`.
- `GET /api/panel/facturas[/:numero]`, analítica y cobertura con los nombres
  de columnas de D4/D6/D9.

## Testing Strategy

| Capa | Qué se prueba | Enfoque |
|------|---------------|---------|
| Unit (schema) | `despachoMega.schema.test.js` (nuevo): `despachador_id` uuid; `modo` descartado sin error; `pasarSinEscanearBody`; schemas de despachadores; `todos` a booleano; enums sin alistando/alistada | Zod puro: `safeParse` |
| Unit (despachador) | `despachador.service.test.js` (nuevo, `vi.mock` de `despachadores.repository`): crear recorta y rechaza vacío/duplicado; actualizar desactiva sin borrar; inexistente → 404; listar activos/todos; `exigirActivo` 404/400 | Repo mockeado |
| Unit (despacho) | `despacho.service.test.js` (nuevo, `vi.mock` de repositories, `despachador.service` y `facturaSiesa.service`): abrir sin `despachador_id` en creación → 400 y no consulta Siesa; despachador inactivo → rechazado; válido → persiste y viaja; reanudar no lo exige; no envía `modo`; pasar parcial/completo; exceso; motivo/null; línea completa; no `en_proceso` → 409 | Asserts sobre `crearConItems`, `registrarEscaneo`, `actualizarItem` |
| Unit (agregación) | `agregacion.test.js` (reescribir 16): calidad con `pasados_sin_escanear`; mapa de calor; una fila por operario sin `modo`; serie única; sin `facturas_picking`; sin `detectadas_en_auditoria` | Funciones puras |
| Migración | Manual en SQL Editor: correr `012`; re-correr (idempotente); consultas de verificación del plan §5.4; columnas de cada vista contra plan §5.3 | Manual |

## Migration / Rollout

`012_auditor_only_reset.sql`: **destructiva**, una sola transacción, SQL
completo en el plan maestro §5.3. Orden interno:

1. `DROP VIEW IF EXISTS` × 10: `vw_cobertura_resumen`, `vw_cobertura_dia`,
   `vw_facturas` (cadena de dependencia), luego `vw_facturas_por_dia_semana`,
   `vw_resumen_diario`, `vw_por_operario`, `vw_novedades_inventario`,
   `vw_novedades_por_item`, `vw_calidad_escaneo`, `vw_picos_trabajo`
   (independientes). `vw_productos_top` no se toca.
2. `TRUNCATE … RESTART IDENTITY` × 6 tablas.
3. `DROP COLUMN IF EXISTS despacho_origen_id`.
4. Enums: `modo` (`DROP DEFAULT`, → TEXT, DROP/CREATE, ← enum, `SET DEFAULT
   'auditoria'`), `modo_operario` (igual + `UPDATE operarios SET
   modo_habilitado = 'auditoria'` antes del cast), `resultado_escaneo`,
   `metodo_captura`.
5. `despacho_mega_despachadores` + índices + trigger + RLS.
6. `despachador_id UUID NOT NULL REFERENCES` + índice; `motivo TEXT`; comments.
7. `CREATE VIEW` × 10: `vw_facturas` → `vw_cobertura_dia` →
   `vw_cobertura_resumen`, luego el resto.

Rollout: backup/branch de Supabase → correr `012` → verificación §5.4 →
desplegar backend y frontend en la misma ventana (D10).

## Orden de implementación

1. Migración `012` — correr, re-correr, verificar.
2. Schemas + `despachoMega.schema.test.js` (RED→GREEN).
3. Despachadores: repositorio, servicio + test, controlador, rutas.
4. Repositorios: `despachos`, `facturas`, `analitica`, `alertas`, `eventos`.
5. `despacho.service.js` (abrir unificado + `pasarSinEscanear`) + test +
   controller/ruta `pasar`.
6. Limpieza: `comparativo.*` DELETE; `factura.service`, `auth`,
   `operario.service`, `alerta.service`, `correo`, `agregacion` + tests
   reescritos, `cobertura.service`.
7. Docs. Lint NO se toca.

## Open Questions

- Ninguna bloqueante. Decisiones deliberadas ya cerradas:
  - D5: `modo` sale del contrato (no se congela a un enum de un valor).
  - D8: reset destructivo válido solo por datos de prueba; patrón no reutilizable.
  - D9: renombres de `vw_facturas` porque no hay frontend que preservar (D10).
  - `vw_novedades_por_item` pierde `detectadas_en_auditoria` (equivaldría a `reportes`).
