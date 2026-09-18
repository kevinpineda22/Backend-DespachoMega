# SDD Verify Report — auditor-only-workflow

**Change**: auditor-only-workflow
**Version**: 1.0 (spec delta)
**Mode**: Strict TDD (active, vitest runner available)
**Commit verified**: `4e39b5a` (30 files, +2340/−1360) — `git status` clean

## Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 24 |
| Tasks complete | 22 |
| Tasks incomplete | 2 — both `(MANUAL — user)`: `1.2` run 012 in Supabase SQL Editor, `8.1` local smoke. Not executable by the verify agent (no Supabase credentials, destructive migration, smoke needs live server + websocket client). Block rollout/archive until run. |

## Build & Tests Execution

**Build**: ➖ No build step — Node server runs directly (no build script in `package.json`).

**Tests**: ✅ 77 passed / 0 failed / 0 skipped

```text
npm test → vitest run
Test Files  8 passed (8)
Tests       77 passed (77)
Duration    952ms (vitest 3.2.7)
```

Files: `agregacion`, `despachoMega.schema`, `despacho.service`, `despachador.service`, `factura.service`, `cobertura.service`, `alerta.service`, `operario.service` — all `.test.js`. `comparativo.test.js` deleted (confirmed in diff: −253 lines).

**Coverage**: ➖ Not available — no `@vitest/coverage-*` provider, no vitest config (informational, not a failure).

## Spec Compliance Matrix

Compliance rule: a scenario is compliant only when a covering test passed at runtime (source inspection never suffices alone).

### despacho-apertura (5 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Apertura | Create with valid `despachador_id` persists despachador in `crearConItems` and it travels in the response | `despacho.service.test.js > "con despachador valido lo persiste en crearConItems y viaja en la respuesta"` | ✅ COMPLIANT |
| Apertura | Missing `despachador_id` at creation → 400 and Siesa is never consulted | `"sin despachador_id en creacion lanza solicitudInvalida y no consulta Siesa"` | ✅ COMPLIANT |
| Apertura | Nonexistent or inactive despachador → rejected, nothing created | `"con despachador inexistente o inactivo es rechazado y no crea"` | ✅ COMPLIANT |
| Apertura | Resume does not require `despachador_id`; returns stored despachador; ignores a different id | `"reanudar no exige despachador_id y devuelve el despachador guardado"` + `"reanudar ignora un despachador_id distinto al guardado (no lo valida)"` + `"reanudar un despachador cerrado lanza conflicto"` | ✅ COMPLIANT |
| Apertura | Client sends `modo` → discarded, opening continues (NO 400 — Zod strips unknown keys, deliberate D5) | `despachoMega.schema.test.js > "descarta \`modo\` sin fallar"` + `"no exporta el enum \`modo\`"` + `despacho.service.test.js > "no envia \`modo\` ni \`despacho_origen_id\` al repositorio"` | ✅ COMPLIANT |

### escaneo-asistido (5 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Pase | Partial quantity leaves line partial; registers `pasado_sin_escanear` with `metodo: "pase"` | `despacho.service.test.js > "cantidad parcial deja la linea parcial y registra pasado_sin_escanear con metodo pase"` | ✅ COMPLIANT |
| Pase | Quantity completing the line leaves it complete and recalculates `items_validados` | `"cantidad que completa la linea la deja completa y recalcula items_validados"` | ✅ COMPLIANT |
| Pase | Event `item_pase_registrado` recorded with motivo | `"registra el evento item_pase_registrado con el motivo"` | ✅ COMPLIANT |
| Pase | Motivo optional: with motivo persisted, without → null (`codigo_ingresado = codigo_item`) | `"con motivo lo persiste; sin motivo queda null"` + schema `"permite motivo opcional recortado, con maximo 500"` + `"exige item_id uuid y cantidad entera positiva"` | ✅ COMPLIANT |
| Pase | Excess → whole pass rejected as `excede_cantidad`, `cantidad_validada` untouched | `"con exceso rechaza entero con excede_cantidad y no altera cantidad_validada"` + `"sobre una linea completa cae en excede_cantidad"` | ✅ COMPLIANT |
| Pase | Closed despacho / another operator's despacho / unknown despacho-or-item | `"en despacho no en_proceso lanza conflicto"` + `"de otro operario lanza prohibido; el admin si puede"` + `"despacho o item inexistente lanza noEncontrado"` | ✅ COMPLIANT |

