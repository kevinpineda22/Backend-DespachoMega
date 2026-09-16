# Plan Maestro de Implementación — Auditor-only Workflow

> **Documento generado a partir de los artefactos SDD de `openspec/changes/auditor-only-workflow/`**
> (proposal.md, specs/despacho-apertura, specs/escaneo-asistido, specs/trazabilidad-admin, design.md).
> Si la implementación se desvía de algo acá, actualizá también esos artefactos.

**Repo:** `Backend-DespachoMega` (Node 20+ ESM / Express 4 / Supabase PG 15 / Zod / Vitest)
**Comando de verificación:** `npm test` (vitest — 27 tests hoy: 16 en `agregacion.test.js` + 11 en `comparativo.test.js`). El lint está ROTO (ESLint 9 sin `eslint.config.js`): NO tocarlo.
**Modo SDD:** Strict TDD activo — test primero (RED→GREEN).

---

## 1. Resumen ejecutivo

El módulo Despacho Mega pasa a **solo auditoría**: el picking desaparece por completo,
en **escritura y lectura**, incluida la cobertura. No queda ninguna rama, vista, columna,
filtro ni valor de enum que hable de picking.

Como **todos los datos actuales son de prueba**, la migración `012` es **DESTRUCTIVA**:
trunca las tablas transaccionales del módulo, recrea los enums desde cero y redefine todas
las vistas afectadas. No hay histórico que preservar ni compatibilidad hacia atrás que sostener.

Se agregan tres capacidades al flujo de auditoría:

1. **Despachadores como catálogo** — tabla `despacho_mega_despachadores` administrada por el
   admin (alta, edición, baja lógica). Abrir una auditoría exige `despachador_id` de un
   despachador activo; el nombre se resuelve por JOIN en vistas y detalle.
2. **Pasar sin escanear** — nuevo resultado de escaneo (`pasado_sin_escanear`) con cantidad
   parcial y motivo opcional, disponible en modo lista y modo cine.
3. **Trazabilidad admin** — vistas y detalle distinguen **escaneados vs. pasados sin escanear**.

El modo "cine" (avance automático) es frontend (repo `Pagina-web_React`); el backend solo
entrega ítems ordenados por línea (ya lo hace) y hereda 1 y 2.

**El frontend se despliega JUNTO con el backend**, no después: el contrato de apertura,
las columnas de vistas y los conteos de cobertura cambian de forma incompatible (ver §9.8).

---

## 2. Decisiones de negocio confirmadas (fuente de verdad)

| # | Decisión | Detalle |
|---|----------|---------|
| 1 | Picking eliminado por completo | Sin alta, sin lectura, sin cobertura. Se retiran: rama picking de `abrir()`, `contextoPicking`, `PICKING_AUDITABLE`, `abrirAuditoria`/`abrirAuditoriaSinPicking` (se fusionan), `comparativo.js`, `requireModo`, columna `despacho_origen_id`, columnas `picking_*` y `facturas_picking`/`facturas_auditoria`, conteos `con_picking`/`mostrador_con_picking`/`con_cliente_con_picking`, estados de cobertura `alistada`/`alistando`, valor `ambos` de `modo_habilitado`. |
| 2 | Datos de prueba → reset destructivo | La migración `012` **trunca** las tablas transaccionales y **recrea** los enums con solo los valores vigentes. Rollback = restaurar un backup/branch de Supabase; no hay camino de vuelta por SQL. Este patrón vale **solo porque los datos son descartables**. |
| 3 | `despachador` es catálogo | Tabla `despacho_mega_despachadores` (`id`, `nombre`, `activo`, timestamps), único por `lower(trim(nombre))`. `despachos.despachador_id UUID NOT NULL` (FK). Baja lógica (`activo=false`), nunca DELETE físico. `despachador_id` es obligatorio **solo al crear**, no al reanudar; debe existir y estar activo (404 / 400). |
| 4 | Pasar sin escanear | Disponible en **modo lista y modo cine**. Registra **cantidad parcial** (entera positiva en unidades base). **Motivo opcional** (nullable, máx 500). Respeta "no se despacha más de lo facturado". |
| 5 | Trazabilidad admin | Vistas y detalle distinguen **escaneados vs. pasados sin escanear** (conteos + detalle por ítem con motivo). El pase NO cuenta como rechazo ni como error de escaneo. |
| 6 | Cobertura = auditadas | `cubiertas` = facturas con auditoría **finalizada**. Estados de cobertura: `excluida → sin_tocar → auditada → auditando`. `cobertura_pct` = `cubiertas / aplican`. |
| 7 | `modo` sale del contrato de API | Con un único modo, el campo `modo` **se elimina** del body de apertura y de todos los querys de lectura (ver D5 en design.md). La columna `despacho_mega_despachos.modo` se conserva con enum de un solo valor y `DEFAULT 'auditoria'`: el servicio no la envía. |
| 8 | Modo cine | Avance automático es frontend. El backend ya entrega ítems ordenados por línea; solo hereda 3 y 4. |

**Decisiones abiertas:** ninguna.

---

## 3. Alcance

### In scope
- Migración `012` destructiva: TRUNCATE, enums recreados, `despacho_origen_id` eliminada, tabla de despachadores, `despachador_id`, `motivo`, todas las vistas afectadas redefinidas.
- Eliminación total de picking en servicios, repositorios, schemas, middleware, agregación y cobertura.
- Catálogo de despachadores: repositorio, servicio, controlador, schemas, rutas `GET/POST/PATCH /api/despachadores`.
- `despachador_id` obligatorio al crear una auditoría; nombre por JOIN en `vw_facturas`, `vw_cobertura_dia` y detalle.
- Resultado `pasado_sin_escanear` + método `pase` + columna `motivo` + endpoint `POST /despachos/:id/pasar`.
- Exclusión del pase de los conteos de rechazo (lista blanca) en `vw_facturas`, `vw_calidad_escaneo` y `vw_picos_trabajo`.
- Trazabilidad admin: `escaneados` / `pasados_sin_escanear` en vistas y detalle.
- Cobertura sobre `cubiertas` (= auditadas).
- Reescribir los 16 tests de `agregacion.test.js`, eliminar los 11 de `comparativo.test.js`, agregar tests nuevos (schema, despacho.service, despachador.service).
- Actualizar docs: `API.md`, `PENDIENTES.md`, `ESTADO-REPOS.md`, `PENDIENTES-OPERARIO.md`.

### Out of scope
- La implementación del frontend (repo `Pagina-web_React`). Se documenta el contrato que debe consumir (§7.5), no se implementa acá.
- El modo cine en sí.
- Arreglar el lint roto.
- Tests de integración/e2e (no existen en este repo).
- Sincronización del catálogo Siesa (`despacho_mega_items`, `despacho_mega_codigos_barras`) y el snapshot `despacho_mega_facturas_dia`: no se tocan.

---

## 4. Orden de implementación

> Cada fase termina con su verificación. NO avanzar a la siguiente si la anterior falla.

| Fase | Qué incluye | Cómo verificar |
|------|-------------|----------------|
| 1 | Migración `012` (SQL, destructiva, una sola transacción) | Correr en Supabase SQL Editor; re-correr para idempotencia; ejecutar las consultas de verificación de §5.4 |
| 2 | Schemas Zod + `despachoMega.schema.test.js` | `npm test` (nuevo test RED→GREEN) |
| 3 | Despachadores: `despachadores.repository.js`, `despachador.service.js` + `despachador.service.test.js`, `despachadores.controller.js`, rutas | `npm test` |
| 4 | Repositorios (`despachos`, `facturas`, `eventos`, `analitica`, `alertas`) | `npm test` |
| 5 | `despacho.service.js` (abrir unificado con `despachador_id` + `pasarSinEscanear`) + `despacho.service.test.js` + controller/ruta `pasar` | `npm test` |
| 6 | Limpieza: DELETE `comparativo.js`/`comparativo.test.js`; `factura.service.js`, `auth.js`, `operario.service.js`, `alerta.service.js`, `correo.js`, `agregacion.js`+tests, `cobertura.service.js` | `npm test` |
| 7 | Docs: API.md, ESTADO-REPOS.md, PENDIENTES.md, PENDIENTES-OPERARIO.md | Revisión de contenido |
| 8 | Smoke local `npm run dev`: crear despachador, abrir con `despachador_id`, pasar sin escanear, exceso rechazado, `GET /panel/facturas` con `despachador` | Manual |

