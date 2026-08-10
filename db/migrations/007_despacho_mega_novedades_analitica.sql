-- ===========================================================================
-- Despacho Mega — Novedades y analitica
-- ===========================================================================
-- Tres cosas, todas por la misma razon de fondo: las vistas de analitica
-- agregan POR DIA, y el panel las leia como si fueran totales del rango. Un
-- `COUNT(DISTINCT ...)` por dia NO se puede sumar entre dias, y un promedio de
-- promedios tampoco es el promedio.
--
--   1. `vw_por_operario` gana las dos columnas que faltaban para poder calcular
--      el promedio de minutos correctamente en cualquier rango.
--   2. `vw_novedades_inventario` gana lo que la bandeja necesita y no tenia:
--      quien atendio, el comentario y la respuesta.
--   3. Dos vistas nuevas: novedades agrupadas por item y calidad de escaneo por
--      operario.
--
-- SOBRE `CREATE OR REPLACE VIEW`: solo permite AGREGAR columnas al final, con
-- las anteriores en el mismo orden, nombre y tipo. Por eso las definiciones de
-- abajo repiten la lista original tal cual antes de sumar lo nuevo. Cambiar el
-- orden haria fallar la migracion con "cannot change name of view column".
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Por operario — promedio de minutos calculable en cualquier rango
-- ---------------------------------------------------------------------------
-- `minutos_promedio` ya estaba, pero es un promedio POR DIA. Promediar treinta
-- promedios diarios da un numero que no es el promedio del mes: cada dia pesa
-- igual sin importar si tuvo dos despachos o veinte.
--
-- Con `minutos_totales` y `despachos_finalizados` el backend hace
-- SUM(minutos_totales) / SUM(despachos_finalizados), que si es exacto. Se deja
-- `minutos_promedio` porque es util cuando se mira un solo dia.
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
  ) FILTER (WHERE d.finalizado_at IS NOT NULL)      AS minutos_promedio,
  -- --- nuevas ---
  COUNT(*) FILTER (WHERE d.finalizado_at IS NOT NULL) AS despachos_finalizados,
  COALESCE(SUM(
    EXTRACT(EPOCH FROM (d.finalizado_at - d.iniciado_at)) / 60.0
  ) FILTER (WHERE d.finalizado_at IS NOT NULL), 0)  AS minutos_totales
FROM public.despacho_mega_despachos d
JOIN public.despacho_mega_operarios o ON o.id = d.operario_id
WHERE d.estado <> 'cancelado'
GROUP BY 1, 2, 3, 4, 5, 6;

-- ---------------------------------------------------------------------------
-- 2. Novedades — lo que la bandeja necesita para cerrar el ciclo
-- ---------------------------------------------------------------------------
-- Faltaban `comentario` (lo que escribio el operario), `respuesta` (lo que
-- contesto inventario) y quien atendio. Los tres se venian GUARDANDO desde el
-- primer dia y no habia forma de verlos: cerrar una novedad sin poder leer por
-- que se cerro es cerrar el caso sin expediente.
--
-- `atendida_por` referencia `auth.users`, no `despacho_mega_operarios`, asi que
-- el nombre hay que buscarlo aparte. El LEFT JOIN es por si quien atendio no
-- tiene fila en el modulo.
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
  DATE(a.created_at AT TIME ZONE 'America/Bogota')  AS dia,
  -- --- nuevas ---
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

-- ---------------------------------------------------------------------------
-- 3. Novedades agrupadas por item — de casos sueltos a diagnostico
-- ---------------------------------------------------------------------------
-- Una novedad suelta es un caso. El mismo item faltando ocho veces en la semana
-- NO es un caso: es un problema de inventario. Esta vista es la que convierte
-- la bandeja en diagnostico.
--
-- Se agrupa por item Y DIA a proposito, aunque la pregunta sea por rango: asi
-- el backend filtra por fecha y suma. Y se usa COUNT(*), no
-- COUNT(DISTINCT despacho_id): COUNT(*) es aditivo entre dias y el distinct no
-- lo seria. "Cuantas veces se reporto" es exactamente COUNT(*).
CREATE OR REPLACE VIEW public.despacho_mega_vw_novedades_por_item
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
  -- En auditoria pesa mas: significa que el picking lo dejo pasar.
  COUNT(*) FILTER (WHERE d.modo = 'auditoria')      AS detectadas_en_auditoria,
  SUM(a.cantidad_faltante)                          AS unidades_faltantes
FROM public.despacho_mega_alertas_inventario a
JOIN public.despacho_mega_despachos d ON d.id = a.despacho_id
GROUP BY 1, 3;

-- ---------------------------------------------------------------------------
-- 4. Calidad de escaneo por operario
-- ---------------------------------------------------------------------------
-- Un operario con 30% de rechazos no es lento: le falta capacitacion, o los
-- productos que le tocan estan mal rotulados. Sin abrir el resultado por tipo
-- no se puede distinguir una cosa de la otra, y son problemas de areas
-- distintas:
--
--   no_encontrado   -> el codigo no resuelve: rotulado o catalogo
--   no_pertenece    -> producto equivocado: alistamiento
--   excede_cantidad -> escaneo de mas: ritmo o lector con rebote
--   item_completo   -> reescaneo de algo ya completo: el operario perdio la cuenta
--
-- Todo COUNT(*) y por dia, o sea aditivo: el backend suma el rango sin repetir
-- el error de promediar promedios.
CREATE OR REPLACE VIEW public.despacho_mega_vw_calidad_escaneo
WITH (security_invoker = on) AS
SELECT
  o.id                                              AS operario_id,
  o.nombre,
  o.correo,
  DATE(e.created_at AT TIME ZONE 'America/Bogota')  AS dia,
  COUNT(*)                                          AS escaneos,
  COUNT(*) FILTER (WHERE e.resultado = 'aceptado')  AS aceptados,
  COUNT(*) FILTER (WHERE e.resultado <> 'aceptado') AS rechazados,
  COUNT(*) FILTER (WHERE e.resultado = 'no_encontrado')   AS no_encontrado,
  COUNT(*) FILTER (WHERE e.resultado = 'no_pertenece')    AS no_pertenece,
  COUNT(*) FILTER (WHERE e.resultado = 'excede_cantidad') AS excede_cantidad,
  COUNT(*) FILTER (WHERE e.resultado = 'item_completo')   AS item_completo,
  -- El ingreso manual no es un error, pero un operario que teclea todo puede
  -- tener el lector roto y nadie enterarse.
  COUNT(*) FILTER (WHERE e.metodo = 'manual')       AS manuales
FROM public.despacho_mega_escaneos e
JOIN public.despacho_mega_operarios o ON o.id = e.operario_id
GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW public.despacho_mega_vw_novedades_por_item IS
  'Novedades agrupadas por item y dia. Todo aditivo: el backend suma el rango.';
COMMENT ON VIEW public.despacho_mega_vw_calidad_escaneo IS
  'Aciertos y rechazos de escaneo por operario y dia, abiertos por tipo de rechazo.';
