-- ---------------------------------------------------------------------------
-- 011 — "Cuando se trabaja" medido en FACTURAS, no en escaneos
-- ---------------------------------------------------------------------------
--
-- POR QUE CAMBIA LA UNIDAD
-- El mapa de calor contaba escaneos. Eso mide ESFUERZO, no VOLUMEN: una factura
-- de 70 lineas pinta la celda igual que 20 facturas de 3 lineas, y para decidir
-- cuanta gente poner un martes lo que importa es cuantas facturas entran.
--
-- Un escaneo tampoco es una unidad estable: un producto mal leido se escanea
-- tres veces y suma tres. La factura es la unidad real del trabajo.
--
-- ---------------------------------------------------------------------------
-- EL DETALLE QUE HACE FALTA DOS VISTAS Y NO UNA
-- ---------------------------------------------------------------------------
-- Un conteo DISTINTO no se puede sumar. Si una factura se escanea a las 9 y
-- otra vez a las 11, aparece en las dos horas: sumar las celdas de la fila da
-- 2 facturas donde hubo 1.
--
-- Por eso el total del dia NO se calcula sumando la fila. Se calcula aparte,
-- con su propio COUNT(DISTINCT) sobre el dia entero. Las dos vistas responden
-- preguntas distintas y ninguna se deriva de la otra:
--
--   picos_trabajo          -> en que HORAS hubo movimiento (celda del mapa)
--   facturas_por_dia_semana-> cuantas facturas ENTRARON ese dia (total real)
-- ---------------------------------------------------------------------------

-- Se conservan las columnas de escaneos: la calidad de escaneo las usa y
-- sacarlas romperia esa seccion. Se AGREGA `facturas`.
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
  COUNT(DISTINCT e.despacho_id)                                        AS despachos,
  -- Por NUMERO DE FACTURA y no por despacho_id: una misma factura genera dos
  -- despachos (picking y auditoria) y contarlos por separado la duplicaria.
  COUNT(DISTINCT d.numero_factura)                                     AS facturas
FROM public.despacho_mega_escaneos e
JOIN public.despacho_mega_despachos d ON d.id = e.despacho_id
GROUP BY 1, 2, 3;

COMMENT ON VIEW public.despacho_mega_vw_picos_trabajo IS
  'Movimiento por dia y hora. `facturas` es DISTINCT por hora: no sumar la fila para obtener el dia, usar despacho_mega_vw_facturas_por_dia_semana.';

-- ---------------------------------------------------------------------------
-- Facturas que entran por dia
-- ---------------------------------------------------------------------------
-- Se mide sobre `iniciado_at` del despacho y no sobre los escaneos: una factura
-- "entra" cuando alguien la abre, una sola vez. Contarla por escaneos la
-- pondria en cada hora en que se le toco algo.
--
-- Los cancelados quedan afuera, igual que en el resto de las vistas: una
-- factura abierta por error y cancelada no es trabajo que entro.
CREATE OR REPLACE VIEW public.despacho_mega_vw_facturas_por_dia_semana
WITH (security_invoker = on) AS
SELECT
  DATE(d.iniciado_at AT TIME ZONE 'America/Bogota')                    AS dia,
  EXTRACT(DOW FROM d.iniciado_at AT TIME ZONE 'America/Bogota')::INT   AS dia_semana,
  COUNT(DISTINCT d.numero_factura)                                     AS facturas,
  COUNT(DISTINCT d.numero_factura) FILTER (WHERE d.modo = 'picking')   AS facturas_picking,
  COUNT(DISTINCT d.numero_factura) FILTER (WHERE d.modo = 'auditoria') AS facturas_auditoria
FROM public.despacho_mega_despachos d
WHERE d.estado <> 'cancelado'
  AND d.iniciado_at IS NOT NULL
GROUP BY 1, 2;

COMMENT ON VIEW public.despacho_mega_vw_facturas_por_dia_semana IS
  'Facturas distintas abiertas por dia, medidas por iniciado_at. Excluye canceladas.';

-- ---------------------------------------------------------------------------
-- Verificacion — correr aparte.
-- ---------------------------------------------------------------------------
-- El total del dia NUNCA debe salir de sumar las horas. Esta consulta muestra
-- la diferencia; si da 0 en todos lados es casualidad del dato, no una regla:
--
--   SELECT p.dia,
--          SUM(p.facturas) AS sumando_horas,
--          f.facturas      AS distinto_del_dia
--   FROM public.despacho_mega_vw_picos_trabajo p
--   JOIN public.despacho_mega_vw_facturas_por_dia_semana f USING (dia)
--   GROUP BY p.dia, f.facturas
--   HAVING SUM(p.facturas) <> f.facturas;
-- ---------------------------------------------------------------------------