---

## 5. Migración SQL

### 5.1 — Advertencia

> ⚠ **`012` ES DESTRUCTIVA.** Borra TODOS los despachos, ítems, escaneos, alertas,
> aprobaciones y eventos del módulo, y recrea cuatro enums desde cero. Solo se
> ejecuta porque el negocio confirmó que **todo lo que hay hoy es dato de prueba**.
> Antes de correrla: tomar un backup o branch de Supabase. No existe rollback por SQL.
> **Nunca reutilizar este patrón sobre una base con histórico real.**

### 5.2 — Qué se trunca y qué no

| Tabla | Acción | Por qué |
|-------|--------|---------|
| `despacho_mega_despachos` | TRUNCATE | Datos por despacho (prueba). Sin filas, recrear `despacho_mega_modo` y agregar `despachador_id NOT NULL` es trivial. |
| `despacho_mega_despacho_items` | TRUNCATE | Depende de despachos. |
| `despacho_mega_escaneos` | TRUNCATE | Depende de despachos; permite recrear `resultado_escaneo` y `metodo_captura` sin casts sobre datos. `RESTART IDENTITY` reinicia el `BIGSERIAL`. |
| `despacho_mega_alertas_inventario` | TRUNCATE | Depende de despachos (FK `ON DELETE CASCADE`); alertas de despachos de prueba. |
| `despacho_mega_aprobaciones` | TRUNCATE | Depende de despachos. |
| `despacho_mega_eventos` | TRUNCATE | Bitácora de despachos de prueba (`despacho_id` FK). Incluye eventos sin despacho (altas de operarios): se aceptan como descartables. `RESTART IDENTITY`. |
| `despacho_mega_operarios` | **NO** | Son los usuarios habilitados (vinculados a `auth.users`). Solo se actualiza `modo_habilitado` a `'auditoria'`. |
| `despacho_mega_items`, `despacho_mega_codigos_barras` | **NO** | Catálogo de Siesa (~33.000 registros, 9 minutos de sincronización). No tiene nada de picking. |
| `despacho_mega_facturas_dia` | **NO** | Snapshot de lo facturado en Siesa. Siesa solo conserva ~4 días: borrarlo sería una pérdida irreversible, y no contiene nada de picking. |

### 5.3 — `db/migrations/012_auditor_only_reset.sql` (NUEVA)

Una **sola transacción**: no hay `ALTER TYPE ... ADD VALUE` (que es lo único que no puede
correr dentro de una transacción); los enums se recrean, así que todo aplica o nada aplica.

**Orden obligatorio:** vistas → truncate → columna origen → enums → despachadores → columnas nuevas → vistas.
Recrear un enum en PostgreSQL exige: (1) dropear toda vista que referencie una columna de ese
tipo, (2) `DROP DEFAULT` y `ALTER COLUMN ... TYPE TEXT`, (3) `DROP TYPE`, (4) `CREATE TYPE`,
(5) `ALTER COLUMN ... TYPE <enum> USING`, (6) restaurar defaults, (7) recrear vistas.

