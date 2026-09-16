# Proposal: Auditor-only Workflow

## Intent

Despacho Mega simplifica su operación: **el picking desaparece por completo** y
queda solo el operario Auditor. Hoy un mismo despacho puede abrirse en modo
picking o auditoría, y la auditoría se apoya en un picking previo
(`despacho_origen_id`). El cambio elimina el picking de la escritura, de la
lectura (vistas, filtros, agregación) y de la cobertura, y agrega tres
capacidades al flujo de auditoría: un **catálogo de despachadores**
administrado por el admin (quien despachó se elige al abrir), **pasar
productos sin escanear** (cantidad parcial, motivo opcional) y **trazabilidad
admin** de escaneados vs. pasados sin escanear. La vista del operario gana un
modo "cine" de avance automático (frontend).

Como **todos los datos actuales son de prueba**, la limpieza se hace con una
migración destructiva: se truncan las tablas transaccionales del módulo y los
enums se recrean desde cero, sin valores legados.

## Confirmed Assumptions

1. **Eliminar picking por completo**: sin alta, sin lectura, sin cobertura.
   Desaparecen `comparativo.js`, `contextoPicking`, `PICKING_AUDITABLE`,
   `requireModo`, `despacho_origen_id`, las columnas `picking_*`,
   `facturas_picking`/`facturas_auditoria`, los conteos `con_picking`/
   `*_con_picking`, los estados de cobertura `alistada`/`alistando` y el valor
   `ambos` de `modo_habilitado`.
2. **Datos de prueba → reset destructivo**: la migración `012` trunca
   `despachos`, `despacho_items`, `escaneos`, `alertas_inventario`,
   `aprobaciones` y `eventos`, y recrea `despacho_mega_modo` (`auditoria`),
   `despacho_mega_modo_operario` (`auditoria`), `despacho_mega_resultado_escaneo`
   (+ `pasado_sin_escanear`) y `despacho_mega_metodo_captura` (+ `pase`).
   No se truncan operarios, catálogo Siesa ni `facturas_dia`.
3. **Despachador como catálogo**: tabla `despacho_mega_despachadores` con
   baja lógica; `despachos.despachador_id UUID NOT NULL`. Obligatorio al crear
   la auditoría (existente y activo), no al reanudar. Nombre por JOIN.
4. **Pasar sin escanear**: disponible en modo lista y cine, registra
   **cantidad parcial** y **motivo opcional** (nullable); distinguible del
   escaneo real y respeta "no se despacha más de lo facturado".
5. **Trazabilidad admin**: vistas y detalle distinguen escaneados vs. pasados
   sin escanear (conteos y detalle); el pase no cuenta como rechazo.
6. **Cobertura = auditadas**: `cubiertas` = facturas con auditoría finalizada;
   estados `excluida → sin_tocar → auditada → auditando`; `cobertura_pct =
   cubiertas / aplican`.
7. **`modo` sale del contrato de API**: con un solo modo, el campo se elimina
   del body de apertura y de los querys de lectura. La columna de DB se
   conserva con `DEFAULT 'auditoria'`.
8. **Modo cine**: avance automático es frontend; el backend ya entrega ítems
   ordenados por línea y hereda 3 y 4.
9. **Despliegue conjunto**: el frontend (`Pagina-web_React`) se actualiza y
   despliega junto con el backend, no después.

**Decisiones abiertas**: ninguna.

## Scope

### In Scope
- Migración `012` destructiva: TRUNCATE, enums recreados, `despacho_origen_id`
  eliminada, tabla de despachadores, `despachador_id`, `motivo`, vistas
  redefinidas (todas las que referencian un enum recreado).
- Eliminación total de picking en servicios, repositorios, schemas,
  middleware, agregación, cobertura y correo de alerta.
- Catálogo de despachadores: repositorio, servicio, controlador, schemas,
  rutas `GET/POST/PATCH /api/despachadores`.
- `despachador_id` obligatorio al crear; nombre en abrir/obtener/detalle/
  `vw_facturas`/`vw_cobertura_dia`.
- Resultado `pasado_sin_escanear` + método `pase` + columna `motivo` +
  `POST /despachos/:id/pasar`.
- Exclusión del pase de los conteos de rechazo (lista blanca) en
  `vw_facturas`, `vw_calidad_escaneo` y `vw_picos_trabajo`.
