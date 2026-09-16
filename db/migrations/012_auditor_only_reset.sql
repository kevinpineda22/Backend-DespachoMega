-- ===========================================================================
-- 012 — Auditor-only: reset destructivo, enums limpios, despachadores, pases
-- ===========================================================================
-- !!! DESTRUCTIVA !!!
-- Trunca todas las tablas transaccionales del modulo y recrea cuatro enums.
-- Solo es aceptable porque TODO el dato actual es de prueba (confirmado por el
-- negocio). Tomar backup/branch antes. No hay rollback por SQL.
-- NUNCA reutilizar este patron en una base con historico real: ahi la regla
-- vuelve a ser "solo ADD VALUE, nunca DROP TYPE".
--
-- Idempotente: se puede volver a correr completa; la segunda pasada deja el
-- mismo estado (y vuelve a truncar).
--
-- Una sola transaccion: no hay `ALTER TYPE ... ADD VALUE` (lo unico que no
-- puede correr dentro de una transaccion); los enums se recrean, asi que todo
-- aplica o nada aplica.
--
-- Orden obligatorio: vistas -> truncate -> columna origen -> enums ->
-- despachadores -> columnas nuevas -> vistas.
--
-- Ver docs/PLAN-AUDITOR-ONLY-WORKFLOW.md §5 y
-- openspec/changes/auditor-only-workflow/design.md (D8).
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
--    NO se truncan: operarios (usuarios reales ligados a auth.users), items y
--    codigos_barras (catalogo Siesa, ~9 minutos de sincronizacion) ni
--    facturas_dia (snapshot irrecuperable: Siesa conserva ~4 dias).
--    RESTART IDENTITY reinicia los BIGSERIAL de escaneos y eventos.
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
--    Receta por enum: (1) DROP DEFAULT, (2) columna -> TEXT, (3) DROP TYPE,
--    (4) CREATE TYPE, (5) columna -> enum con USING, (6) restaurar default.
-- ---------------------------------------------------------------------------
-- 4a. despacho_mega_modo: solo 'auditoria'. La columna se conserva con
--     DEFAULT para que el servicio no tenga que enviarla. El indice unico
--     despacho_mega_despachos_factura_modo_idx se reconstruye solo.
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
--     por eso el UPDATE antes de volver a castear: sin el, el USING falla con
--     'ambos' / 'picking'.
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
--     La columna no tiene default (001), asi que no hay nada que soltar.
ALTER TABLE public.despacho_mega_escaneos
  ALTER COLUMN resultado TYPE TEXT USING resultado::TEXT;
DROP TYPE IF EXISTS public.despacho_mega_resultado_escaneo;
CREATE TYPE public.despacho_mega_resultado_escaneo AS ENUM (
  'aceptado',
  'no_pertenece',        -- el codigo no esta en la factura
  'item_completo',       -- ya se habia validado la cantidad total
  'excede_cantidad',     -- el escaneo (o el pase) supera lo solicitado
  'no_encontrado',       -- el codigo de barras no resuelve a ningun item
  'pasado_sin_escanear'  -- el auditor lo paso sin leer codigo (no es rechazo)
);
ALTER TABLE public.despacho_mega_escaneos
  ALTER COLUMN resultado TYPE public.despacho_mega_resultado_escaneo
    USING resultado::public.despacho_mega_resultado_escaneo;

-- 4d. despacho_mega_metodo_captura + 'pase'. Metodo honesto: no hubo captura.
--     Ademas deja al pase fuera de `manuales` sin tocar ese filtro.
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

-- Unico sin distinguir mayusculas ni espacios en los extremos: "Carlos",
-- " carlos " y "CARLOS" son la misma persona. El servicio recorta antes de
-- insertar y traduce el 23505 a 409; no hace pre-check + insert (carrera).
CREATE UNIQUE INDEX IF NOT EXISTS despacho_mega_despachadores_nombre_idx
  ON public.despacho_mega_despachadores (LOWER(TRIM(nombre)));

CREATE INDEX IF NOT EXISTS despacho_mega_despachadores_activo_idx
  ON public.despacho_mega_despachadores (activo) WHERE activo = TRUE;

DROP TRIGGER IF EXISTS despacho_mega_despachadores_touch ON public.despacho_mega_despachadores;
CREATE TRIGGER despacho_mega_despachadores_touch
  BEFORE UPDATE ON public.despacho_mega_despachadores
  FOR EACH ROW EXECUTE FUNCTION despacho_mega_touch_updated_at();