```sql
-- ===========================================================================
-- 012 — Auditor-only: reset destructivo, enums limpios, despachadores, pases
-- ===========================================================================
-- !!! DESTRUCTIVA !!!
-- Trunca todas las tablas transaccionales del modulo y recrea cuatro enums.
-- Solo es aceptable porque TODO el dato actual es de prueba (confirmado por el
-- negocio). Tomar backup/branch antes. No hay rollback por SQL.
-- NUNCA reutilizar este patron en una base con historico real.
--
-- Idempotente: se puede volver a correr completa; la segunda pasada deja el
-- mismo estado (y vuelve a truncar).
-- ===========================================================================
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Vistas. Se eliminan TODAS las que referencian columnas cuyo enum se
--    recrea (despachos.modo, escaneos.resultado, escaneos.metodo). Postgres
--    no permite ALTER COLUMN TYPE sobre una columna usada por una vista.
--    Orden: dependientes primero (resumen -> dia -> facturas); las otras siete
--    son independientes entre si.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.despacho_mega_vw_cobertura_resumen;
DROP VIEW IF EXISTS public.despacho_mega_vw_cobertura_dia;
DROP VIEW IF EXISTS public.despacho_mega_vw_facturas;
DROP VIEW IF EXISTS public.despacho_mega_vw_facturas_por_dia_semana;
DROP VIEW IF EXISTS public.despacho_mega_vw_resumen_diario;
DROP VIEW IF EXISTS public.despacho_mega_vw_por_operario;
DROP VIEW IF EXISTS public.despacho_mega_vw_novedades_inventario;
DROP VIEW IF EXISTS public.despacho_mega_vw_novedades_por_item;
DROP VIEW IF EXISTS public.despacho_mega_vw_calidad_escaneo;
DROP VIEW IF EXISTS public.despacho_mega_vw_picos_trabajo;
-- despacho_mega_vw_productos_top NO se toca: no referencia ningun enum recreado.

-- ---------------------------------------------------------------------------
-- 2. Datos de prueba. Ver docs/PLAN-AUDITOR-ONLY-WORKFLOW.md §5.2.
--    NO se truncan: operarios, items, codigos_barras, facturas_dia.
-- ---------------------------------------------------------------------------
TRUNCATE TABLE
  public.despacho_mega_eventos,
  public.despacho_mega_aprobaciones,
  public.despacho_mega_alertas_inventario,
  public.despacho_mega_escaneos,
  public.despacho_mega_despacho_items,
  public.despacho_mega_despachos
RESTART IDENTITY;

-- ---------------------------------------------------------------------------
-- 3. La auditoria ya no apunta a un picking (005). El indice
--    despacho_mega_despachos_origen_idx cae solo con la columna.
-- ---------------------------------------------------------------------------
ALTER TABLE public.despacho_mega_despachos
  DROP COLUMN IF EXISTS despacho_origen_id;

-- ---------------------------------------------------------------------------
-- 4. Enums recreados desde cero.
-- ---------------------------------------------------------------------------
-- 4a. despacho_mega_modo: solo 'auditoria'. La columna se conserva con
--     DEFAULT para que el servicio no tenga que enviarla.
ALTER TABLE public.despacho_mega_despachos
  ALTER COLUMN modo DROP DEFAULT,
  ALTER COLUMN modo TYPE TEXT USING modo::TEXT;
DROP TYPE IF EXISTS public.despacho_mega_modo;
CREATE TYPE public.despacho_mega_modo AS ENUM ('auditoria');
ALTER TABLE public.despacho_mega_despachos
  ALTER COLUMN modo TYPE public.despacho_mega_modo
    USING modo::public.despacho_mega_modo,
  ALTER COLUMN modo SET DEFAULT 'auditoria';

-- 4b. despacho_mega_modo_operario: solo 'auditoria'. operarios NO se trunca,
--     por eso el UPDATE antes de volver a castear.
ALTER TABLE public.despacho_mega_operarios
  ALTER COLUMN modo_habilitado DROP DEFAULT,
  ALTER COLUMN modo_habilitado TYPE TEXT USING modo_habilitado::TEXT;
UPDATE public.despacho_mega_operarios SET modo_habilitado = 'auditoria';
DROP TYPE IF EXISTS public.despacho_mega_modo_operario;
CREATE TYPE public.despacho_mega_modo_operario AS ENUM ('auditoria');
ALTER TABLE public.despacho_mega_operarios
  ALTER COLUMN modo_habilitado TYPE public.despacho_mega_modo_operario
    USING modo_habilitado::public.despacho_mega_modo_operario,
  ALTER COLUMN modo_habilitado SET DEFAULT 'auditoria';

-- 4c. despacho_mega_resultado_escaneo + 'pasado_sin_escanear'.
ALTER TABLE public.despacho_mega_escaneos
  ALTER COLUMN resultado TYPE TEXT USING resultado::TEXT;
DROP TYPE IF EXISTS public.despacho_mega_resultado_escaneo;
CREATE TYPE public.despacho_mega_resultado_escaneo AS ENUM (
  'aceptado',
  'no_pertenece',
  'item_completo',
  'excede_cantidad',
  'no_encontrado',
  'pasado_sin_escanear'   -- el auditor lo paso sin leer codigo (no es rechazo)
);
ALTER TABLE public.despacho_mega_escaneos
  ALTER COLUMN resultado TYPE public.despacho_mega_resultado_escaneo
    USING resultado::public.despacho_mega_resultado_escaneo;

-- 4d. despacho_mega_metodo_captura + 'pase'.
ALTER TABLE public.despacho_mega_escaneos
  ALTER COLUMN metodo TYPE TEXT USING metodo::TEXT;
DROP TYPE IF EXISTS public.despacho_mega_metodo_captura;
CREATE TYPE public.despacho_mega_metodo_captura AS ENUM ('escaner', 'manual', 'pase');
ALTER TABLE public.despacho_mega_escaneos
  ALTER COLUMN metodo TYPE public.despacho_mega_metodo_captura
    USING metodo::public.despacho_mega_metodo_captura;

-- ---------------------------------------------------------------------------
-- 5. Catalogo de despachadores. Baja logica: nunca DELETE (despachos.despachador_id
--    es NOT NULL y apunta aca).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.despacho_mega_despachadores (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre     TEXT NOT NULL,
  activo     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS despacho_mega_despachadores_nombre_idx
  ON public.despacho_mega_despachadores (LOWER(TRIM(nombre)));

CREATE INDEX IF NOT EXISTS despacho_mega_despachadores_activo_idx
  ON public.despacho_mega_despachadores (activo) WHERE activo = TRUE;

DROP TRIGGER IF EXISTS despacho_mega_despachadores_touch ON public.despacho_mega_despachadores;
CREATE TRIGGER despacho_mega_despachadores_touch
  BEFORE UPDATE ON public.despacho_mega_despachadores
  FOR EACH ROW EXECUTE FUNCTION despacho_mega_touch_updated_at();

-- RLS, mismo modelo que 003: SELECT para autenticados, escritura solo por el
-- backend con service_role (sin politica = denegado).
ALTER TABLE public.despacho_mega_despachadores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS despacho_mega_despachadores_select ON public.despacho_mega_despachadores;
CREATE POLICY despacho_mega_despachadores_select
  ON public.despacho_mega_despachadores FOR SELECT TO authenticated
  USING (TRUE);

COMMENT ON TABLE public.despacho_mega_despachadores IS
  'Catalogo de despachadores (quien entrega fisicamente). Baja logica con activo=false; nunca DELETE.';

-- ---------------------------------------------------------------------------
-- 6. Columnas nuevas.
-- ---------------------------------------------------------------------------
-- NOT NULL sin default: la tabla esta vacia, asi que no hace falta backfill.
ALTER TABLE public.despacho_mega_despachos
  ADD COLUMN IF NOT EXISTS despachador_id UUID NOT NULL
    REFERENCES public.despacho_mega_despachadores(id);

CREATE INDEX IF NOT EXISTS despacho_mega_despachos_despachador_idx
  ON public.despacho_mega_despachos (despachador_id);

COMMENT ON COLUMN public.despacho_mega_despachos.despachador_id IS
  'Despachador elegido al abrir la auditoria. Obligatorio; no se pide al reanudar.';

-- motivo: solo aplica a resultado 'pasado_sin_escanear'.
ALTER TABLE public.despacho_mega_escaneos
  ADD COLUMN IF NOT EXISTS motivo TEXT;

COMMENT ON COLUMN public.despacho_mega_escaneos.motivo IS
  'Motivo opcional de un pase sin escanear (resultado = pasado_sin_escanear). NULL en el resto.';

COMMENT ON TABLE public.despacho_mega_despachos IS
  'Sesion de auditoria sobre una factura de Siesa.';

-- ---------------------------------------------------------------------------
-- 7. Vistas. Orden de creacion: vw_facturas -> cobertura_dia -> cobertura_resumen;
--    el resto en cualquier orden. (Definiciones completas en §5.3.1 a §5.3.10.)
-- ---------------------------------------------------------------------------
-- ... CREATE VIEW x10 ...

COMMIT;
```

#### 5.3.1 — `despacho_mega_vw_facturas` (reemplaza 006; sin pivote, una fila por auditoría)

Nombres limpios: el prefijo `auditoria_*` existía solo para distinguirse de `picking_*`.
Mapa de renombres para quien consume la vista: `auditoria_id → despacho_id`,
`auditoria_estado → estado`, `auditoria_operario_* → operario_*`,
`auditoria_finalizado_at → finalizado_at`, `auditoria_minutos → minutos`,
`auditoria_total_items → total_items`, `auditoria_items_validados → items_validados`,
`auditoria_unidades_* → unidades_*`, `auditoria_escaneos → escaneos`,
`auditoria_escaneos_rechazados → escaneos_rechazados`, `auditoria_avance_pct → avance_pct`.
Todo `picking_*` desaparece.