- Trazabilidad admin: `escaneados` / `pasados_sin_escanear` en vistas y detalle.
- Cobertura sobre `cubiertas`.
- Tests: reescribir `agregacion.test.js` (16), eliminar `comparativo.test.js`
  (11), crear tests de schema, `despacho.service` y `despachador.service`.
- Docs: `API.md`, `ESTADO-REPOS.md`, `PENDIENTES.md`, `PENDIENTES-OPERARIO.md`.

### Out of Scope
- Implementación del frontend (se documenta el contrato en el plan §7.5).
- El modo cine en sí.
- Arreglar el lint roto (ESLint 9 sin `eslint.config.js`).
- Tests de integración/e2e (no existen en este repo).
- Catálogo Siesa y snapshot `facturas_dia`: no se tocan.

## Capabilities

> Contrato con sdd-spec. `openspec/specs/` está vacío: todos son nuevos.

### New Capabilities
- `despacho-apertura`: apertura de auditoría en modo único con
  `despachador_id` de catálogo; catálogo de despachadores (listar, crear,
  editar, baja lógica); reset destructivo de datos de prueba.
- `escaneo-asistido`: resultado "pasado sin escanear" (cantidad parcial,
  motivo opcional) y su efecto en validación, finalización y bitácora.
- `trazabilidad-admin`: conteos escaneado vs. pasado-sin-escanear en
  `vw_facturas`, `vw_calidad_escaneo`, `vw_picos_trabajo` y detalle de
  factura; cobertura sobre auditadas.

### Modified Capabilities
None (no existing specs).

## Approach

1. **Migración `012`** (una transacción): DROP de las diez vistas que
   referencian `despachos.modo`, `escaneos.resultado` o `escaneos.metodo`;
   TRUNCATE de las seis tablas transaccionales; DROP de `despacho_origen_id`;
   recreación de los cuatro enums (columna → TEXT, DROP TYPE, CREATE TYPE,
   cast de vuelta, defaults); tabla `despacho_mega_despachadores` con RLS
   (patrón 003); `despachador_id NOT NULL` y `motivo`; CREATE de las vistas
   en orden `vw_facturas → vw_cobertura_dia → vw_cobertura_resumen` y luego el
   resto.
2. **Despachadores**: `despachadores.repository.js`, `despachador.service.js`,
   `despachadores.controller.js`, schemas Zod y rutas.
3. **Servicios**: `despacho.service.js` con una sola apertura contra Siesa que
   exige `despachador_id` en creación y agrega `pasarSinEscanear()`;
   `factura.service.js` sin picking/comparativo; `cobertura.service.js`
   sobre `cubiertas`; `agregacion.js` sin llave de modo; `operario.service.js`
   y `auth.js` sin `modo_habilitado: "ambos"`; `alerta.service.js`/`correo.js`
   sin `modo`.
4. **Schemas**: sin `modo`; `despachador_id`; `pasarSinEscanearBody`;
   schemas de despachadores; enums de etapa/cobertura sin `alistando`/`alistada`.
5. **Tests** (Strict TDD): schema, despachador.service, despacho.service,
   agregación reescrita.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `db/migrations/012_auditor_only_reset.sql` | New | Reset destructivo, enums limpios, despachadores, `despachador_id`, `motivo`, diez vistas recreadas |
