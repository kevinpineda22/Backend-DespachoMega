-- ---------------------------------------------------------------------------
-- 010 — Sacar el item 44736 de los despachos que quedaron trabados
-- ---------------------------------------------------------------------------
--
-- QUE PASO
-- 44736 "DESPACHO PRODUCTOS" es un concepto administrativo, no un producto:
-- no tiene codigo de barras y nadie lo escanea. Mientras entraba al despacho,
-- ocupaba una linea imposible de validar y el picking nunca llegaba al 100%.
--
-- El codigo ya no lo deja entrar (ver `env.itemsExcluidos` y
-- `normalizarFactura`), pero eso solo aplica a despachos NUEVOS. Los que ya
-- estaban abiertos lo tienen adentro y al reanudarlos se leen de la base, no
-- se recalculan desde Siesa. Esta migracion limpia esos.
--
-- QUE **NO** TOCA, Y POR QUE
-- Solo entra a despachos `en_proceso`, con la linea sin validar y sin ningun
-- escaneo asociado. Al 12/8/2026 eso dejaba 10 lineas dentro y 3 afuera:
--
--   * factura 47955 — despacho ya completado
--   * facturas 7631 y 47599 — despachos cancelados
--   * una de esas lineas ademas tiene un escaneo ACEPTADO
--
-- Un despacho cerrado es historia: se audita, no se edita. Y una linea con un
-- escaneo aceptado tiene registro real de alguien que la trabajo; borrarla
-- dejaria un escaneo apuntando al vacio.
--
-- ES IDEMPOTENTE. Correrla dos veces no hace nada la segunda: la condicion ya
-- no encuentra filas.
-- ---------------------------------------------------------------------------

BEGIN;

WITH objetivo AS (
  SELECT i.id, i.despacho_id
  FROM public.despacho_mega_despacho_items i
  JOIN public.despacho_mega_despachos d ON d.id = i.despacho_id
  WHERE i.codigo_item = '44736'
    AND d.estado = 'en_proceso'
    AND COALESCE(i.cantidad_validada, 0) = 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.despacho_mega_escaneos e
      WHERE e.item_id = i.id
    )
),
borradas AS (
  DELETE FROM public.despacho_mega_despacho_items
  WHERE id IN (SELECT id FROM objetivo)
  RETURNING despacho_id
),
conteo AS (
  SELECT despacho_id, COUNT(*)::int AS lineas
  FROM borradas
  GROUP BY despacho_id
)
-- `total_items` se fija al crear el despacho y nunca se recalcula. Si se borra
-- una linea sin bajarlo, el despacho pide N y solo existen N-1: nunca cierra.
-- `GREATEST(..., 0)` es una red por si el contador ya venia desfasado.
UPDATE public.despacho_mega_despachos d
SET total_items = GREATEST(d.total_items - c.lineas, 0),
    updated_at  = NOW()
FROM conteo c
WHERE d.id = c.despacho_id;

COMMIT;

-- ---------------------------------------------------------------------------
-- Verificacion — correr aparte despues del COMMIT.
-- ---------------------------------------------------------------------------
-- 1) No debe quedar ningun 44736 en despachos abiertos:
--
--    SELECT d.numero_factura, d.estado, i.cantidad_validada
--    FROM public.despacho_mega_despacho_items i
--    JOIN public.despacho_mega_despachos d ON d.id = i.despacho_id
--    WHERE i.codigo_item = '44736' AND d.estado = 'en_proceso';
--
-- 2) `total_items` debe coincidir con las lineas que existen de verdad:
--
--    SELECT d.numero_factura, d.total_items, COUNT(i.id) AS lineas_reales
--    FROM public.despacho_mega_despachos d
--    LEFT JOIN public.despacho_mega_despacho_items i ON i.despacho_id = d.id
--    WHERE d.estado = 'en_proceso'
--    GROUP BY d.id, d.numero_factura, d.total_items
--    HAVING d.total_items <> COUNT(i.id);
--
--    Las dos consultas tienen que devolver CERO filas.
-- ---------------------------------------------------------------------------