```sql
CREATE VIEW public.despacho_mega_vw_facturas
WITH (security_invoker = on) AS
WITH avance AS (
  SELECT
    despacho_id,
    SUM(cantidad_solicitada)                         AS unidades_solicitadas,
    SUM(cantidad_validada)                           AS unidades_validadas,
    COUNT(*)                                         AS lineas,
    COUNT(*) FILTER (WHERE estado_item = 'faltante') AS lineas_faltantes,
    COUNT(*) FILTER (WHERE estado_item = 'parcial')  AS lineas_parciales
  FROM public.despacho_mega_despacho_items
  GROUP BY 1
),
-- escaneos = intentos reales (excluye pases); rechazados = lista blanca.
-- ultimo_escaneo_at es MAX sobre TODAS las filas: un pase tambien es trabajo.
actividad AS (
  SELECT
    despacho_id,
    MAX(created_at)                                                  AS ultimo_escaneo_at,
    COUNT(*) FILTER (WHERE resultado <> 'pasado_sin_escanear')       AS escaneos,
    COUNT(*) FILTER (WHERE resultado IN
      ('no_pertenece','item_completo','excede_cantidad','no_encontrado')) AS escaneos_rechazados,
    COUNT(*) FILTER (WHERE resultado = 'aceptado')                   AS escaneados,
    COUNT(*) FILTER (WHERE resultado = 'pasado_sin_escanear')        AS pasados_sin_escanear
  FROM public.despacho_mega_escaneos
  GROUP BY 1
),
novedades AS (
  SELECT
    despacho_id,
    COUNT(*)                                                    AS novedades,
    COUNT(*) FILTER (WHERE estado IN ('abierta', 'en_gestion')) AS novedades_abiertas
  FROM public.despacho_mega_alertas_inventario
  GROUP BY 1
)
SELECT
  d.numero_factura,
  d.tipo_documento,
  d.fecha_factura,
  d.cliente_nit,
  d.cliente_nombre,
  d.sede,
  d.bodega,
  CASE d.estado
    WHEN 'en_proceso' THEN 'auditando'
    WHEN 'aprobado'   THEN 'aprobada'
    WHEN 'rechazado'  THEN 'rechazada'
    ELSE 'auditada'
  END                                          AS etapa,
  d.id                                         AS despacho_id,
  d.estado,
  o.id                                         AS operario_id,
  o.nombre                                     AS operario_nombre,
  o.correo                                     AS operario_correo,
  d.despachador_id,
  dp.nombre                                    AS despachador,
  d.iniciado_at,
  d.finalizado_at,
  EXTRACT(EPOCH FROM (COALESCE(d.finalizado_at, NOW()) - d.iniciado_at)) / 60.0 AS minutos,
  d.total_items,
  d.items_validados,
  COALESCE(v.unidades_solicitadas, 0)          AS unidades_solicitadas,
  COALESCE(v.unidades_validadas, 0)            AS unidades_validadas,
  COALESCE(v.lineas, 0)                        AS lineas,
  COALESCE(v.lineas_faltantes, 0)              AS lineas_faltantes,
  COALESCE(v.lineas_parciales, 0)              AS lineas_parciales,
  ROUND(100.0 * COALESCE(v.unidades_validadas, 0) / NULLIF(v.unidades_solicitadas, 0)) AS avance_pct,
  COALESCE(x.escaneos, 0)                      AS escaneos,
  COALESCE(x.escaneos_rechazados, 0)           AS escaneos_rechazados,
  COALESCE(x.escaneados, 0)                    AS escaneados,
  COALESCE(x.pasados_sin_escanear, 0)          AS pasados_sin_escanear,
  COALESCE(n.novedades, 0)                     AS novedades,
  COALESCE(n.novedades_abiertas, 0)            AS novedades_abiertas,
  -- Al abrir contra Siesa, cantidad_solicitada ES lo facturado: la diferencia
  -- es "lo que falto validar frente a la factura". Solo con auditoria cerrada.
  CASE
    WHEN d.finalizado_at IS NOT NULL
      THEN COALESCE(v.unidades_solicitadas, 0) - COALESCE(v.unidades_validadas, 0)
  END                                          AS unidades_diferencia,
  COALESCE(
    d.finalizado_at IS NOT NULL
      AND COALESCE(v.unidades_validadas, 0) <> COALESCE(v.unidades_solicitadas, 0),
    FALSE
  )                                            AS tiene_diferencia,
  GREATEST(d.updated_at, x.ultimo_escaneo_at)  AS ultimo_movimiento_at
FROM public.despacho_mega_despachos d
JOIN public.despacho_mega_operarios     o  ON o.id  = d.operario_id
JOIN public.despacho_mega_despachadores dp ON dp.id = d.despachador_id
LEFT JOIN avance    v ON v.despacho_id = d.id
LEFT JOIN actividad x ON x.despacho_id = d.id
LEFT JOIN novedades n ON n.despacho_id = d.id
WHERE d.estado <> 'cancelado';

COMMENT ON VIEW public.despacho_mega_vw_facturas IS
  'Una fila por factura auditada (sin pivote): etapa, despachador, avance y desglose escaneado vs pasado.';
```

#### 5.3.2 — `despacho_mega_vw_cobertura_dia` (reemplaza 008/009)

Columnas de Siesa (`s.*`) idénticas a 009. Se retiran `picking_*`, `auditoria_*`,
`picking_hecho`, `auditoria_hecha`; se agregan `despacho_id`, `despacho_estado`,
`operario_nombre`, `despachador`, `finalizado_at`. `es_mostrador` y `es_nota_credito` se conservan.

```sql
CREATE VIEW public.despacho_mega_vw_cobertura_dia
WITH (security_invoker = on) AS
SELECT
  s.id, s.cia, s.co_docto, s.tipo_documento, s.numero_factura, s.fecha_factura,
  s.clase_docto, s.ind_estado, s.cliente_nit, s.cliente_nombre, s.bodega,
  s.bodega_nombre, s.lineas, s.unidades, s.valor_neto, s.excluida,
  s.motivo_exclusion, s.sincronizada_at,

  f.despacho_id,
  f.estado                 AS despacho_estado,
  f.operario_nombre,
  f.despachador,
  f.finalizado_at,
  f.etapa,
  f.novedades_abiertas,
  f.tiene_diferencia,
  f.ultimo_movimiento_at,

  -- "Cubierta" = auditoria FINALIZADA. Una auditoria abierta todavia puede
  -- cancelarse: contarla como cubierta mentiria justo al cierre del dia.
  CASE
    WHEN s.excluida                  THEN 'excluida'
    WHEN f.numero_factura IS NULL    THEN 'sin_tocar'
    WHEN f.finalizado_at IS NOT NULL THEN 'auditada'
    ELSE 'auditando'
  END AS cobertura,

  (s.cliente_nit = '222222222222') AS es_mostrador,
  (s.clase_docto = '1250')         AS es_nota_credito
FROM public.despacho_mega_facturas_dia s
LEFT JOIN public.despacho_mega_vw_facturas f
  ON f.numero_factura = s.numero_factura
 AND (f.tipo_documento IS NULL OR f.tipo_documento = s.tipo_documento);
```

#### 5.3.3 — `despacho_mega_vw_cobertura_resumen` (reemplaza 009)

Salen `alistando`, `con_picking`, `con_auditoria`, `mostrador_con_picking`,
`con_cliente_con_picking`. Entran `auditando`, `cubiertas`, `mostrador_cubiertas`,
`con_cliente_cubiertas`. `cubiertas` = `cobertura = 'auditada'` (Decisión 6).

```sql
CREATE VIEW public.despacho_mega_vw_cobertura_resumen
WITH (security_invoker = on) AS
SELECT
  fecha_factura                                                     AS dia,
  COUNT(*)                                                          AS facturadas,
  COUNT(*) FILTER (WHERE excluida)                                  AS excluidas,
  COUNT(*) FILTER (WHERE NOT excluida)                              AS aplican,
  COUNT(*) FILTER (WHERE NOT excluida AND cobertura = 'sin_tocar')  AS sin_tocar,
  COUNT(*) FILTER (WHERE NOT excluida AND cobertura = 'auditando')  AS auditando,
  COUNT(*) FILTER (WHERE NOT excluida AND cobertura = 'auditada')   AS cubiertas,
  SUM(valor_neto)                                                   AS valor_neto,
  SUM(valor_neto) FILTER (WHERE NOT excluida AND cobertura = 'sin_tocar') AS valor_sin_tocar,
  MAX(sincronizada_at)                                              AS sincronizada_at,
  COUNT(*) FILTER (WHERE es_mostrador)                              AS mostrador,
  COUNT(*) FILTER (WHERE NOT es_mostrador)                          AS con_cliente,
  COUNT(*) FILTER (WHERE NOT excluida AND es_mostrador)             AS mostrador_aplican,
  COUNT(*) FILTER (WHERE NOT excluida AND es_mostrador AND cobertura = 'auditada')     AS mostrador_cubiertas,
  COUNT(*) FILTER (WHERE NOT excluida AND NOT es_mostrador)         AS con_cliente_aplican,
  COUNT(*) FILTER (WHERE NOT excluida AND NOT es_mostrador AND cobertura = 'auditada') AS con_cliente_cubiertas,
  COUNT(*) FILTER (WHERE es_nota_credito)                           AS notas_credito
FROM public.despacho_mega_vw_cobertura_dia
GROUP BY 1;
```

#### 5.3.4 — `despacho_mega_vw_facturas_por_dia_semana` (reemplaza 011)

Sin `facturas_picking`/`facturas_auditoria`. Lee `despacho_mega_despachos` directo (como 011); **no depende de `vw_facturas`**.

```sql
CREATE VIEW public.despacho_mega_vw_facturas_por_dia_semana
WITH (security_invoker = on) AS
SELECT
  DATE(d.iniciado_at AT TIME ZONE 'America/Bogota')                  AS dia,
  EXTRACT(DOW FROM d.iniciado_at AT TIME ZONE 'America/Bogota')::INT AS dia_semana,
  COUNT(DISTINCT d.numero_factura)                                   AS facturas
FROM public.despacho_mega_despachos d
WHERE d.estado <> 'cancelado'
  AND d.iniciado_at IS NOT NULL
GROUP BY 1, 2;
```

#### 5.3.5 — `despacho_mega_vw_resumen_diario` (reemplaza 002) — sin columna `modo`