| `src/services/despacho.service.js` | Modified | Apertura única con `despachador_id`; sin picking; `pasarSinEscanear()` |
| `src/services/despachador.service.js`, `src/repositories/despachadores.repository.js`, `src/controllers/despachadores.controller.js` | New | Catálogo de despachadores |
| `src/services/factura.service.js`, `cobertura.service.js`, `agregacion.js`, `operario.service.js`, `alerta.service.js` | Modified | Sin picking/comparativo; cobertura sobre `cubiertas`; agregación sin modo |
| `src/services/comparativo.js`, `comparativo.test.js` | Deleted | Cruce picking↔auditoría |
| `src/schemas/despachoMega.schema.js` | Modified | Sin `modo`; `despachador_id`; `pasarSinEscanearBody`; schemas de despachadores; enums sin alistando/alistada |
| `src/middleware/auth.js`, `src/lib/correo.js` | Modified | Sin `requireModo`; sin `modo_habilitado: "ambos"`; sin fila "Proceso" |
| `src/repositories/despachos.repository.js`, `facturas.repository.js`, `analitica.repository.js`, `alertas.repository.js`, `eventos.repository.js` | Modified | `despachador_id` + embed; sin `despacho_origen_id`; renombres de `vw_facturas`; sin filtro `modo`; `motivo`; evento nuevo |
| `src/controllers/despachos.controller.js`, `src/routes/index.js` | Modified | `despachador_id`; `pasar`; rutas de despachadores |
| `src/services/agregacion.test.js` (16) | Modified | Contrato sin modo; `pasados_sin_escanear` |
| `docs/API.md`, `docs/ESTADO-REPOS.md`, `docs/PENDIENTES.md`, `docs/PENDIENTES-OPERARIO.md` | Modified | Contrato nuevo; despliegue conjunto |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Migración destructiva ejecutada sobre datos reales | Low (confirmado: datos de prueba) | Banner de advertencia; backup/branch de Supabase antes; confirmación explícita del negocio |
| Patrón DROP TYPE reutilizado en el futuro con histórico | Med | Documentado en el plan §9.1: solo válido con datos descartables; en prod, solo `ADD VALUE` |
| `ALTER COLUMN TYPE` falla por vistas dependientes | Med | `012` dropea explícitamente las diez vistas que referencian los enums; orden verificado (resumen → dia → facturas; resto independiente) |
| Renombres de `vw_facturas` rompen consumidores | High | Mapa de renombres en el plan §5.3.1; `facturas.repository`, `factura.service` y `vw_cobertura_dia` se cambian en el mismo PR |
| "Pasado sin escanear" inflaría rechazos si no se excluye | High | Lista blanca explícita en `vw_facturas`, `vw_calidad_escaneo`, `vw_picos_trabajo` |
| Frontend actual incompatible con backend nuevo (y viceversa) | High | Despliegue conjunto coordinado; contrato en plan §7.5; `ESTADO-REPOS.md` |
| Nombre duplicado de despachador (carrera) | Low | Índice único `LOWER(TRIM(nombre))`; el servicio traduce `23505` a 409 |
| Tests existentes asumen dos modos | Med | Reescribir los 16 de agregación en el mismo cambio; eliminar los 11 de comparativo |
| Lint roto (ESLint 9 sin config) | Low | No tocar; verificar con `npm test` |

## Rollback Plan

- **No hay rollback por SQL** de `012`: restaurar el backup/branch de
  Supabase tomado antes de correrla.
- El código puede revertirse por git, pero solo es coherente con la DB previa
  si también se restauró el backup.
- Si la implementación se atasca, dividir en PRs sobre la misma migración:
  (1) despachadores, (2) apertura única + limpieza de picking, (3) pase sin
  escanear + trazabilidad.

## Dependencies

- Frontend `Pagina-web_React`: despliegue conjunto (select de despachador,
  CRUD admin de despachadores, botón "pasar", retiro de UI de picking).
- Supabase SQL Editor para correr `012` (una sola transacción).
- Backup/branch de Supabase previo a `012`.

## Success Criteria

- [ ] `012` corrió; enums con solo los valores vigentes; tablas
      transaccionales vacías; operarios, catálogo y `facturas_dia` intactos.
- [ ] Ninguna columna, vista, enum, schema, ruta ni función menciona picking.
- [ ] `POST /api/despachos` no acepta `modo`; exige `despachador_id` activo al
      crear (400/404) y no al reanudar.
- [ ] `GET/POST/PATCH /api/despachadores` operan con baja lógica; sin DELETE.
- [ ] `despachador` viaja en abrir/obtener/detalle/`vw_facturas`/`vw_cobertura_dia`.
- [ ] `cobertura_pct` = `cubiertas / aplican`; estados
      `sin_tocar / auditando / auditada / excluida`.
- [ ] Existe `pasado_sin_escanear` con cantidad parcial y motivo opcional;
      cualquier exceso sobre lo facturado se rechaza.
- [ ] `vw_calidad_escaneo`/`vw_picos_trabajo`/`vw_facturas` no cuentan el pase
      como rechazo y distinguen escaneados vs. pasados.
- [ ] `npm test` pasa con agregación reescrita + tests nuevos.
- [ ] Docs actualizadas; `ESTADO-REPOS.md` indica despliegue conjunto.