-- RLS, mismo modelo que 003: SELECT para autenticados, escritura solo por el
-- backend con service_role (sin politica = denegado). Cualquier operario
-- necesita leer el catalogo para elegir despachador al abrir.
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
-- NOT NULL sin default: la tabla esta vacia (paso 2), asi que no hace falta
-- backfill. Si por algun motivo no se truncara, esto fallaria a proposito.
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
--    el resto en cualquier orden.
--
--    CONVENCION DE CONTEOS (design.md D7):
--      escaneos             = resultado <> 'pasado_sin_escanear' (intentos reales)
--      rechazados           = lista blanca IN ('no_pertenece','item_completo',
--                             'excede_cantidad','no_encontrado')
--      escaneados           = resultado = 'aceptado'
--      pasados_sin_escanear = resultado = 'pasado_sin_escanear'
--    Asi escaneos = escaneados + rechazados exacto, y el pase nunca infla los
--    rechazos. Un filtro `<> 'aceptado'` contaria el pase como error.
-- ---------------------------------------------------------------------------

-- 7.1 vw_facturas (reemplaza 006; sin pivote, una fila por auditoria).
-- Nombres limpios: el prefijo `auditoria_*` existia solo para distinguirse de
-- `picking_*`. Renombres: auditoria_id -> despacho_id, auditoria_estado ->
-- estado, auditoria_operario_* -> operario_*, auditoria_finalizado_at ->
-- finalizado_at, auditoria_minutos -> minutos, auditoria_total_items ->
-- total_items, auditoria_items_validados -> items_validados,
-- auditoria_unidades_* -> unidades_*, auditoria_escaneos -> escaneos,
-- auditoria_escaneos_rechazados -> escaneos_rechazados,
-- auditoria_avance_pct -> avance_pct.
CREATE VIEW public.despacho_mega_vw_facturas
WITH (security_invoker = on) AS
-- Avance real en UNIDADES. `despachos.items_validados` cuenta LINEAS completas:
-- sirve para "3 de 7 productos", pero como barra de progreso salta a escalones.
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
-- ultimo_escaneo_at es MAX sobre TODAS las filas: un pase tambien es trabajo,
-- y un escaneo RECHAZADO no toca la fila del despacho.
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
  -- `con_novedad` NO entra aca a proposito: es una bandera, no una etapa.
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
  -- Duracion cerrada si termino; corriendo si sigue abierto.
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
  -- es "lo que falto validar frente a la factura". Solo con auditoria cerrada:
  -- mientras corre, todo lo que aun no se escaneo se veria como diferencia.
  CASE
    WHEN d.finalizado_at IS NOT NULL
      THEN COALESCE(v.unidades_solicitadas, 0) - COALESCE(v.unidades_validadas, 0)
  END                                          AS unidades_diferencia,
  COALESCE(
    d.finalizado_at IS NOT NULL
      AND COALESCE(v.unidades_validadas, 0) <> COALESCE(v.unidades_solicitadas, 0),
    FALSE
  )                                            AS tiene_diferencia,
  -- GREATEST ignora los NULL: sin escaneos todavia, cae en `updated_at`.
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

-- 7.2 vw_cobertura_dia (reemplaza 008/009). Columnas de Siesa (s.*) identicas
-- a 009. Salen picking_*, auditoria_*, picking_hecho, auditoria_hecha; entran
-- despacho_id, despacho_estado, operario_nombre, despachador, finalizado_at.
-- El cruce va por consecutivo Y serie; la tolerancia a tipo_documento nulo del
-- lado del despacho cubre filas sin ese campo.
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

  -- Venta a consumidor final: NIT centinela del punto de venta de Siesa.
  (s.cliente_nit = '222222222222') AS es_mostrador,
  -- 1250 = series PN* (notas credito).
  (s.clase_docto = '1250')         AS es_nota_credito
FROM public.despacho_mega_facturas_dia s
LEFT JOIN public.despacho_mega_vw_facturas f
  ON f.numero_factura = s.numero_factura
 AND (f.tipo_documento IS NULL OR f.tipo_documento = s.tipo_documento);

COMMENT ON VIEW public.despacho_mega_vw_cobertura_dia IS
  'Lo facturado en Siesa cruzado contra lo auditado en el modulo. Una fila sin despacho es una factura que nadie toco.';

-- 7.3 vw_cobertura_resumen (reemplaza 009). Salen alistando, con_picking,
-- con_auditoria, mostrador_con_picking, con_cliente_con_picking. Entran
-- auditando, cubiertas, mostrador_cubiertas, con_cliente_cubiertas.
-- cubiertas = cobertura = 'auditada'.
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