```sql
CREATE VIEW public.despacho_mega_vw_resumen_diario
WITH (security_invoker = on) AS
SELECT
  DATE(d.iniciado_at AT TIME ZONE 'America/Bogota') AS dia,
  d.estado,
  COUNT(*)                                          AS total_despachos,
  COUNT(DISTINCT d.numero_factura)                  AS total_facturas,
  COUNT(DISTINCT d.operario_id)                     AS operarios_activos,
  SUM(d.total_items)                                AS items_solicitados,
  SUM(d.items_validados)                            AS items_validados,
  AVG(EXTRACT(EPOCH FROM (d.finalizado_at - d.iniciado_at)) / 60.0)
    FILTER (WHERE d.finalizado_at IS NOT NULL)      AS minutos_promedio
FROM public.despacho_mega_despachos d
WHERE d.estado <> 'cancelado'
GROUP BY 1, 2;
```

#### 5.3.6 — `despacho_mega_vw_por_operario` (reemplaza 007) — sin columna `modo`

Misma lista de 007 sin `d.modo` (ni en SELECT ni en GROUP BY): `operario_id, nombre, correo, sede, dia, despachos, despachos_ok, despachos_con_novedad, items_validados, minutos_promedio, despachos_finalizados, minutos_totales`. `GROUP BY 1, 2, 3, 4, 5`.

#### 5.3.7 — `despacho_mega_vw_novedades_inventario` (reemplaza 007) — sin columna `modo`

Misma lista de 007 sin `d.modo`. Se conserva el JOIN a despachos por `numero_factura`.

#### 5.3.8 — `despacho_mega_vw_novedades_por_item` (reemplaza 007) — sin `detectadas_en_auditoria`

Toda novedad es de auditoría: la columna dejaría de aportar. Se retira junto con el JOIN a despachos (ya no hace falta). Resto idéntico a 007.

#### 5.3.9 — `despacho_mega_vw_calidad_escaneo` (reemplaza 007)

```sql
CREATE VIEW public.despacho_mega_vw_calidad_escaneo
WITH (security_invoker = on) AS
SELECT
  o.id AS operario_id, o.nombre, o.correo,
  DATE(e.created_at AT TIME ZONE 'America/Bogota')               AS dia,
  COUNT(*) FILTER (WHERE e.resultado <> 'pasado_sin_escanear')   AS escaneos,
  COUNT(*) FILTER (WHERE e.resultado = 'aceptado')               AS aceptados,
  COUNT(*) FILTER (WHERE e.resultado IN
    ('no_pertenece','item_completo','excede_cantidad','no_encontrado')) AS rechazados,
  COUNT(*) FILTER (WHERE e.resultado = 'no_encontrado')          AS no_encontrado,
  COUNT(*) FILTER (WHERE e.resultado = 'no_pertenece')           AS no_pertenece,
  COUNT(*) FILTER (WHERE e.resultado = 'excede_cantidad')        AS excede_cantidad,
  COUNT(*) FILTER (WHERE e.resultado = 'item_completo')          AS item_completo,
  COUNT(*) FILTER (WHERE e.metodo = 'manual')                    AS manuales,  -- 'pase' no entra
  COUNT(*) FILTER (WHERE e.resultado = 'pasado_sin_escanear')    AS pasados_sin_escanear
FROM public.despacho_mega_escaneos e
JOIN public.despacho_mega_operarios o ON o.id = e.operario_id
GROUP BY 1, 2, 3, 4;
```

#### 5.3.10 — `despacho_mega_vw_picos_trabajo` (reemplaza 011)

```sql
CREATE VIEW public.despacho_mega_vw_picos_trabajo
WITH (security_invoker = on) AS
SELECT
  DATE(e.created_at AT TIME ZONE 'America/Bogota')                   AS dia,
  EXTRACT(DOW  FROM e.created_at AT TIME ZONE 'America/Bogota')::INT AS dia_semana,
  EXTRACT(HOUR FROM e.created_at AT TIME ZONE 'America/Bogota')::INT AS hora,
  COUNT(*) FILTER (WHERE e.resultado <> 'pasado_sin_escanear')       AS escaneos,
  COUNT(*) FILTER (WHERE e.resultado = 'aceptado')                   AS escaneos_ok,
  COUNT(*) FILTER (WHERE e.resultado IN
    ('no_pertenece','item_completo','excede_cantidad','no_encontrado')) AS escaneos_con_error,
  COUNT(DISTINCT e.operario_id)                                      AS operarios,
  COUNT(DISTINCT e.despacho_id)                                      AS despachos,
  COUNT(DISTINCT d.numero_factura)                                   AS facturas,
  COUNT(*) FILTER (WHERE e.resultado = 'pasado_sin_escanear')        AS pasados_sin_escanear
FROM public.despacho_mega_escaneos e
JOIN public.despacho_mega_despachos d ON d.id = e.despacho_id
GROUP BY 1, 2, 3;
```

### 5.4 — Verificación post-migración (correr aparte)

```sql
-- Enums con solo los valores esperados
SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder)
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname IN ('despacho_mega_modo','despacho_mega_modo_operario',
                    'despacho_mega_resultado_escaneo','despacho_mega_metodo_captura')
GROUP BY 1;
-- Esperado: modo {auditoria}; modo_operario {auditoria};
--           resultado {aceptado,no_pertenece,item_completo,excede_cantidad,no_encontrado,pasado_sin_escanear};
--           metodo {escaner,manual,pase}

-- Tablas vacias y catalogo intacto
SELECT (SELECT COUNT(*) FROM public.despacho_mega_despachos)      AS despachos,
       (SELECT COUNT(*) FROM public.despacho_mega_escaneos)       AS escaneos,
       (SELECT COUNT(*) FROM public.despacho_mega_eventos)        AS eventos,
       (SELECT COUNT(*) FROM public.despacho_mega_operarios)      AS operarios,
       (SELECT COUNT(*) FROM public.despacho_mega_codigos_barras) AS barras,
       (SELECT COUNT(*) FROM public.despacho_mega_facturas_dia)   AS facturas_dia;

-- Columnas: ninguna con "picking"; despacho_origen_id ausente; despachador_id presente
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name LIKE 'despacho_mega_%'
  AND (column_name ILIKE '%picking%' OR column_name = 'despacho_origen_id');
-- Esperado: 0 filas

SELECT column_name FROM information_schema.columns
WHERE table_name = 'despacho_mega_vw_facturas';
-- Comparar contra §5.3.1
```

---

## 6. Cambios por archivo

### Migraciones

| Archivo | Acción | Detalle |
|---------|--------|---------|
| `db/migrations/012_auditor_only_reset.sql` | **NUEVO** | §5.3 completo. |

### Servicios

