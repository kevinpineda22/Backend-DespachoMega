-- ===========================================================================
-- Despacho Mega — Control de cobertura diaria
-- ===========================================================================
-- LA PREGUNTA QUE RESPONDE
-- "De todas las facturas que Megamayoristas emitio hoy, ¿cuales pasaron por el
-- modulo y cuales quedaron sin tocar?" Hoy no habia forma de saberlo: el modulo
-- solo conoce las facturas que alguien tecleo. Lo que nunca se tecleo es
-- invisible, y es justamente lo que hay que encontrar antes de cerrar el dia.
--
-- Medido el 10 de agosto de 2026: de 36 documentos en la ventana de Siesa, 5
-- tenian picking. El 86% pasaba sin registro y sin que nadie se enterara.
--
-- POR QUE UNA TABLA Y NO CONSULTAR SIESA CADA VEZ
-- Porque Siesa NO GUARDA EL HISTORICO. `t9820_pdv_d_doctos` es staging del punto
-- de venta: los documentos se contabilizan y salen de ahi. Medido el mismo dia,
-- la consulta declara un WHERE de 30 dias y devuelve 4 — no porque el filtro
-- falle, sino porque no existe nada mas viejo (ver docs/PENDIENTES.md §1-ter).
--
-- CONSECUENCIA QUE MANDA SOBRE TODO EL DISEÑO: lo que no se captura dentro de
-- esos ~4 dias se pierde para siempre. Por eso la captura es un CRON diario y no
-- algo que ocurre cuando alguien abre el panel. El boton "sincronizar" del panel
-- es un complemento, nunca el mecanismo.
--
-- LA COBERTURA NO SE GUARDA, SE DERIVA
-- No hay columna `tiene_picking`. Un booleano que hay que acordarse de escribir
-- se desincroniza el dia que alguien cancela un despacho por fuera del flujo. La
-- vista cruza contra `despacho_mega_vw_facturas`, que ya sabe en que etapa va
-- cada factura. Una sola definicion de "esto ya se alisto".
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Snapshot de lo facturado
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.despacho_mega_facturas_dia (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- IDENTIDAD COMPLETA DEL DOCUMENTO, no solo el consecutivo. En Siesa conviven
  -- varias series con numeraciones independientes — medido: P02, P05 y P08 al
  -- mismo tiempo. Hoy no hay consecutivos repetidos entre series (0 colisiones
  -- en 36 documentos), pero la clave correcta es la de Siesa, no la que hoy
  -- alcanza a funcionar.
  cia             INTEGER NOT NULL,
  co_docto        TEXT NOT NULL,
  tipo_documento  TEXT NOT NULL,
  numero_factura  TEXT NOT NULL,

  fecha_factura   DATE NOT NULL,
  clase_docto     TEXT,

  -- `IndEstado` de Siesa. Se guarda SIN interpretarlo: los 36 documentos
  -- medidos traian '1' y no hay una segunda muestra que diga que significa otro
  -- valor. Cuando aparezca uno distinto —una factura anulada, probablemente— hay
  -- que verificar contra Siesa que significa ANTES de usarlo para descontar
  -- pendientes. Mientras tanto, el escape es `excluida`, que es explicito y
  -- queda firmado.
  ind_estado      TEXT,

  cliente_nit     TEXT,
  cliente_nombre  TEXT,
  bodega          TEXT,
  bodega_nombre   TEXT,

  lineas          INTEGER NOT NULL DEFAULT 0,
  unidades        NUMERIC(14,3) NOT NULL DEFAULT 0,
  valor_neto      NUMERIC(16,2),

  -- Valvula de escape con firma. Sin esto, una factura anulada queda pendiente
  -- para siempre y el panel nunca llega a "dia completo" — y un tablero que
  -- nunca puede quedar en verde deja de mirarse a la semana.
  excluida         BOOLEAN NOT NULL DEFAULT FALSE,
  motivo_exclusion TEXT,
  excluida_por     UUID REFERENCES auth.users(id),
  excluida_at      TIMESTAMPTZ,

  sincronizada_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Habilita el upsert: correr el cron dos veces el mismo dia actualiza en vez
  -- de duplicar. Un snapshot que no es idempotente no se puede reintentar, y
  -- reintentar es exactamente lo que hay que poder hacer cuando algo falla.
  CONSTRAINT despacho_mega_facturas_dia_identidad
    UNIQUE (cia, co_docto, tipo_documento, numero_factura)
);