### trazabilidad-admin (5 scenarios)

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| Detalle | `{ resumen, auditoria, linea_tiempo }` — no `picking`, no `comparativo`; events have no `etapa` | `factura.service.test.js > "devuelve { resumen, auditoria, linea_tiempo } sin picking ni comparativo"` + `"linea_tiempo son solo los eventos de la auditoria, en orden cronologico y sin etapa"` + `"busca el despacho por resumen.despacho_id, no por picking_id/auditoria_id"` | ✅ COMPLIANT |
| Detalle | `resumen.despachador` travels as the view delivers it; every scan carries `resultado`/`motivo` | `"resumen.despachador viaja tal como lo entrega la vista"` + `"cada escaneo trae resultado y motivo; el pase sin motivo queda en null"` + `"lanza noEncontrado (404) si la factura no tiene despacho"` | ✅ COMPLIANT |
| Cobertura | `cobertura_pct = cubiertas / aplican`; no `alistando`/`con_picking`/`con_auditoria` keys; null not 100 when nothing applies | `cobertura.service.test.js` — 4/4 cases (`"cobertura_pct = cubiertas / aplican (7 de 10 -> 70)"`, `"los angulos mostrador / cliente usan sus propias cubiertas"`, `"no expone claves de picking ni alistando en totales"`, `"sin facturas que apliquen, el porcentaje es null y no 100"`) | ✅ COMPLIANT |
| Analítica | No `modo` anywhere; `pasados_sin_escanear` kept separate from rejections; `serie_diaria { dia, despachos, items_validados }`; one row per operator | `agregacion.test.js` — 21/21 cases (notably `"suma pasados_sin_escanear sin mezclarlos con rechazados..."`, `"no expone claves picking ni auditoria"`, `"no expone facturas_picking ni facturas_auditoria"`, `"no expone detectadas_en_auditoria..."`, `"colapsa a una sola fila por operario, sin campo modo"`) | ✅ COMPLIANT |
| Operarios | `modo_habilitado` only ever `'auditoria'`; service never sends it (DB DEFAULT) and ignores it from the client | `operario.service.test.js` — `"anuncia a los pendientes con modo_habilitado 'auditoria', nunca 'ambos'"` + `"no envia modo_habilitado al crear..."` + `"ignora un modo_habilitado que venga del cliente"` + schema `"actualizarOperarioBody ya no acepta modo_habilitado como unico campo"` | ✅ COMPLIANT |

**Compliance summary**: 15/15 scenarios compliant (77 runtime-passing tests, no untested or failing scenario).

## Correctness (Static Evidence) — master plan §10 checklist

