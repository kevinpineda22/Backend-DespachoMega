# Tasks: Auditor-only Workflow

> Derived from `docs/PLAN-AUDITOR-ONLY-WORKFLOW.md` §4 / §6 / §8 (the plan is the
> source of truth). Strict TDD: test first (RED -> GREEN) per file.
> Verification command: `npm test`. Lint is broken and out of scope.

## Review Workload Forecast

- Decision needed before apply: Yes
- Chained PRs recommended: Yes
- 400-line budget risk: High
- Resolved delivery: single writer, two batches (A = Fases 1-4, B = Fases 5-7), no commits by the executor.

## Batch A

### Phase 1: Migration

- [x] 1.1 Create `db/migrations/012_auditor_only_reset.sql` (destructive banner, single transaction, DROP 10 views, TRUNCATE 6 tables, DROP `despacho_origen_id`, recreate 4 enums, `despacho_mega_despachadores` + RLS, `despachador_id` NOT NULL FK, `escaneos.motivo`, CREATE 10 views, verification queries as comments)
- [ ] 1.2 Run 012 in Supabase SQL Editor, re-run for idempotence, execute §5.4 checks (MANUAL — user)

### Phase 2: Schemas

- [x] 2.1 `src/schemas/despachoMega.schema.test.js` (RED)
- [x] 2.2 `src/schemas/despachoMega.schema.js`: remove `modo` export and fields, `despachador_id` optional uuid, `pasarSinEscanearBody`, `crearDespachadorBody`, `actualizarDespachadorBody`, `listarDespachadoresQuery`, `etapaFactura`/`estadoCobertura` without alistando/alistada, `actualizarOperarioBody` without `modo_habilitado` (GREEN)

### Phase 3: Repositories

- [x] 3.1 `despachos.repository.js`: `CAMPOS_DESPACHO` (-`despacho_origen_id`, -`modo`, +`despachador_id`, +despachador embed), `despachoVigente(numeroFactura)`, `escaneosDe` += `motivo`, `registrarEscaneo` returns `motivo`, `listar` without `modo`
- [x] 3.2 NEW `despachadores.repository.js` (`listar`, `porId`, `crear`, `actualizar`)
- [x] 3.3 `facturas.repository.js`: `.eq("operario_id")`, estancadas `auditando`, indicadores by `finalizado_at`, header without pivot
- [x] 3.4 `eventos.repository.js`: `ITEM_PASE_REGISTRADO`

### Phase 4: Services, controllers, routes

- [x] 4.1 `src/services/despachador.service.test.js` (RED) + `despachador.service.js` (`listar`, `crear`, `actualizar`, `exigirActivo`) (GREEN)
- [x] 4.2 `src/services/despacho.service.test.js` (RED) + `despacho.service.js`: single `abrir()` against Siesa with `despachador_id` required on creation only; removed `contextoPicking`, `PICKING_AUDITABLE`, `abrirAuditoria`, `abrirAuditoriaSinPicking`; `obtener` without `picking`; NEW `pasarSinEscanear()`; `validar()` intact (GREEN)
- [x] 4.3 NEW `src/controllers/despachadores.controller.js` (`listar` with 403 on `todos` for non-admin, `crear`, `actualizar`)
- [x] 4.4 `src/controllers/despachos.controller.js`: `abrir` passes `despachadorId`, no `modo`; handler `pasar`
- [x] 4.5 `src/routes/index.js`: `POST /despachos/:id/pasar`; `GET /despachadores` (requireAuth), `POST /despachadores` (requireAdmin), `PATCH /despachadores/:id` (requireAdmin)

## Batch B (done — remaining items are manual)

### Phase 5: Remaining repositories

- [x] 5.1 `analitica.repository.js`: `resumenDiario`/`porOperario` without `modo`
- [x] 5.2 `alertas.repository.js`: `bandeja` without `modo` filter; embed without `modo`

### Phase 6: Cleanup

- [x] 6.1 DELETE `src/services/comparativo.js` and `comparativo.test.js`
- [x] 6.2 `factura.service.js`: `detalle()` without picking/comparativo; `resumen.despacho_id`; `{ resumen, auditoria: {...}, linea_tiempo }`
- [x] 6.3 `middleware/auth.js`: remove `requireModo`; `sincronizarOperario` without `modo_habilitado: "ambos"`
- [x] 6.4 `operario.service.js`: no `modo_habilitado: "ambos"` in `pendientes`/`provisionar`
- [x] 6.5 `alerta.service.js` + `lib/correo.js`: no `modo` / "Proceso" row
- [x] 6.6 `agregacion.js` + rewrite `agregacion.test.js` (16): one row per operario, `serieDiaria` `{ dia, despachos, items_validados }`, `facturasPorDiaSemana` `{ dia_semana, facturas, dias_con_datos }`, `CAMPOS_CALIDAD` += `pasados_sin_escanear`, `mapaDeCalor` accumulates `pasados_sin_escanear`, `CAMPOS_NOVEDADES` -= `detectadas_en_auditoria`
- [x] 6.7 `cobertura.service.js`: `CAMPOS_RESUMEN` on `cubiertas`/`auditando`; pcts on `cubiertas`

### Phase 7: Docs

- [x] 7.1 `docs/API.md`, `docs/ESTADO-REPOS.md` (joint deploy), `docs/PENDIENTES.md`, `docs/PENDIENTES-OPERARIO.md`

### Phase 8: Smoke

- [ ] 8.1 `npm run dev`: create despachador, open with `despachador_id`, pass without scanning, excess rejected, `GET /panel/facturas` shows `despachador` (MANUAL — user, after 012)