CREATE INDEX IF NOT EXISTS despacho_mega_facturas_dia_fecha_idx
  ON public.despacho_mega_facturas_dia (fecha_factura DESC);

CREATE INDEX IF NOT EXISTS despacho_mega_facturas_dia_numero_idx
  ON public.despacho_mega_facturas_dia (numero_factura);

DROP TRIGGER IF EXISTS despacho_mega_facturas_dia_touch ON public.despacho_mega_facturas_dia;
CREATE TRIGGER despacho_mega_facturas_dia_touch
  BEFORE UPDATE ON public.despacho_mega_facturas_dia
  FOR EACH ROW EXECUTE FUNCTION despacho_mega_touch_updated_at();

COMMENT ON TABLE public.despacho_mega_facturas_dia IS
  'Snapshot diario de lo facturado en Siesa. Existe porque las tablas POS solo conservan ~4 dias.';

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
-- Misma politica que el resto: SELECT para admins, escritura solo por el
-- backend con service_role. La lectura existe para que el panel pueda consultar
-- y, si algun dia se publica en Realtime, para que reciba eventos.
ALTER TABLE public.despacho_mega_facturas_dia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS despacho_mega_facturas_dia_select_admin ON public.despacho_mega_facturas_dia;
CREATE POLICY despacho_mega_facturas_dia_select_admin
  ON public.despacho_mega_facturas_dia FOR SELECT TO authenticated
  USING (public.despacho_mega_es_admin());

-- ---------------------------------------------------------------------------
-- 3. Cobertura — el cruce
-- ---------------------------------------------------------------------------
-- El LEFT JOIN es lo que hace el trabajo: una fila del snapshot sin contraparte
-- en `vw_facturas` es una factura que nadie toco. Eso es lo que se busca.
--
-- EL CRUCE VA POR CONSECUTIVO **Y** SERIE. Hoy cruzar solo por consecutivo
-- funcionaria (0 colisiones medidas), pero el dia que dos series repitan un
-- numero, cruzar de menos marcaria como alistada una factura que nadie toco —
-- el error mas caro que puede cometer este panel. La tolerancia a
-- `tipo_documento` nulo del lado del despacho cubre las filas creadas antes de
-- que ese campo se guardara.
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

  -- "Paso por picking" = el operario lo FINALIZO. Un picking abierto todavia
  -- puede cancelarse, asi que contarlo como cubierto seria mentir en el unico
  -- momento en que el dato importa: el cierre del dia.
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
    WHEN s.excluida                          THEN 'excluida'
    WHEN f.numero_factura IS NULL            THEN 'sin_tocar'
    WHEN f.auditoria_finalizado_at IS NOT NULL THEN 'auditada'
    WHEN f.auditoria_id IS NOT NULL          THEN 'auditando'
    WHEN f.picking_finalizado_at IS NOT NULL THEN 'alistada'
    ELSE 'alistando'
  END AS cobertura

FROM public.despacho_mega_facturas_dia s
LEFT JOIN public.despacho_mega_vw_facturas f
  ON f.numero_factura = s.numero_factura
 AND (f.tipo_documento IS NULL OR f.tipo_documento = s.tipo_documento);

COMMENT ON VIEW public.despacho_mega_vw_cobertura_dia IS
  'Lo facturado en Siesa cruzado contra lo que paso por el modulo. Una fila sin picking es una factura que nadie toco.';

-- ---------------------------------------------------------------------------
-- 4. Resumen por dia — el semaforo
-- ---------------------------------------------------------------------------
-- Todo COUNT(*) sobre una tabla que ya tiene una fila por documento: aditivo por
-- construccion, sin el problema de sumar COUNT(DISTINCT) entre grupos que tuvo
-- la analitica.
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
  MAX(sincronizada_at)                                   AS sincronizada_at
FROM public.despacho_mega_vw_cobertura_dia
GROUP BY 1;

COMMENT ON VIEW public.despacho_mega_vw_cobertura_resumen IS
  'Semaforo por dia: cuantas se facturaron y cuantas pasaron por el modulo.';
