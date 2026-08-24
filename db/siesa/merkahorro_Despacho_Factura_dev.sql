-- ===========================================================================
-- merkahorro_Despacho_Factura_dev -- consulta Connekta del modulo Despacho Mega
-- ===========================================================================
-- Esta copia tiene que ser IDENTICA a la publicada en Connekta. Cuando divergen,
-- el repo miente: ya paso, y el diagnostico arranco mirando un WHERE que en
-- produccion era otro.
--
-- CAMBIOS DE ESTA VERSION (24/08/2026), los dos sobre el cliente:
--   1. `t9740_pdv_clientes` pasa de INNER a LEFT.
--   2. Se agrega `t200_mm_terceros` como segunda fuente del cliente.
-- El porque de cada uno esta al final del archivo.
-- ===========================================================================
SELECT
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

-- ---------------------------------------------------------------------------
-- CLIENTE, en tres escalones: POS -> tercero general -> leyenda.
--
-- NULLIF(LTRIM(RTRIM(x)), '') en cada escalon y no COALESCE pelado: estos
-- campos son CHAR de ancho fijo y vienen rellenos con espacios. Un '' o un
-- '   ' NO son NULL, asi que sin esto COALESCE se quedaria con el primer
-- escalon vacio y nunca bajaria al siguiente.
-- ---------------------------------------------------------------------------
COALESCE(
    NULLIF(LTRIM(RTRIM(dbo.t9740_pdv_clientes.f9740_id)), ''),
    NULLIF(LTRIM(RTRIM(T200.f200_id)), ''),
    NULLIF(LTRIM(RTRIM(dbo.t9820_pdv_d_doctos.f9820_id_cliente_pdv)), '')
)                                                           AS IdTercero,

COALESCE(
    NULLIF(LTRIM(RTRIM(dbo.t9740_pdv_clientes.f9740_nit)), ''),
    NULLIF(LTRIM(RTRIM(T200.f200_nit)), ''),
    NULLIF(LTRIM(RTRIM(dbo.t9820_pdv_d_doctos.f9820_id_cliente_pdv)), '')
)                                                           AS NitTercero,

-- `f200_nombre_est` va ANTES que `f200_razon_social`: Siesa lo mantiene ya
-- compuesto --razon social para empresas, apellidos + nombres para personas
-- naturales--. Usando solo razon_social, una persona natural saldria en blanco.
-- Los otros dos son red por si algun tercero viejo lo tiene vacio.
--
-- LA LEYENDA FINAL DICE "SIN CLIENTE EN LA FACTURA" Y NO "NO REGISTRADO".
-- Verificado sobre P09-10976: ahi `f9820_rowid_tercero` es NULL, o sea que la
-- factura se emitio sin asignarle cliente. "No registrado" mandaria a buscar
-- una falla en el maestro de terceros, que es donde NO esta el problema.
--
-- NO USAR `f9820_rowid_tercero_perfil` COMO RESPALDO. Vale 4698 tanto en la
-- 8054 (cuyo cliente real es el rowid 7162) como en la P09-10976 (que no tiene
-- cliente). Es el perfil del punto de venta, no el comprador: usarlo pondria el
-- mismo nombre equivocado en las 22 facturas de P09, que es peor que no poner
-- ninguno. Una factura sin cliente se ve; una con el cliente de otro, no.
COALESCE(
    NULLIF(LTRIM(RTRIM(dbo.t9740_pdv_clientes.f9740_razon_social)), ''),
    NULLIF(LTRIM(RTRIM(T200.f200_nombre_est)), ''),
    NULLIF(LTRIM(RTRIM(T200.f200_razon_social)), ''),
    NULLIF(LTRIM(RTRIM(
        T200.f200_apellido1 + ' ' + T200.f200_apellido2 + ' ' + T200.f200_nombres
    )), ''),
    'SIN CLIENTE EN LA FACTURA'
)                                                           AS RazonSocial,

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

-- LEFT y no INNER: con INNER, un documento sin cliente de POS desaparecia entero.
LEFT OUTER JOIN
dbo.t9740_pdv_clientes
ON dbo.t9820_pdv_d_doctos.f9820_id_cia = dbo.t9740_pdv_clientes.f9740_id_cia AND dbo.t9820_pdv_d_doctos.f9820_id_cliente_pdv = dbo.t9740_pdv_clientes.f9740_id

-- Segunda fuente del cliente. Las ventas a empresa no llevan cliente de POS
-- (`f9820_id_cliente_pdv` viene NULL) y apuntan al maestro general por rowid.
LEFT OUTER JOIN
dbo.t200_mm_terceros T200
ON dbo.t9820_pdv_d_doctos.f9820_rowid_tercero = T200.f200_rowid AND dbo.t9820_pdv_d_doctos.f9820_id_cia = T200.f200_id_cia

