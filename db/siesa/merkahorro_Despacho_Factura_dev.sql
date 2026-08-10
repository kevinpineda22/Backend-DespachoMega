-- ===========================================================================
-- merkahorro_Despacho_Factura_dev  —  consulta Connekta de Despacho Mega
-- ===========================================================================
-- Documentos de venta POS de Megamayoristas (Cia 2) de los ultimos N dias.
-- La consume el backend en `src/services/facturaSiesa.service.js`.
--
-- VERSION CON COLUMNAS DE DIAGNOSTICO
-- `FechaServidor` y `CorteAplicado` no las usa el backend: estan para que la
-- respuesta diga por si misma que fecha cree el servidor que es hoy y desde
-- que dia esta filtrando. Sin eso, un cambio que no se publica se confunde con
-- un filtro que no funciona — y son problemas distintos.
--
-- Como leer el resultado:
--   * Si las dos columnas NO aparecen -> el cambio no se publico en Connekta.
--   * Si aparecen y CorteAplicado es de hace 30 dias pero igual no llegan
--     datos viejos -> el problema es la comparacion de fechas del WHERE
--     (ver la nota al final del archivo).
--
-- Se pueden dejar puestas: el backend ignora las columnas que no conoce, y
-- tener a mano la fecha del servidor ahorra este mismo diagnostico la proxima
-- vez.
-- ===========================================================================

SELECT
-- --- DIAGNOSTICO (se pueden quitar cuando ya no hagan falta) -------------
CONVERT(varchar(8), GETDATE(), 112)                          AS FechaServidor,
CONVERT(varchar(8), DATEADD(day, -30, GETDATE()), 112)       AS CorteAplicado,
-- ------------------------------------------------------------------------
dbo.t9820_pdv_d_doctos.f9820_id_cia                         AS Cia,
dbo.t9820_pdv_d_doctos.f9820_id_co                          AS CoDoc,
dbo.t9820_pdv_d_doctos.f9820_id_tipo_docto                  AS ID_TIPO_DOCTO,
dbo.t9820_pdv_d_doctos.f9820_consec_docto                   AS CONSEC_DOCTO,
dbo.t9830_pdv_d_movto_venta.f9830_id_concepto               AS Concepto,
dbo.t9820_pdv_d_doctos.f9820_id_fecha_docto                 AS FECHA_DOCTO,
dbo.t9820_pdv_d_doctos.[f9820_id_clase_docto]               AS ID_CLASE_DOCTO,
dbo.t9820_pdv_d_doctos.[f9820_id_cond_pago]                 AS id_cond_pago,
dbo.t9830_pdv_d_movto_venta.f9830_id_motivo                 AS IDMotivo,
dbo.t9820_pdv_d_doctos.f9820_ind_estado                     AS IndEstado,
dbo.t9820_pdv_d_doctos.f9820_valor_bruto                    AS VrBrutoDocto,
dbo.t9820_pdv_d_doctos.f9820_valor_dscto_linea              AS ValorDsctoDocto,
dbo.t9820_pdv_d_doctos.f9820_valor_dscto_global             AS ValorDsctoGlobalDocto,
dbo.t9820_pdv_d_doctos.f9820_valor_imp                      AS VrImptoDocto,
dbo.t9820_pdv_d_doctos.f9820_valor_neto                     AS VrNetoDocto,
dbo.t9830_pdv_d_movto_venta.f9830_cant_1                    AS CANTIDAD,
dbo.t9830_pdv_d_movto_venta.f9830_precio_uni                AS PrecioUnitDet,
dbo.t9830_pdv_d_movto_venta.f9830_vlr_bruto                 AS VALOR_BRUTO,
dbo.t9830_pdv_d_movto_venta.f9830_vlr_dscto_linea           AS DsctoLineaDet,
dbo.t9830_pdv_d_movto_venta.f9830_vlr_dscto_global          AS VrDsctoGlobalDet,
dbo.t9830_pdv_d_movto_venta.f9830_vlr_imp                   AS VrImptoDet,
dbo.t9830_pdv_d_movto_venta.f9830_vlr_neto                  AS VrnetoDet,
dbo.t9740_pdv_clientes.f9740_id                             AS IdTercero,
dbo.t9740_pdv_clientes.f9740_nit                            AS NitTercero,
dbo.t9740_pdv_clientes.f9740_razon_social                   AS RazonSocial,
dbo.t150_mc_bodegas.f150_id                                 AS BODEGA,
dbo.t150_mc_bodegas.f150_descripcion                        AS DescBodega,
dbo.t9830_pdv_d_movto_venta.f9830_id_concepto               AS id_concepto,
dbo.t9830_pdv_d_movto_venta.f9830_id_motivo                 AS id_motivo,
dbo.t9830_pdv_d_movto_venta.[f9830_id_unidad_medida]        AS UNIDAD_MEDIDA,
dbo.v121.[v121_id_item]                                     AS id_item,
dbo.v121.v121_descripcion                                   AS DescItem,
--CAMPOS SECCION DE DESCUENTO
DSCTO.[f9831_vlr_uni]                                       AS vlr_uni_dscto,
DSCTO.[f9831_vlr_tot]                                       AS vlr_tot_dscto,
dbo.t9830_pdv_d_movto_venta.[f9830_guid]                    AS RowidMvto,
CASE LTRIM(RTRIM(dbo.v121.v121_id_tipo_inv_serv))
    WHEN 'INCERAB04' THEN '001'
    WHEN 'INEXCAB01' THEN '001'
    WHEN 'INEXCCA01' THEN '003'
    WHEN 'INEXCFR01' THEN '002'
    WHEN 'INEXEAB02' THEN '001'
    WHEN 'ING05AB03' THEN '001'
    WHEN 'ING19AB04' THEN '001'
    WHEN 'ING19CA04' THEN '003'
    WHEN 'ING19FR04' THEN '002'
    WHEN 'INGASAB04' THEN '001'
    ELSE NULL