| # | Checklist item | Status | Notes |
|---|----------------|--------|-------|
| 1 | 012 run in Supabase + §5.4 verification queries | ⚠️ PARTIAL | File correct and idempotent by inspection (DROP IF EXISTS / IF NOT EXISTS, TRUNCATE, CREATE); execution pending — MANUAL, needs Supabase access |
| 2 | Zero `picking` residue (`grep -ri picking src db/migrations/012*`) | ✅ Implemented | Only matches: test files asserting its ABSENCE and the migration banner comment. No column/view/enum/route/function/query param named `picking` in code |
| 3 | `POST /despachos` rejects/ignores `modo`; `despachador_id` required at creation (400/404), not at resume | ✅ Implemented | Schema strips `modo`; service-layer 400/404 (D7); resume ignores id |
| 4 | `GET/POST/PATCH /despachadores` with §7.3 codes; no DELETE (logical `activo=false`) | ✅ Implemented | Controller + service + repository; 409 by normalized unique index; 404/400/403 verified by inspection (no HTTP-layer tests — repo convention, see WARNING) |
| 5 | `despachador` (nombre) travels in abrir/obtener/detalle/`vw_facturas`/`vw_cobertura_dia` | ✅ Implemented | `CAMPOS_DESPACHO` embed + JOINs in 012 |
| 6 | `cobertura_pct` computed over `cubiertas`; states `sin_tocar/auditando/auditada/excluida` | ✅ Implemented | Service formula + view + 4 passing tests |
| 7 | `pasado_sin_escanear` partial with optional motivo; excess rejected | ✅ Implemented | 7 passing service tests + 3 schema tests |
| 8 | `vw_calidad_escaneo`/`vw_picos_trabajo`/`vw_facturas` do NOT count pase as rejection; distinguish `escaneados` vs `pasados_sin_escanear` | ✅ Implemented | Whitelist `IN (...)` for `escaneos_rechazados`; `<> 'pasado_sin_escanear'` for `escaneos`. No trazabilidad bug — pase never counted as rejected |
| 9 | `npm test` passes: 16 aggregation tests rewritten, `comparativo.test.js` deleted | ✅ Implemented | 21 tests in `agregacion.test.js`; 77/77 pass; comparativo files deleted (diff: −129/−253) |
| 10 | Docs updated | ✅ Implemented | `API.md` (`/despachadores`, `POST /despachos/:id/pasar`, `pasado_sin_escanear`), `ESTADO-REPOS.md` (§0: joint deploy — CONJUNTO, not backend-first), `PENDIENTES.md` (§7 test count), `PENDIENTES-OPERARIO.md` (§0.2–0.4) |
| 11 | Local smoke (despachador → abrir → pasar → exceso → panel) | ⚠️ PENDING | MANUAL — user, after 012 |

## Coherence (Design)

| Decision | Followed? | Notes |
|----------|-----------|-------|
| D5: `modo` removed from contract; column kept with DEFAULT `'auditoria'`; Zod discards unknown key | ✅ Yes | Deliberate: `modo: "picking"` does NOT 400 — it is discarded and the opening continues (spec requirement) |
| D7: `despachador_id` enforced at service layer only at creation | ✅ Yes | 400/404 at create; ignored at resume |
| Single migration `012` (no `013`); all 10 views recreated inside it with pase exclusion | ✅ Yes | Design never proposed a 013 — the pase exclusion IS in 012. No missing-update bug |
| D8: destructive 012 (TRUNCATE 6 tables, DROP 10 views, recreate 4 enums, DROP `despacho_origen_id`) | ✅ Yes | Matches assumption: current data is test data. ALERT to user: backup/branch before running |
| D9: view column names (`despacho_id`, `estado`, `operario_*`, `finalizado_at`, `minutos`, `avance_pct`, `escaneos`, `escaneos_rechazados`, `escaneados`, `pasados_sin_escanear`, `despachador_id`, `despachador`) | ✅ Yes | Embedded + views |
| Despachadores catalog: lowercase-normalized unique index, logical delete, no DELETE endpoint | ✅ Yes | Repository/service/controller coherent |
| Event `ITEM_PASE_REGISTRADO` added to `EVENTO` enum | ✅ Yes | `eventos.repository.js` |
| `correo.js` without "Proceso" row; `alerta.service.js` no longer passes `modo` | ✅ Yes | 6 data rows; test asserts payload has no `modo` |
| Cobertura/aggregation free of picking/alistando/modo keys | ✅ Yes | Tests + greps |
| New files beyond plan (`despachador.service.js`, `despachadores.repository.js`, `despachadores.controller.js`) | ✅ Yes | Coherent CRUD; justified by design (catalogo de despachadores) |

