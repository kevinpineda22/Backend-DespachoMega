-- ===========================================================================
-- Despacho Mega — Vistas de analitica
-- ===========================================================================
-- Alimentan el panel del administrador. Se dejan como vistas (no como consultas
-- sueltas en el backend) para que la definicion de "despacho productivo",
-- "producto mas despachado" o "pico de trabajo" viva en UN solo lugar y no se
-- desincronice entre endpoints.
--
-- `security_invoker = on`: la vista respeta las politicas RLS de quien consulta.
-- Sin esto, una vista sobre tablas protegidas es una puerta trasera para el rol
-- anon. El backend usa service_role, asi que no se ve afectado.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Resumen general — tarjeta "Total de facturas"
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.despacho_mega_vw_resumen_diario
WITH (security_invoker = on) AS
SELECT
  DATE(d.iniciado_at AT TIME ZONE 'America/Bogota') AS dia,
  d.modo,
  d.estado,
  COUNT(*)                                          AS total_despachos,
  COUNT(DISTINCT d.numero_factura)                  AS total_facturas,
  COUNT(DISTINCT d.operario_id)                     AS operarios_activos,
  SUM(d.total_items)                                AS items_solicitados,
  SUM(d.items_validados)                            AS items_validados,
  AVG(
    EXTRACT(EPOCH FROM (d.finalizado_at - d.iniciado_at)) / 60.0
  ) FILTER (WHERE d.finalizado_at IS NOT NULL)      AS minutos_promedio
FROM public.despacho_mega_despachos d
WHERE d.estado <> 'cancelado'
GROUP BY 1, 2, 3;

-- ---------------------------------------------------------------------------
-- Despachos por usuario
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.despacho_mega_vw_por_operario
WITH (security_invoker = on) AS
SELECT
  o.id                                              AS operario_id,
  o.nombre,
  o.correo,
  o.sede,
  d.modo,
  DATE(d.iniciado_at AT TIME ZONE 'America/Bogota') AS dia,
  COUNT(*)                                          AS despachos,
  COUNT(*) FILTER (WHERE d.estado IN ('completado', 'aprobado')) AS despachos_ok,
  COUNT(*) FILTER (WHERE d.estado = 'con_novedad')  AS despachos_con_novedad,
  SUM(d.items_validados)                            AS items_validados,
  AVG(
    EXTRACT(EPOCH FROM (d.finalizado_at - d.iniciado_at)) / 60.0
  ) FILTER (WHERE d.finalizado_at IS NOT NULL)      AS minutos_promedio
FROM public.despacho_mega_despachos d
JOIN public.despacho_mega_operarios o ON o.id = d.operario_id
WHERE d.estado <> 'cancelado'
GROUP BY 1, 2, 3, 4, 5, 6;

-- ---------------------------------------------------------------------------
-- Productos mas despachados
-- ---------------------------------------------------------------------------
-- OJO CON EL NOMBRE: el requerimiento dice "productos que mas se venden", pero
-- esta vista mide lo que mas SALE POR DESPACHO, que no es lo mismo que ventas
-- (una venta puede no pasar por aca). Si se necesita venta real, la fuente es
-- Siesa, no esta tabla.
CREATE OR REPLACE VIEW public.despacho_mega_vw_productos_top
WITH (security_invoker = on) AS
SELECT
  i.codigo_item,
  MAX(i.descripcion)                                AS descripcion,
  DATE(d.iniciado_at AT TIME ZONE 'America/Bogota') AS dia,
  COUNT(DISTINCT d.id)                              AS apariciones_en_despachos,
  SUM(i.cantidad_solicitada)                        AS cantidad_solicitada,
  SUM(i.cantidad_validada)                          AS cantidad_despachada,
  SUM(i.cantidad_solicitada - i.cantidad_validada)  AS cantidad_faltante
FROM public.despacho_mega_despacho_items i
JOIN public.despacho_mega_despachos d ON d.id = i.despacho_id
WHERE d.estado <> 'cancelado'
GROUP BY 1, 3;

-- ---------------------------------------------------------------------------
-- Picos de trabajo
-- ---------------------------------------------------------------------------
-- Se calcula sobre `escaneos`, no sobre `despachos`: un despacho que arranca a
-- las 8 y cierra a las 11 no dice en que hora estuvo el esfuerzo. Los escaneos
-- si — cada uno es una accion fechada.
CREATE OR REPLACE VIEW public.despacho_mega_vw_picos_trabajo
WITH (security_invoker = on) AS
SELECT
  DATE(e.created_at AT TIME ZONE 'America/Bogota')                     AS dia,
  EXTRACT(DOW  FROM e.created_at AT TIME ZONE 'America/Bogota')::INT   AS dia_semana,
  EXTRACT(HOUR FROM e.created_at AT TIME ZONE 'America/Bogota')::INT   AS hora,
  COUNT(*)                                                             AS escaneos,
  COUNT(*) FILTER (WHERE e.resultado = 'aceptado')                     AS escaneos_ok,
  COUNT(*) FILTER (WHERE e.resultado <> 'aceptado')                    AS escaneos_con_error,
  COUNT(DISTINCT e.operario_id)                                        AS operarios,
  COUNT(DISTINCT e.despacho_id)                                        AS despachos
FROM public.despacho_mega_escaneos e
GROUP BY 1, 2, 3;

-- ---------------------------------------------------------------------------
-- Novedades de inventario
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.despacho_mega_vw_novedades_inventario
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
  d.modo,
  o.nombre                                          AS reportada_por_nombre,
  o.correo                                          AS reportada_por_correo,
  DATE(a.created_at AT TIME ZONE 'America/Bogota')  AS dia
FROM public.despacho_mega_alertas_inventario a
JOIN public.despacho_mega_despachos d ON d.id = a.despacho_id
JOIN public.despacho_mega_operarios o ON o.id = a.reportada_por;
