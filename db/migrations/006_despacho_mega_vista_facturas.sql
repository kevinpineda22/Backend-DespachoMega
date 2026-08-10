-- ===========================================================================
-- Despacho Mega — Vista unificada de facturas
-- ===========================================================================
-- POR QUE EXISTE
-- El modelo guarda una fila por SESION de trabajo (`despacho_mega_despachos`):
-- el picking es una fila y la auditoria es otra. Eso es correcto para operar,
-- pero el panel del administrador no supervisa sesiones, supervisa FACTURAS:
-- quiere una linea por factura y ver en que etapa del recorrido va.
--
-- POR QUE UNA VISTA Y NO AGRUPAR EN EL BACKEND
-- Porque el listado se pagina. Si se agrupara en JavaScript despues de traer
-- una pagina, una misma factura podria quedar partida entre dos paginas, y
-- filtrar por "sin auditar" seria imposible: esa condicion no existe en ninguna
-- fila suelta, nace del cruce de las dos. Agrupar en SQL permite filtrar,
-- ordenar y paginar por la etapa derivada.
--
-- POR QUE UN FULL OUTER JOIN Y NO AGREGADOS CON FILTER
-- El indice `despacho_mega_despachos_factura_modo_idx` garantiza como maximo un
-- despacho NO cancelado por (numero_factura, modo). Con esa garantia, unir dos
-- subconsultas de una fila da exactamente una fila por factura, sin necesidad de
-- agregar. Ademas evita `MAX()` sobre UUID, que no existe como agregado en las
-- versiones de PostgreSQL anteriores a la 17.
--
-- LOS CANCELADOS QUEDAN AFUERA, igual que en las vistas de analitica: un
-- despacho cancelado se reintenta, y mostrar el intento fallido al lado del
-- bueno duplicaria la factura, que es justo lo que esta vista viene a evitar.
--
-- `security_invoker = on`: la vista respeta las politicas RLS de quien consulta.
-- El backend usa service_role, asi que no se ve afectado.
-- ===========================================================================

CREATE OR REPLACE VIEW public.despacho_mega_vw_facturas
WITH (security_invoker = on) AS

-- Avance real en UNIDADES. `despachos.items_validados` cuenta LINEAS completas:
-- sirve para "3 de 7 productos", pero como barra de progreso salta a escalones
-- y miente cuando una linea pide 200 unidades y otra pide 2.
WITH avance AS (
  SELECT
    despacho_id,
    SUM(cantidad_solicitada)                          AS unidades_solicitadas,
    SUM(cantidad_validada)                            AS unidades_validadas,
    COUNT(*)                                          AS lineas,
    COUNT(*) FILTER (WHERE estado_item = 'faltante')  AS lineas_faltantes,
    COUNT(*) FILTER (WHERE estado_item = 'parcial')   AS lineas_parciales
  FROM public.despacho_mega_despacho_items
  GROUP BY 1
),

-- El "ultimo movimiento" sale de los escaneos y no de `despachos.updated_at`,
-- porque un escaneo RECHAZADO no toca la fila del despacho. Un operario
-- peleando con un codigo ilegible esta trabajando, y sin esto el panel lo
-- reportaria como estancado.
actividad AS (
  SELECT
    despacho_id,
    MAX(created_at)                                 AS ultimo_escaneo_at,
    COUNT(*)                                        AS escaneos,
    COUNT(*) FILTER (WHERE resultado <> 'aceptado') AS escaneos_rechazados
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
),

sesion AS (
  SELECT
    d.id,
    d.numero_factura,
    d.tipo_documento,
    d.fecha_factura,
    d.modo,
    d.estado,
    d.cliente_nit,
    d.cliente_nombre,
    d.sede,
    d.bodega,
    d.total_items,
    d.items_validados,
    d.observaciones,
    d.iniciado_at,
    d.finalizado_at,
    o.id                                  AS operario_id,
    o.nombre                              AS operario_nombre,
    o.correo                              AS operario_correo,
    COALESCE(v.unidades_solicitadas, 0)   AS unidades_solicitadas,
    COALESCE(v.unidades_validadas, 0)     AS unidades_validadas,
    COALESCE(v.lineas, 0)                 AS lineas,
    COALESCE(v.lineas_faltantes, 0)       AS lineas_faltantes,
    COALESCE(v.lineas_parciales, 0)       AS lineas_parciales,
    COALESCE(x.escaneos, 0)               AS escaneos,
    COALESCE(x.escaneos_rechazados, 0)    AS escaneos_rechazados,
    COALESCE(n.novedades, 0)              AS novedades,
    COALESCE(n.novedades_abiertas, 0)     AS novedades_abiertas,
    -- GREATEST ignora los NULL en PostgreSQL: si no hubo escaneos todavia, cae
    -- en `updated_at` sin necesidad de un COALESCE extra.
    GREATEST(d.updated_at, x.ultimo_escaneo_at) AS ultimo_movimiento_at,
    -- Duracion cerrada si termino; corriendo si sigue abierto. Se calcula aca
    -- para que "cuanto lleva" signifique lo mismo en la tabla y en el detalle.
    EXTRACT(EPOCH FROM (COALESCE(d.finalizado_at, NOW()) - d.iniciado_at)) / 60.0
      AS minutos
  FROM public.despacho_mega_despachos d
  JOIN public.despacho_mega_operarios o ON o.id = d.operario_id
  LEFT JOIN avance    v ON v.despacho_id = d.id
  LEFT JOIN actividad x ON x.despacho_id = d.id
  LEFT JOIN novedades n ON n.despacho_id = d.id
  WHERE d.estado <> 'cancelado'
),

pick AS (SELECT * FROM sesion WHERE modo = 'picking'),
audi AS (SELECT * FROM sesion WHERE modo = 'auditoria')