| Archivo | Acción | Detalle |
|---------|--------|---------|
| `src/services/despacho.service.js` | MODIFY | `abrir({ numeroFactura, despachadorId, usuario, tipoDocumento })` sin `modo`: una sola apertura contra Siesa (equivalente a la actual `abrirAuditoriaSinPicking`). En creación (sin `vigente`): exige `despachadorId` (400 `solicitudInvalida` si falta), valida vía `despachadorService.exigirActivo(id)` (404 si no existe, 400 si `activo=false`), inserta `despachador_id`. Al reanudar no lo pide. Borrar `contextoPicking`, `PICKING_AUDITABLE`, `abrirAuditoria`, `abrirAuditoriaSinPicking`; respuestas sin `picking`/`sin_picking`; `despachoVigente(numeroFactura)` sin modo. NUEVO `pasarSinEscanear(id, { item_id, cantidad, motivo }, usuario)`: guard `en_proceso`, `asegurarAcceso`, tope `restante` vs `cantidad_solicitada`, `actualizarItem` + recálculo de `items_validados`, escaneo `{ resultado: 'pasado_sin_escanear', metodo: 'pase', motivo: motivo ?? null, codigo_ingresado: codigo_item, cantidad }` + evento `ITEM_PASE_REGISTRADO`; exceso → escaneo `excede_cantidad` + evento `ESCANEO_RECHAZADO`. `validar()` queda intacto. |
| `src/services/despachador.service.js` | **NUEVO** | `listar({ todos })` (default solo activos); `crear({ nombre })` recorta, rechaza vacío (400) y duplicado (409 al capturar `23505` del índice único); `actualizar(id, { nombre?, activo? })` (404 si no existe; `activo=false` es la baja lógica); `exigirActivo(id)` → 404 si no existe, 400 si inactivo (lo usa `despacho.service.abrir`). |
| `src/services/factura.service.js` | MODIFY | `detalle()` sin `picking` ni `comparativo`; usa `resumen.despacho_id`; `linea_tiempo` = eventos de la auditoría; retirar `auditoriaDerivada`; respuesta `{ resumen, auditoria: { despacho, items, escaneos, alertas, eventos }, linea_tiempo }`. Comentario de cabecera sin "comparativo picking <-> auditoria". |
| `src/services/comparativo.js` | DELETE | La lectura ya no cruza picking↔auditoría. |
| `src/services/comparativo.test.js` | DELETE | 11 tests que se van con el módulo. |
| `src/services/cobertura.service.js` | MODIFY | `CAMPOS_RESUMEN` = `facturadas, excluidas, aplican, sin_tocar, auditando, cubiertas, valor_sin_tocar, mostrador, con_cliente, mostrador_aplican, mostrador_cubiertas, con_cliente_aplican, con_cliente_cubiertas, notas_credito`. `cobertura_pct = cubiertas/aplican`, `cobertura_identificado_pct = con_cliente_cubiertas/con_cliente_aplican`, `cobertura_mostrador_pct = mostrador_cubiertas/mostrador_aplican`. |
| `src/services/agregacion.js` | MODIFY | `agruparPorOperario` una fila por operario (clave `operario_id`, sin campo `modo`); `serieDiaria` → `{ dia, despachos, items_validados }`; `facturasPorDiaSemana` → `{ dia_semana, facturas, dias_con_datos }`; `CAMPOS_CALIDAD` += `pasados_sin_escanear`; `mapaDeCalor` acumula `pasados_sin_escanear`; `CAMPOS_NOVEDADES` −= `detectadas_en_auditoria`. |
| `src/services/alerta.service.js` | MODIFY | Retirar `modo: despacho.modo` del payload del correo. |
| `src/services/operario.service.js` | MODIFY | Sin `modo_habilitado: "ambos"` en `pendientes`/`provisionar` (el DB default `'auditoria'` cubre el alta); comentarios sin picking. |

### Schemas, rutas, controladores, middleware, lib

| Archivo | Acción | Detalle |
|---------|--------|---------|
| `src/schemas/despachoMega.schema.js` | MODIFY | **Eliminar** `export const modo` y el campo `modo` de `abrirDespachoBody`, `bandejaNovedadesQuery`, `rangoFechasQuery`, `listarDespachosQuery` (Zod descarta claves desconocidas: un cliente viejo que mande `modo` no rompe). `abrirDespachoBody` += `despachador_id: uuid.optional()` (la exigencia en creación vive en el servicio, como `tipo_documento`). `actualizarOperarioBody` sin `modo_habilitado`. `etapaFactura` = `["auditando","auditada","aprobada","rechazada"]`. `estadoCobertura` = `["sin_tocar","auditando","auditada","excluida"]`. NUEVOS: `pasarSinEscanearBody` (`item_id` uuid, `cantidad` `z.coerce.number().int().positive()`, `motivo` `z.string().trim().max(500).optional()`), `crearDespachadorBody` (`nombre` trim min 2 max 80), `actualizarDespachadorBody` (`nombre?`, `activo?` boolean, refine ≥1 campo), `listarDespachadoresQuery` (`todos` como `booleanoQuery`, acepta `"1"`/`"true"`). |
| `src/controllers/despachos.controller.js` | MODIFY | `abrir` pasa `despachadorId: req.body.despachador_id` y ya no pasa `modo`. Handler nuevo `pasar` → `pasarSinEscanear`. |
| `src/controllers/despachadores.controller.js` | **NUEVO** | `listar` (si `todos` y no admin → 403 `prohibido`), `crear`, `actualizar`. |
| `src/routes/index.js` | MODIFY | `POST /despachos/:id/pasar` con `validate({ params: paramsId, body: pasarSinEscanearBody })`. `GET /despachadores` (requireAuth; `validate({ query: listarDespachadoresQuery })`), `POST /despachadores` (requireAdmin; `crearDespachadorBody`), `PATCH /despachadores/:id` (requireAdmin; `paramsId` + `actualizarDespachadorBody`). |
| `src/middleware/auth.js` | MODIFY | Eliminar `requireModo` (muerto: definido y nunca usado). `sincronizarOperario` sin `modo_habilitado: "ambos"` (DB default); comentarios sin picking. |
| `src/lib/correo.js` | MODIFY | Retirar la fila "Proceso" (`datos.modo`) del correo de alerta. |

### Repositorios

| Archivo | Acción | Detalle |
|---------|--------|---------|
| `src/repositories/despachos.repository.js` | MODIFY | `CAMPOS_DESPACHO`: −`despacho_origen_id`, +`despachador_id`, + embed `despachador:despacho_mega_despachadores!despachador_id (id, nombre, activo)`. `despachoVigente(numeroFactura)` sin `modo`. `escaneosDe` select += `motivo`. `registrarEscaneo` recibe `motivo`. `listar` sin filtro `modo`. |
| `src/repositories/despachadores.repository.js` | **NUEVO** | `listar({ soloActivos })`, `porId`, `crear`, `actualizar`. Tabla `despacho_mega_despachadores`; campos `id, nombre, activo, created_at, updated_at`. |
| `src/repositories/facturas.repository.js` | MODIFY | Filtro por operario: `.eq("operario_id", operarioId)` (sin `or` picking/auditoría). `estancadas`: `.eq("etapa", "auditando")`. `indicadores`: select `etapa, tiene_diferencia, unidades_diferencia, finalizado_at` y contar por `finalizado_at`; `tasa_discrepancia` = auditorías cerradas con faltante frente a lo facturado. Cabecera sin "pivota picking y auditoria". |
| `src/repositories/analitica.repository.js` | MODIFY | `resumenDiario` y `porOperario` sin parámetro/filtro `modo`. |
| `src/repositories/alertas.repository.js` | MODIFY | `bandeja` sin filtro `modo`; embed de despacho sin `modo`. |
| `src/repositories/eventos.repository.js` | MODIFY | `ITEM_PASE_REGISTRADO: "item_pase_registrado"` (texto libre, sin migración). |

### Docs

| Archivo | Acción | Detalle |
|---------|--------|---------|
| `docs/API.md` | MODIFY | Apertura sin `modo` y con `despachador_id`; endpoints `/despachadores`; `POST /despachos/:id/pasar`; columnas nuevas de `vw_facturas`; cobertura sobre `cubiertas`; retirar secciones `modo: "picking"` / `modo: "auditoria"`. |
| `docs/ESTADO-REPOS.md` | MODIFY | **Despliegue conjunto** backend + frontend (no "backend primero"): lista de cambios incompatibles. |
| `docs/PENDIENTES.md` | MODIFY | Nueva sección del cambio; nota de que la migración 012 fue destructiva. |
| `docs/PENDIENTES-OPERARIO.md` | MODIFY | Contrato para el frontend del operario: select de despachador al abrir, `POST /pasar`, modo cine hereda. |

---

## 7. Contratos de API

### 7.1 — `POST /api/despachos` (modificado)

```json
{ "numero_factura": "1520045", "despachador_id": "5f1c…", "tipo_documento": "P05" }
```