COMMENT ON VIEW public.despacho_mega_vw_cobertura_resumen IS
  'Semaforo por dia: cuantas se facturaron y cuantas quedaron auditadas, abierto por origen.';

-- 7.4 vw_facturas_por_dia_semana (reemplaza 011). Sin facturas_picking /
-- facturas_auditoria. Lee despachos directo; NO depende de vw_facturas.
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

COMMENT ON VIEW public.despacho_mega_vw_facturas_por_dia_semana IS
  'Facturas distintas abiertas por dia, medidas por iniciado_at. Excluye canceladas.';

-- 7.5 vw_resumen_diario (reemplaza 002) — sin columna modo.
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

-- 7.6 vw_por_operario (reemplaza 007) — sin columna modo.
-- `minutos_promedio` es POR DIA; para un rango el backend usa
-- SUM(minutos_totales) / SUM(despachos_finalizados).
CREATE VIEW public.despacho_mega_vw_por_operario
WITH (security_invoker = on) AS
SELECT
  o.id                                              AS operario_id,
  o.nombre,
  o.correo,
  o.sede,
  DATE(d.iniciado_at AT TIME ZONE 'America/Bogota') AS dia,
  COUNT(*)                                          AS despachos,
  COUNT(*) FILTER (WHERE d.estado IN ('completado', 'aprobado')) AS despachos_ok,
  COUNT(*) FILTER (WHERE d.estado = 'con_novedad')  AS despachos_con_novedad,
  SUM(d.items_validados)                            AS items_validados,
  AVG(
    EXTRACT(EPOCH FROM (d.finalizado_at - d.iniciado_at)) / 60.0
  ) FILTER (WHERE d.finalizado_at IS NOT NULL)      AS minutos_promedio,
  COUNT(*) FILTER (WHERE d.finalizado_at IS NOT NULL) AS despachos_finalizados,
  COALESCE(SUM(
    EXTRACT(EPOCH FROM (d.finalizado_at - d.iniciado_at)) / 60.0
  ) FILTER (WHERE d.finalizado_at IS NOT NULL), 0)  AS minutos_totales
FROM public.despacho_mega_despachos d
JOIN public.despacho_mega_operarios o ON o.id = d.operario_id
WHERE d.estado <> 'cancelado'
GROUP BY 1, 2, 3, 4, 5;

-- 7.7 vw_novedades_inventario (reemplaza 007) — sin columna modo. Se conserva
-- el JOIN a despachos por numero_factura y despacho_id.
CREATE VIEW public.despacho_mega_vw_novedades_inventario
WITH (security_invoker = on) AS
SELECT
  a.id,
  a.codigo_item,
  a.descripcion,
  a.motivo,
  a.estado,
  a.cantidad_faltante,
  a.created_at,
  a.resuelta_at,
  EXTRACT(EPOCH FROM (COALESCE(a.resuelta_at, NOW()) - a.created_at)) / 60.0 AS minutos_abierta,
  d.numero_factura,
  o.nombre                                          AS reportada_por_nombre,
  o.correo                                          AS reportada_por_correo,
  DATE(a.created_at AT TIME ZONE 'America/Bogota')  AS dia,
  a.despacho_id,
  a.item_id,
  a.comentario,
  a.respuesta,
  a.atendida_por,
  g.nombre                                          AS atendida_por_nombre,
  g.correo                                          AS atendida_por_correo
FROM public.despacho_mega_alertas_inventario a
JOIN public.despacho_mega_despachos d ON d.id = a.despacho_id
JOIN public.despacho_mega_operarios o ON o.id = a.reportada_por
LEFT JOIN public.despacho_mega_operarios g ON g.user_id = a.atendida_por;