SELECT
  COALESCE(pick.numero_factura, audi.numero_factura) AS numero_factura,
  COALESCE(pick.tipo_documento, audi.tipo_documento) AS tipo_documento,
  COALESCE(pick.fecha_factura,  audi.fecha_factura)  AS fecha_factura,
  COALESCE(pick.cliente_nit,    audi.cliente_nit)    AS cliente_nit,
  COALESCE(pick.cliente_nombre, audi.cliente_nombre) AS cliente_nombre,
  COALESCE(pick.sede,           audi.sede)           AS sede,
  COALESCE(pick.bodega,         audi.bodega)         AS bodega,

  -- ETAPA DEL RECORRIDO
  -- Se mira primero la auditoria porque es la etapa mas avanzada: si existe,
  -- manda ella. `con_novedad` NO entra aca a proposito — es una bandera, no una
  -- etapa. Cuando ocupaba este lugar tapaba el dato de si la factura ya se
  -- habia auditado o no, que es justo lo que el supervisor necesita saber.
  CASE
    WHEN audi.id IS NOT NULL THEN
      CASE audi.estado
        WHEN 'en_proceso' THEN 'auditando'
        WHEN 'aprobado'   THEN 'aprobada'
        WHEN 'rechazado'  THEN 'rechazada'
        ELSE 'auditada'
      END
    ELSE
      CASE pick.estado
        WHEN 'en_proceso' THEN 'alistando'
        WHEN 'aprobado'   THEN 'aprobada'
        WHEN 'rechazado'  THEN 'rechazada'
        ELSE 'alistada'
      END
  END AS etapa,

  -- --- Picking ------------------------------------------------------------
  pick.id                    AS picking_id,
  pick.estado                AS picking_estado,
  pick.operario_id           AS picking_operario_id,
  pick.operario_nombre       AS picking_operario_nombre,
  pick.operario_correo       AS picking_operario_correo,
  pick.iniciado_at           AS picking_iniciado_at,
  pick.finalizado_at         AS picking_finalizado_at,
  pick.minutos               AS picking_minutos,
  pick.total_items           AS picking_total_items,
  pick.items_validados       AS picking_items_validados,
  pick.unidades_solicitadas  AS picking_unidades_solicitadas,
  pick.unidades_validadas    AS picking_unidades_validadas,
  pick.lineas_faltantes      AS picking_lineas_faltantes,
  pick.lineas_parciales      AS picking_lineas_parciales,
  pick.escaneos              AS picking_escaneos,
  pick.escaneos_rechazados   AS picking_escaneos_rechazados,
  ROUND(
    100.0 * pick.unidades_validadas / NULLIF(pick.unidades_solicitadas, 0)
  )                          AS picking_avance_pct,

  -- --- Auditoria ----------------------------------------------------------
  audi.id                    AS auditoria_id,
  audi.estado                AS auditoria_estado,
  audi.operario_id           AS auditoria_operario_id,
  audi.operario_nombre       AS auditoria_operario_nombre,
  audi.operario_correo       AS auditoria_operario_correo,
  audi.iniciado_at           AS auditoria_iniciado_at,
  audi.finalizado_at         AS auditoria_finalizado_at,
  audi.minutos               AS auditoria_minutos,
  audi.total_items           AS auditoria_total_items,
  audi.items_validados       AS auditoria_items_validados,
  audi.unidades_solicitadas  AS auditoria_unidades_solicitadas,
  audi.unidades_validadas    AS auditoria_unidades_validadas,
  audi.escaneos              AS auditoria_escaneos,
  audi.escaneos_rechazados   AS auditoria_escaneos_rechazados,
  ROUND(
    100.0 * audi.unidades_validadas / NULLIF(audi.unidades_solicitadas, 0)
  )                          AS auditoria_avance_pct,

  -- --- Banderas transversales ---------------------------------------------
  COALESCE(pick.novedades_abiertas, 0) + COALESCE(audi.novedades_abiertas, 0)
    AS novedades_abiertas,
  COALESCE(pick.novedades, 0) + COALESCE(audi.novedades, 0)
    AS novedades,
  COALESCE(pick.escaneos_rechazados, 0) + COALESCE(audi.escaneos_rechazados, 0)
    AS escaneos_rechazados,

  -- DIFERENCIA PICKING <-> AUDITORIA — la metrica que justifica el modulo.
  -- La `cantidad_solicitada` de la auditoria ES lo que el picking alisto (ver
  -- `abrirAuditoria` en despacho.service.js). Entonces lo que falto validar en
  -- la auditoria es exactamente lo que el auditor no encontro de lo que el
  -- picker dijo haber alistado. Solo tiene sentido con la auditoria cerrada:
  -- mientras corre, todo lo que aun no escaneo se veria como diferencia.
  CASE
    WHEN audi.finalizado_at IS NOT NULL
      THEN audi.unidades_solicitadas - audi.unidades_validadas
  END AS unidades_diferencia,

  COALESCE(
    audi.finalizado_at IS NOT NULL
      AND audi.unidades_validadas <> audi.unidades_solicitadas,
    FALSE
  ) AS tiene_diferencia,

  -- --- Tiempos globales ---------------------------------------------------
  COALESCE(pick.iniciado_at, audi.iniciado_at) AS iniciado_at,
  GREATEST(pick.ultimo_movimiento_at, audi.ultimo_movimiento_at)
    AS ultimo_movimiento_at

FROM pick
FULL OUTER JOIN audi ON audi.numero_factura = pick.numero_factura;

COMMENT ON VIEW public.despacho_mega_vw_facturas IS
  'Una fila por factura con picking y auditoria pivotados, etapa derivada y banderas de supervision.';