- Sin campo `modo`. Si un cliente lo manda, Zod lo descarta (no es 400).
- `despachador_id`: obligatorio al **crear** → `400` si falta, `404` si no existe, `400` si `activo=false`. Al **reanudar** no se envía ni se valida.
- Respuesta (`201` crear / `200` reanudar): `{ despacho, items, reanudado }`. `despacho` incluye `despachador_id` y `despachador: { id, nombre, activo }`. Se retiran `picking` y `sin_picking`.
- `GET /api/despachos/:id` devuelve `{ despacho, items, escaneos, alertas, aprobaciones }` (sin `picking`); `escaneos[]` incluye `motivo`.

### 7.2 — `POST /api/despachos/:id/pasar` (nuevo)

```json
{ "item_id": "uuid", "cantidad": 6, "motivo": "codigo de barras danado" }
```

| Respuesta | Significado |
|-----------|-------------|
| `200 { resultado: "pasado_sin_escanear", mensaje, item, despacho, motivo }` | Aceptado; ítem completo si `validada + cantidad >= solicitada`. |
| `200 { resultado: "excede_cantidad", mensaje, item }` | Rechazado entero; `cantidad_validada` no cambia; cuenta en `escaneos_rechazados`. |
| `403 / 404 / 409` | Acceso de otro operario / despacho o ítem inexistente / despacho no `en_proceso`. |

- `cantidad`: entera positiva en unidades base.
- `motivo`: optional/nullable; viaja en `escaneosDe` (detalle) y en el payload del evento `item_pase_registrado`.
- Registro exitoso: escaneo `{ resultado: 'pasado_sin_escanear', metodo: 'pase', motivo, codigo_ingresado: codigo_item }` (`codigo_ingresado` es NOT NULL) + evento `item_pase_registrado`.

### 7.3 — Despachadores (nuevo)

| Endpoint | Auth | Body / Query | Respuesta |
|----------|------|--------------|-----------|
| `GET /api/despachadores` | operario o admin | `?todos=1` (solo admin; otro rol → 403) | `{ despachadores: [{ id, nombre, activo, created_at, updated_at }] }`; por defecto solo `activo=true`, orden por `nombre` |
| `POST /api/despachadores` | admin | `{ nombre }` | `201 { despachador }`; `400` vacío; `409` duplicado (case/trim-insensitive) |
| `PATCH /api/despachadores/:id` | admin | `{ nombre?, activo? }` (≥1 campo) | `200 { despachador }`; `404` no existe; `409` nombre duplicado |

No existe `DELETE`: la baja es `activo=false`. Un despachador inactivo sigue apareciendo en despachos históricos (JOIN), pero no puede elegirse en aperturas nuevas.

### 7.4 — Contratos de lectura (solo auditoría)

- `GET /api/panel/facturas`: filas de `vw_facturas` con los nombres de §5.3.1 (`despacho_id`, `estado`, `operario_*`, `despachador_id`, `despachador`, `escaneados`, `pasados_sin_escanear`, …). `etapa ∈ {auditando, auditada, aprobada, rechazada}`. Filtro `operario_id` = operario del despacho; `estancadas_minutos` mira solo `auditando`.
- `GET /api/panel/facturas/:numero`: `{ resumen, auditoria: { despacho, items, escaneos, alertas, eventos }, linea_tiempo }`. Sin `picking` ni `comparativo`. Cada escaneo trae `resultado` y `motivo`; `resumen.despachador` presente.
- Analítica: `por_operario` una fila por operario (sin `modo`); `serie_diaria` `{ dia, despachos, items_validados }`; `facturas_por_dia_semana` `{ dia_semana, facturas, dias_con_datos }`; `calidad_escaneo` y `picos_trabajo`/`mapa_calor` con `pasados_sin_escanear`. Los querys no aceptan `modo` (se descarta).
- Cobertura: `cobertura ∈ {sin_tocar, auditando, auditada, excluida}`; `totales` con `cubiertas`, `mostrador_cubiertas`, `con_cliente_cubiertas`, `auditando`; sin `alistando`, `con_picking`, `con_auditoria`, `*_con_picking`. Filas de `vw_cobertura_dia` con `despacho_id`, `despacho_estado`, `operario_nombre`, `despachador`, `finalizado_at`.
- `GET /api/panel/novedades`: sin filtro `modo`; filas sin `modo`.
- `GET /api/operarios`: `modo_habilitado` siempre `'auditoria'`; `PATCH /api/operarios/:id` ya no lo acepta.

### 7.5 — Contrato que el frontend debe consumir (repo `Pagina-web_React`, fuera de alcance acá)

**Se despliega junto con el backend.** Al 15/9/2026, `src/pages/DespachoMega` tiene referencias a picking en
`DespachoMegaOperario.jsx`, `DespachoMegaOperario.css`, `hooks/useDMDespacho.js`, `components/DMFacturaDetalle.jsx`,
`components/DMTabAnalitica.jsx`, `components/DMTabCobertura.jsx`, `components/DMTabFacturas.jsx`,
`components/DMTabNovedades.jsx`, `components/DMTabOperarios.jsx`, `utils/dmEstados.js`, `DespachoMegaAdmin.jsx` y CSS asociado.

Lo que el frontend necesita hacer:
1. **Operario, abrir auditoría**: select de despachador cargado de `GET /api/despachadores`; enviar `despachador_id` (no `modo`); tratar `400/404` del despachador; no pedirlo al reanudar.
2. **Operario, pasar sin escanear**: botón en modo lista y cine → `POST /despachos/:id/pasar`; mostrar `pasado_sin_escanear` distinto de `aceptado`.
3. **Admin, CRUD de despachadores**: sección con lista (`?todos=1`), alta, edición de nombre y activar/desactivar.
4. **Retirar UI de picking**: selector de modo, banner "auditoría sin picking", comparativo, columnas `picking_*`, `alistando`/`alistada` en etapas y cobertura, `facturas_picking`/`facturas_auditoria`, `con_picking`, selector `modo_habilitado`.
5. **Renombres de `vw_facturas`** (§5.3.1) y de cobertura (§5.3.2, §5.3.3).

### Nombres de columnas nuevas (constantes en vistas y agregación)

`despachador_id`, `despachador`, `escaneados`, `pasados_sin_escanear`, `cubiertas`,
`mostrador_cubiertas`, `con_cliente_cubiertas`, `auditando` (en resumen de cobertura),
`despacho_id`, `despacho_estado`, `finalizado_at` (en cobertura_dia).
Se retiran: `picking_*`, `auditoria_*` (renombradas), `alistando`, `alistada`, `con_picking`,
`con_auditoria`, `mostrador_con_picking`, `con_cliente_con_picking`, `facturas_picking`,
`facturas_auditoria`, `detectadas_en_auditoria`, `modo` (en vistas de analítica y novedades).

---

## 8. Plan de tests (Strict TDD — test primero)