END AS unidad_de_negocio

FROM
dbo.t9820_pdv_d_doctos
INNER JOIN
dbo.t9830_pdv_d_movto_venta
ON dbo.t9820_pdv_d_doctos.f9820_guid = dbo.t9830_pdv_d_movto_venta.f9830_guid_docto AND dbo.t9820_pdv_d_doctos.f9820_id_cia = dbo.t9830_pdv_d_movto_venta.f9830_id_cia
INNER JOIN
dbo.t9740_pdv_clientes
ON dbo.t9820_pdv_d_doctos.f9820_id_cia = dbo.t9740_pdv_clientes.f9740_id_cia AND dbo.t9820_pdv_d_doctos.f9820_id_cliente_pdv = dbo.t9740_pdv_clientes.f9740_id

INNER JOIN
dbo.t150_mc_bodegas
ON dbo.t9830_pdv_d_movto_venta.f9830_rowid_bodega = dbo.t150_mc_bodegas.f150_rowid AND dbo.t9830_pdv_d_movto_venta.f9830_id_cia = dbo.t150_mc_bodegas.f150_id_cia
INNER JOIN
dbo.v121 ON dbo.t9830_pdv_d_movto_venta.f9830_rowid_item_ext = dbo.v121.v121_rowid_item_ext AND dbo.t9830_pdv_d_movto_venta.f9830_id_cia = dbo.v121.v121_id_cia
LEFT OUTER JOIN
dbo.t9831_pdv_d_movto_venta_dscto DSCTO ON dbo.t9830_pdv_d_movto_venta.f9830_guid = DSCTO.f9831_guid_movto AND DSCTO.f9831_id_cia = dbo.t9830_pdv_d_movto_venta.f9830_id_cia
WHERE
CAST(dbo.t9820_pdv_d_doctos.f9820_id_fecha_docto AS VARCHAR(8)) >= CONVERT(varchar(8), DATEADD(day, -30, GETDATE()), 112)
AND dbo.t9820_pdv_d_doctos.f9820_id_cliente_pdv <> '222222222222'
AND dbo.t9820_pdv_d_doctos.f9820_id_cia = 2

-- ===========================================================================
-- SI EL DIAGNOSTICO SEÑALA AL WHERE
-- ===========================================================================
-- Es decir: `CorteAplicado` muestra la fecha de hace 30 dias, pero igual no
-- llegan documentos viejos.
--
-- La causa seria el lado izquierdo de la comparacion. `CAST(x AS VARCHAR(8))`
-- solo produce "20260711" si `f9820_id_fecha_docto` es un ENTERO yyyymmdd. Si
-- fuera un datetime, produce "Aug 10 2" —los primeros 8 caracteres del formato
-- por defecto— y comparar ESO contra "20260711" no filtra por fecha: filtra por
-- orden alfabetico, que es cualquier cosa.
--
-- La evidencia dice que hoy es un entero (el filtro recorta bien, y si fuera
-- datetime devolveria todo el historial). Pero la comparacion es fragil y
-- conviene volverla explicita. Reemplazar la primera linea del WHERE por la que
-- corresponda al tipo real de la columna:
--
--   Si es ENTERO yyyymmdd:
--     dbo.t9820_pdv_d_doctos.f9820_id_fecha_docto
--       >= CAST(CONVERT(varchar(8), DATEADD(day, -30, GETDATE()), 112) AS INT)
--
--   Si es DATE o DATETIME:
--     dbo.t9820_pdv_d_doctos.f9820_id_fecha_docto
--       >= CAST(DATEADD(day, -30, GETDATE()) AS DATE)
--
-- Las dos comparan numeros o fechas, no texto. Ninguna depende de cuantos
-- caracteres entran en un VARCHAR(8).
-- ===========================================================================
