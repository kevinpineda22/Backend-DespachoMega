-- ===========================================================================
-- Despacho Mega — El control cubre TODO lo facturado, mostrador incluido
-- ===========================================================================
-- QUE CAMBIA Y POR QUE
-- La consulta de Connekta se republico a proposito SIN el filtro
-- `f9820_id_cliente_pdv <> '222222222222'`: el negocio quiere ver todo lo que se
-- factura, no solo lo que sale a un cliente con NIT registrado.
--
-- LOS NUMEROS QUE LO JUSTIFICAN (medidos el 10/8/2026 sobre 4 dias):
--
--   mostrador ........ 1.066 documentos
--   mediana .......... 3 lineas · $76.601
--   PERO ............. 157 documentos con 10+ lineas
--                       37 documentos por encima de $1.000.000
--                       maximo: 48 lineas · $3.669.801
--
-- O sea que "consumidor final" NO es sinonimo de compra chica de contado. Hay
-- pedidos grandes facturados asi, y esos son exactamente los que hay que
-- verificar. Excluirlos habria dejado ciego al control justo donde mas plata
-- hay en juego.
--
-- LO QUE SI HACE FALTA ES PODER SEPARARLOS
-- Sin distinguir, el panel muestra ~270 pendientes por dia y no hay forma de
-- saber si eso es una crisis o la operacion normal del mostrador. `es_mostrador`
-- no descuenta nada: solo permite mirar el mismo dia desde los dos angulos.
-- Si mañana el negocio decide que el mostrador no aplica, ya esta la columna
-- para filtrarlo sin volver a tocar SQL.
--
-- `CREATE OR REPLACE VIEW` solo agrega columnas AL FINAL, con las anteriores en
-- el mismo orden, nombre y tipo. Por eso las definiciones repiten la lista de la
-- migracion 008 tal cual antes de sumar lo nuevo.
-- ===========================================================================

CREATE OR REPLACE VIEW public.despacho_mega_vw_cobertura_dia
WITH (security_invoker = on) AS
SELECT
  s.id,
  s.cia,
  s.co_docto,
  s.tipo_documento,
  s.numero_factura,
  s.fecha_factura,
  s.clase_docto,
  s.ind_estado,
  s.cliente_nit,
  s.cliente_nombre,
  s.bodega,
  s.bodega_nombre,
  s.lineas,
  s.unidades,
  s.valor_neto,
  s.excluida,
  s.motivo_exclusion,
  s.sincronizada_at,

  f.picking_id,
  f.picking_estado,
  f.picking_operario_nombre,
  f.picking_finalizado_at,
  (f.picking_finalizado_at IS NOT NULL)   AS picking_hecho,

  f.auditoria_id,
  f.auditoria_estado,
  f.auditoria_operario_nombre,
  f.auditoria_finalizado_at,
  (f.auditoria_finalizado_at IS NOT NULL) AS auditoria_hecha,

  f.etapa,
  f.novedades_abiertas,
  f.tiene_diferencia,
  f.ultimo_movimiento_at,

  CASE
    WHEN s.excluida                            THEN 'excluida'
    WHEN f.numero_factura IS NULL              THEN 'sin_tocar'
    WHEN f.auditoria_finalizado_at IS NOT NULL THEN 'auditada'
    WHEN f.auditoria_id IS NOT NULL            THEN 'auditando'
    WHEN f.picking_finalizado_at IS NOT NULL   THEN 'alistada'
    ELSE 'alistando'
  END AS cobertura,

  -- --- nuevas ---
  -- Venta a consumidor final. El NIT es un valor centinela de Siesa, no un
  -- documento real: es el cliente generico del punto de venta.
  (s.cliente_nit = '222222222222')  AS es_mostrador,
  -- 1231 = factura · 1250 = las series PN*, con una sola linea y valores chicos
  -- (notas credito). Una devolucion no se alista, asi que conviene poder verla
  -- aparte aunque hoy entre al conteo.
  (s.clase_docto = '1250')          AS es_nota_credito
FROM public.despacho_mega_facturas_dia s
LEFT JOIN public.despacho_mega_vw_facturas f
  ON f.numero_factura = s.numero_factura
 AND (f.tipo_documento IS NULL OR f.tipo_documento = s.tipo_documento);

-- ---------------------------------------------------------------------------
-- Resumen: los mismos totales, abiertos por origen
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.despacho_mega_vw_cobertura_resumen
WITH (security_invoker = on) AS
SELECT
  fecha_factura                                          AS dia,
  COUNT(*)                                               AS facturadas,
  COUNT(*) FILTER (WHERE excluida)                       AS excluidas,
  COUNT(*) FILTER (WHERE NOT excluida)                   AS aplican,
  COUNT(*) FILTER (WHERE NOT excluida AND cobertura = 'sin_tocar')  AS sin_tocar,
  COUNT(*) FILTER (WHERE NOT excluida AND cobertura = 'alistando')  AS alistando,
  COUNT(*) FILTER (WHERE NOT excluida AND picking_hecho)            AS con_picking,
  COUNT(*) FILTER (WHERE NOT excluida AND auditoria_hecha)          AS con_auditoria,
  SUM(valor_neto)                                        AS valor_neto,
  SUM(valor_neto) FILTER (
    WHERE NOT excluida AND cobertura = 'sin_tocar'
  )                                                      AS valor_sin_tocar,
  MAX(sincronizada_at)                                   AS sincronizada_at,

  -- --- nuevas: el mismo dia visto por origen ---
  COUNT(*) FILTER (WHERE es_mostrador)                   AS mostrador,
  COUNT(*) FILTER (WHERE NOT es_mostrador)               AS con_cliente,
  COUNT(*) FILTER (
    WHERE NOT excluida AND es_mostrador AND picking_hecho
  )                                                      AS mostrador_con_picking,
  COUNT(*) FILTER (
    WHERE NOT excluida AND NOT es_mostrador AND picking_hecho
  )                                                      AS con_cliente_con_picking,
  COUNT(*) FILTER (WHERE NOT excluida AND NOT es_mostrador)  AS con_cliente_aplican,
  COUNT(*) FILTER (WHERE NOT excluida AND es_mostrador)      AS mostrador_aplican,
  COUNT(*) FILTER (WHERE es_nota_credito)                AS notas_credito
FROM public.despacho_mega_vw_cobertura_dia
GROUP BY 1;

COMMENT ON VIEW public.despacho_mega_vw_cobertura_resumen IS
  'Semaforo por dia, abierto por origen: mostrador vs cliente identificado.';