| Archivo | Acción | Casos |
|---------|--------|-------|
| `src/schemas/despachoMega.schema.test.js` | CREATE | "abrirDespachoBody acepta despachador_id uuid y rechaza uno inválido"; "abrirDespachoBody descarta `modo` sin fallar"; "pasarSinEscanearBody exige cantidad entera positiva y permite motivo opcional (máx 500)"; "crearDespachadorBody recorta y rechaza nombre vacío"; "actualizarDespachadorBody exige al menos un campo y acepta activo boolean"; "listarDespachadoresQuery convierte todos=1/true en booleano"; "etapaFactura y estadoCobertura rechazan alistando/alistada". Zod puro: `safeParse`. |
| `src/services/despachador.service.test.js` | CREATE (`vi.mock` de `despachadores.repository`) | "crear recorta el nombre y lo persiste"; "crear con nombre vacío o solo espacios lanza solicitudInvalida"; "crear con nombre duplicado (error 23505 del repo) lanza conflicto 409"; "actualizar con activo=false desactiva sin borrar (nunca llama delete)"; "actualizar inexistente lanza noEncontrado"; "listar por defecto pide solo activos; todos=true pide todos"; "exigirActivo lanza noEncontrado si no existe y solicitudInvalida si está inactivo". |
| `src/services/despacho.service.test.js` | CREATE (`vi.mock` de repositories, `despachador.service` y `facturaSiesa.service`) | "abrir sin despachador_id en creación lanza solicitudInvalida y no consulta Siesa"; "abrir con despachador inactivo es rechazado y no crea"; "abrir con despachador válido lo persiste (`despachador_id` en `crearConItems`) y viaja en la respuesta"; "reanudar no exige despachador_id y devuelve el despachador guardado"; "abrir no envía `modo` al repositorio"; "pasar cantidad parcial deja la línea parcial/completa y registra pasado_sin_escanear con metodo pase y codigo_ingresado = codigo_item"; "pasar con exceso rechaza entero con excede_cantidad y no altera cantidad_validada"; "pasar con motivo lo persiste; sin motivo queda null"; "pasar sobre línea completa cae en excede_cantidad"; "pasar en despacho no en_proceso lanza conflicto". |
| `src/services/agregacion.test.js` | MODIFY (16 tests existentes) | "agruparCalidad suma pasados_sin_escanear sin mezclarlos con rechazados y tasa usa solo intentos"; "mapaDeCalor acumula pasados_sin_escanear por celda"; "agruparPorOperario colapsa a una fila por operario sin campo modo"; "serieDiaria devuelve `{ dia, despachos, items_validados }`"; "facturasPorDiaSemana no expone facturas_picking ni facturas_auditoria"; "agruparNovedades no expone detectadas_en_auditoria". Reescribir los casos que asumían dos modos. |
| `src/services/comparativo.test.js` | DELETE (11 tests) | Junto con `comparativo.js`. |

Migración: verificación manual en SQL Editor (no hay harness): correr `012` completa;
re-correr para confirmar idempotencia; ejecutar §5.4; `SELECT *` de cada vista y comparar
columnas contra §5.3; validar el orden de DROP (`cobertura_resumen → cobertura_dia → vw_facturas`,
luego las siete independientes) y de CREATE (`vw_facturas → cobertura_dia → cobertura_resumen`, luego el resto).

---

## 9. Riesgos y trampas (leer antes de tocar código)

1. **Recrear enums (DROP TYPE) solo porque los datos son descartables.** Este patrón
   exige truncar tablas y dropear todas las vistas dependientes. **Nunca reutilizarlo en
   producción con histórico real**: ahí la regla vuelve a ser "solo `ADD VALUE`, nunca DROP".
2. **`012` es destructiva y sin rollback por SQL.** Backup/branch de Supabase antes de correr.
   Confirmar con el negocio que no hay ningún despacho real antes de ejecutarla.
3. **`CREATE OR REPLACE VIEW` solo agrega columnas al final.** En `012` todas las vistas
   afectadas se hacen con `DROP` + `CREATE`, así que no aplica; **vuelve a aplicar en cualquier
   migración posterior** (`013+`) que toque estas vistas. Orden real de dependencia:
   `vw_cobertura_resumen → vw_cobertura_dia → vw_facturas`; el resto es independiente
   (`vw_facturas_por_dia_semana` lee `despacho_mega_despachos` directo, **no** `vw_facturas`).
4. **`ALTER COLUMN TYPE` falla si una vista referencia la columna.** Por eso `012` dropea
   diez vistas, no solo las que cambian de forma. Si aparece una vista nueva sobre `modo`,
   `resultado` o `metodo` antes de correr `012`, agregarla al bloque de `DROP`.
5. **`vw_facturas` es la fuente del panel**: la consume `vw_cobertura_dia`,
   `facturas.repository` (listar, porNumero, indicadores) y `factura.service.detalle`. Los
   renombres de §5.3.1 obligan a tocar los tres consumidores en el mismo cambio.
6. **El pase sin escanear inflaría rechazos** si no se excluye explícitamente: filtros
   `resultado <> 'aceptado'` → lista blanca `IN ('no_pertenece','item_completo','excede_cantidad','no_encontrado')`;
   `escaneos` = `<> 'pasado_sin_escanear'`.
7. **`codigo_ingresado` es NOT NULL** en `despacho_mega_escaneos`: el pase guarda
   `codigo_item` del ítem en ese campo (no hay código escaneado).
8. **Frontend: despliegue conjunto obligatorio.** El backend nuevo rompe al frontend actual
   (apertura sin `modo` pero con `despachador_id` obligatorio, columnas renombradas de
   `vw_facturas`, cobertura sin `alistando`/`con_picking`, sin `comparativo`). Y el frontend
   nuevo no funciona contra el backend actual (`/despachadores`, `/pasar`). Coordinar ventana
   de despliegue; documentar en `ESTADO-REPOS.md`. Contrato en §7.5.
9. **`despachador_id NOT NULL` es posible solo por el TRUNCATE.** Si por algún motivo la
   tabla no se truncara, la migración fallaría en `ADD COLUMN ... NOT NULL` sin default.
10. **`despacho_mega_operarios` no se trunca**: el `UPDATE modo_habilitado = 'auditoria'`
    es obligatorio antes del cast, o el `USING` falla con `'ambos'`/`'picking'`.
11. **Nombre duplicado de despachador**: el índice único es sobre `LOWER(TRIM(nombre))`; el
    servicio recorta antes de insertar y traduce el error `23505` a `409 conflicto`. No
    hacer pre-check + insert (carrera).
12. **`modo` removido del contrato, no de la DB.** La columna `despachos.modo` queda con
    `DEFAULT 'auditoria'` y el servicio no la envía. No reintroducir el campo en Zod "por si acaso".
13. **Lint roto** (ESLint 9 sin `eslint.config.js`): NO tocarlo; verificación con `npm test`.
14. **`agregacion.test.js` cambia de contrato**: 16 tests se reescriben, no se "ajustan".
    Los 11 de `comparativo.test.js` desaparecen: el conteo final no es 27 + nuevos.

---

## 10. Definición de listo

- [ ] `012` corrió en Supabase; `§5.4` devuelve lo esperado; re-correrla deja el mismo estado.
- [ ] No existe columna, vista, enum, schema, ruta ni función que mencione picking (`grep -ri picking src db/migrations/012*` → 0 fuera de comentarios históricos en 001–011).
- [ ] `POST /api/despachos` no acepta `modo`; exige `despachador_id` activo al crear (400/404) y no al reanudar.
- [ ] `GET/POST/PATCH /api/despachadores` funcionan con los códigos de §7.3; no existe `DELETE`.
- [ ] `despachador` (nombre) viaja en abrir/obtener/detalle/`vw_facturas`/`vw_cobertura_dia`.
- [ ] `cobertura_pct` se calcula sobre `cubiertas` (= auditadas); los estados de cobertura son `sin_tocar / auditando / auditada / excluida`.
- [ ] Existe `pasado_sin_escanear` con cantidad parcial y motivo opcional; `validar()`/`pasarSinEscanear()` rechazan cualquier exceso sobre lo facturado.
- [ ] `vw_calidad_escaneo`/`vw_picos_trabajo`/`vw_facturas` no cuentan el pase como rechazo y distinguen `escaneados` vs `pasados_sin_escanear`.
- [ ] `npm test` pasa: 16 tests de agregación reescritos + tests nuevos de schema, despacho.service y despachador.service; `comparativo.test.js` eliminado.
- [ ] `docs/API.md`, `docs/ESTADO-REPOS.md` (despliegue conjunto), `docs/PENDIENTES.md`, `docs/PENDIENTES-OPERARIO.md` reflejan el contrato nuevo.
- [ ] Smoke local `npm run dev`: crear despachador; abrir auditoría con `despachador_id`; pasar producto sin escanear (parcial, con y sin motivo); exceso rechazado; `GET /panel/facturas` muestra `despachador`, `escaneados`, `pasados_sin_escanear`.

---

*Documento generado desde los artefactos SDD `openspec/changes/auditor-only-workflow/`.
Si la implementación se desvía, actualizar esos artefactos junto con el código.*