-- 7.8 vw_novedades_por_item (reemplaza 007) — sin detectadas_en_auditoria.
-- Toda novedad es de auditoria: la columna equivaldria a `reportes`. Se retira
-- junto con el JOIN a despachos (ya no hace falta). Todo COUNT(*) por item y
-- dia: aditivo, el backend suma el rango.
CREATE VIEW public.despacho_mega_vw_novedades_por_item
WITH (security_invoker = on) AS
SELECT
  a.codigo_item,
  MAX(a.descripcion)                                AS descripcion,
  DATE(a.created_at AT TIME ZONE 'America/Bogota')  AS dia,
  COUNT(*)                                          AS reportes,
  COUNT(*) FILTER (WHERE a.estado IN ('abierta', 'en_gestion')) AS reportes_abiertos,
  COUNT(*) FILTER (WHERE a.motivo = 'sin_fisico')   AS sin_fisico,
  COUNT(*) FILTER (WHERE a.motivo = 'averiado')     AS averiado,
  COUNT(*) FILTER (WHERE a.motivo = 'ubicacion_errada') AS ubicacion_errada,
  COUNT(*) FILTER (WHERE a.motivo = 'diferencia_cantidad') AS diferencia_cantidad,
  COUNT(*) FILTER (WHERE a.motivo = 'otro')         AS otro,
  SUM(a.cantidad_faltante)                          AS unidades_faltantes
FROM public.despacho_mega_alertas_inventario a
GROUP BY 1, 3;

COMMENT ON VIEW public.despacho_mega_vw_novedades_por_item IS
  'Novedades agrupadas por item y dia. Todo aditivo: el backend suma el rango.';

-- 7.9 vw_calidad_escaneo (reemplaza 007). El pase no es intento ni rechazo;
-- `manuales` no lo incluye porque su metodo es 'pase'.
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
  COUNT(*) FILTER (WHERE e.metodo = 'manual')                    AS manuales,
  COUNT(*) FILTER (WHERE e.resultado = 'pasado_sin_escanear')    AS pasados_sin_escanear
FROM public.despacho_mega_escaneos e
JOIN public.despacho_mega_operarios o ON o.id = e.operario_id
GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW public.despacho_mega_vw_calidad_escaneo IS
  'Aciertos, rechazos y pases por operario y dia. Los pases no cuentan como intento ni como rechazo.';

-- 7.10 vw_picos_trabajo (reemplaza 011). `facturas` es DISTINCT por hora: no
-- sumar la fila para obtener el dia, usar vw_facturas_por_dia_semana.
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

COMMENT ON VIEW public.despacho_mega_vw_picos_trabajo IS
  'Movimiento por dia y hora. `facturas` es DISTINCT por hora: no sumar la fila para obtener el dia.';

COMMIT;

-- ===========================================================================
-- Verificacion post-migracion — correr aparte, fuera de la transaccion.
-- ===========================================================================
-- Enums con solo los valores esperados:
--
--   SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder)
--   FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
--   WHERE t.typname IN ('despacho_mega_modo','despacho_mega_modo_operario',
--                       'despacho_mega_resultado_escaneo','despacho_mega_metodo_captura')
--   GROUP BY 1;
--   -- Esperado: modo {auditoria}; modo_operario {auditoria};
--   --   resultado {aceptado,no_pertenece,item_completo,excede_cantidad,no_encontrado,pasado_sin_escanear};
--   --   metodo {escaner,manual,pase}
--
-- Tablas vacias y catalogo intacto:
--
--   SELECT (SELECT COUNT(*) FROM public.despacho_mega_despachos)      AS despachos,
--          (SELECT COUNT(*) FROM public.despacho_mega_escaneos)       AS escaneos,
--          (SELECT COUNT(*) FROM public.despacho_mega_eventos)        AS eventos,
--          (SELECT COUNT(*) FROM public.despacho_mega_operarios)      AS operarios,
--          (SELECT COUNT(*) FROM public.despacho_mega_codigos_barras) AS barras,
--          (SELECT COUNT(*) FROM public.despacho_mega_facturas_dia)   AS facturas_dia;
--   -- Esperado: despachos, escaneos y eventos en 0; el resto con sus filas.
--
-- Columnas: ninguna con "picking"; despacho_origen_id ausente:
--
--   SELECT table_name, column_name
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name LIKE 'despacho_mega_%'
--     AND (column_name ILIKE '%picking%' OR column_name = 'despacho_origen_id');
--   -- Esperado: 0 filas
--
-- despachador_id presente y NOT NULL:
--
--   SELECT column_name, is_nullable FROM information_schema.columns
--   WHERE table_name = 'despacho_mega_despachos' AND column_name = 'despachador_id';
--   -- Esperado: 1 fila, is_nullable = 'NO'
--
-- Columnas de vw_facturas (comparar contra docs/PLAN-AUDITOR-ONLY-WORKFLOW.md §5.3.1):
--
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'despacho_mega_vw_facturas';
--
-- Idempotencia: volver a correr el archivo completo; debe terminar sin error
-- y dejar el mismo esquema (y las tablas transaccionales de nuevo vacias).
-- ===========================================================================