INNER JOIN
dbo.t150_mc_bodegas
ON dbo.t9830_pdv_d_movto_venta.f9830_rowid_bodega = dbo.t150_mc_bodegas.f150_rowid AND dbo.t9830_pdv_d_movto_venta.f9830_id_cia = dbo.t150_mc_bodegas.f150_id_cia
INNER JOIN
dbo.v121 ON dbo.t9830_pdv_d_movto_venta.f9830_rowid_item_ext = dbo.v121.v121_rowid_item_ext AND dbo.t9830_pdv_d_movto_venta.f9830_id_cia = dbo.v121.v121_id_cia
LEFT OUTER JOIN
dbo.t9831_pdv_d_movto_venta_dscto DSCTO ON dbo.t9830_pdv_d_movto_venta.f9830_guid = DSCTO.f9831_guid_movto AND DSCTO.f9831_id_cia = dbo.t9830_pdv_d_movto_venta.f9830_id_cia
WHERE
CAST(dbo.t9820_pdv_d_doctos.f9820_id_fecha_docto AS VARCHAR(8)) >= CONVERT(varchar(8), DATEADD(day, -30, GETDATE()), 112)

AND dbo.t9820_pdv_d_doctos.f9820_id_cia = 2

-- ===========================================================================
-- EL DIAGNOSTICO COMPLETO   (24/08/2026)
-- ===========================================================================
-- SINTOMA
-- La factura P08-001-00008054 existia en Siesa --fecha del dia, estado Aprobado,
-- bodega MG001, cliente GRUPO LS MINIMARKET S.A.S-- y el panel de picking
-- respondia "No se encontro la factura".
--
-- CAUSA 1: EL INNER JOIN DE CLIENTES BORRABA LA FACTURA ENTERA
-- `t9740_pdv_clientes` es el maestro de clientes DEL PUNTO DE VENTA. Con INNER
-- JOIN, un documento cuyo `f9820_id_cliente_pdv` no empareja alli desaparece
-- ENTERO: no se pierde una linea, se pierde la factura.
--
-- Y esos documentos no tienen cliente de POS en absoluto: en la 8054,
-- `f9820_id_cliente_pdv` es NULL. Son ventas a EMPRESA, facturadas contra el
-- tercero real y no contra un cliente de mostrador.
--
-- Medido antes del arreglo: 151 documentos en la ventana, CERO con NIT de
-- empresa (9xxxxxxxx) y CERO con S.A.S / LTDA / S.A. en la razon social. En un
-- mayorista que le vende a minimarkets eso no es casualidad: la consulta venia
-- descartando en silencio a toda la clientela empresarial.
--
-- Despues del LEFT: 195 documentos. 44 mas, y aparecieron dos cajas que el
-- modulo nunca habia visto --P09 con 18 documentos y PN9 con 1--.
--
-- CAUSA 2: EL CLIENTE VIVE EN OTRA TABLA
-- Con el LEFT ya llegaban, pero sin nombre: 27 de 195 documentos (14%, unos
-- 5,1 millones) mostraban la leyenda de respaldo. El COALESCE contra
-- `f9820_id_cliente_pdv` no ayudaba porque ese campo tambien es NULL.
--
-- El tercero real esta en `f9820_rowid_tercero` (7162 para la 8054), que apunta
-- a `t200_mm_terceros`. De ahi salen NIT y nombre.
--
-- POR QUE ERA TAN DIFICIL DE VER
-- Un INNER JOIN que no empareja no da error ni deja rastro. La factura no
-- "fallaba": no existia para la consulta. Por eso el sintoma llegaba como "no
-- se encontro" y mandaba a buscar en el numero, en la caja o en la ventana de
-- fechas, que es donde NO estaba.
--
-- POR QUE EL POS VA PRIMERO Y EL TERCERO GENERAL SEGUNDO
-- `t200` probablemente tiene el dato de casi todos, pero ponerlo primero
-- cambiaria el nombre del cliente en los 168 documentos que hoy se ven bien.
-- No se mueve lo que funciona: el maestro del POS manda, y `t200` entra solo
-- donde aquel no tiene nada.
--
-- CONSUMIDOR FINAL SIGUE LLEGANDO
-- Ese cliente SI tiene ficha en el POS, asi que empareja en el primer escalon.
-- Un LEFT solo AGREGA lo que antes se caia; no saca a nadie.
--
-- LO QUE ESTO NO ARREGLA
-- Quedan tres INNER JOIN: `t9830` (lineas), `t150_mc_bodegas` y `v121`. Esos no
-- borran la factura entera, pero SI pueden borrar LINEAS sueltas: un item que
-- no exista en v121 para la cia 2 desaparece del picking y el operario nunca se
-- entera de que falta. La forma de detectarlo es comparar el numero de lineas
-- del panel contra el de Siesa. Si algun dia no cuadra, mirar por ahi primero.
-- ===========================================================================