## Issues Found

**CRITICAL**
1. **No `apply-progress.md` → no "TDD Cycle Evidence" table** (Strict TDD protocol violation). The implementation was produced outside the SDD apply flow, so RED-before-GREEN cannot be proven and the safety-net/triangulation columns are unreported. Mitigation: all 8 test files exist and pass (77/77) and passed the assertion-quality audit. Evidence loss is procedural, not a code defect — but it blocks archive readiness until the orchestrator decides how to treat it.

**WARNING**
1. **Manual tasks pending** (block rollout/archive): `1.2` run 012 in Supabase + §5.4 checks; `8.1` local smoke. Not executable by the verify agent (no Supabase credentials; destructive migration; smoke needs live server).
2. **HTTP-layer rules verified by static inspection only**: `403 solo-admin` on `POST/PATCH /despachadores` and `todos=1`, plus route wiring. No HTTP/integration tests exist in the repo (agreed scope in proposal — unit-layer only).

**SUGGESTION**
1. In 012, `escaneos` (`<> 'pasado_sin_escanear'`) and `escaneos_rechazados` (whitelist `IN`) are two formulas that can drift silently if a future enum value is added via `ADD VALUE`. Consider deriving `escaneos = escaneados + escaneos_rechazados` or adding a comment at the enum.
2. `modo_habilitado` now has no write path (only DEFAULT + read) — dead weight worth pruning in a future enum cleanup. Non-blocking.
3. No coverage tooling (`@vitest/coverage-v8` absent) — adding it would give per-changed-file coverage for future changes. Informational.

## TDD Compliance (Strict module)

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | ❌ | `apply-progress.md` missing — CRITICAL |
| All tasks have tests | ✅ | All implementation tasks covered; 2 MANUAL tasks not applicable |
| RED confirmed (tests exist) | ✅ | 8/8 test files verified on disk |
| GREEN confirmed (tests pass) | ✅ | 77/77 pass on execution |
| Triangulation adequate | ✅ | Multiple cases per behavior (pase ×7, exceso ×2, cobertura ×4, apertura ×5) |
| Safety Net for modified files | ➖ | Not reported (no apply-progress) |

**TDD Compliance**: 3/6 checks passed — evidence loss is procedural; test suite itself is green and high-quality.

## Test Layer Distribution

| Layer | Tests | Files | Tools |
|-------|-------|-------|-------|
| Unit | 77 | 8 | vitest 3.2.7 |
| Integration | 0 | 0 | — (not installed; repo convention) |
| E2E | 0 | 0 | — |
| **Total** | **77** | **8** | |

## Changed File Coverage

Coverage analysis skipped — no coverage tool detected (no vitest config, no `@vitest/coverage-*`). Not a failure.

## Assertion Quality

✅ All assertions verify real behavior — Step 5f audit over all 8 test files: no tautologies, no ghost loops, no smoke-only tests, no type-only-alone assertions, no empty-collection-without-companion cases. Mock/assertion ratio healthy (repositories mocked at service boundary, behavior asserted end-to-end per service).

## Quality Metrics

**Linter**: ➖ Not available — ESLint 9 installed without flat config (`eslint .` cannot run; known issue, out of scope per proposal).
**Type Checker**: ➖ Not applicable — plain JavaScript ESM.

## Verdict

**PASS WITH WARNINGS**

Implementation is functionally complete and spec-conformant: 15/15 scenarios covered by passing runtime tests (77/77), master-plan §10 checklist 9/11 OK with both pending items being MANUAL user steps, zero `picking` residue in code, design decisions D5/D7/D8/D9 followed, and assert quality is high. Blocking items for full completion are procedural, not code: (1) missing TDD evidence artifact (CRITICAL) pending orchestrator decision, (2) manual 012 execution + smoke pending user action. Archive/rollout must wait on those two.