-- ===========================================================================
-- Despacho Mega — Row Level Security
-- ===========================================================================
-- MODELO DE ESCRITURA
-- El frontend NUNCA escribe directo. Toda mutacion pasa por el backend, que usa
-- `service_role` y por lo tanto ignora RLS. Estas politicas existen por dos
-- razones concretas:
--
--   1. Supabase Realtime respeta RLS. Sin politicas de SELECT, el monitor en
--      vivo del admin no recibe NADA. Con politicas mal hechas, un operario
--      recibiria los despachos de todos.
--   2. Defensa en profundidad: si manana alguien consulta con la anon key,
--      el dato no se cae solo.
--
-- No hay politicas de INSERT/UPDATE/DELETE a proposito: con RLS activo y sin
-- politica, la operacion se niega. Eso es exactamente lo que queremos para
-- cualquier cliente que no sea el backend.
-- ===========================================================================

ALTER TABLE public.despacho_mega_operarios            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.despacho_mega_despachos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.despacho_mega_despacho_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.despacho_mega_escaneos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.despacho_mega_alertas_inventario   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.despacho_mega_aprobaciones         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.despacho_mega_eventos              ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER a proposito: la funcion tiene que poder leer `operarios`
-- aunque quien la llame no tenga permiso sobre esa tabla. Sin esto, la politica
-- que consulta `operarios` para decidir el acceso a `operarios` se muerde la
-- cola y entra en recursion infinita.
-- `search_path` fijo: sin el, un search_path manipulado puede redirigir estas
-- consultas a tablas falsas y la funcion devolveria TRUE para cualquiera.
CREATE OR REPLACE FUNCTION public.despacho_mega_es_admin()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $despacho_mega$
  SELECT EXISTS (
    SELECT 1 FROM public.despacho_mega_operarios
    WHERE user_id = auth.uid() AND rol = 'admin' AND activo
  );
$despacho_mega$;

CREATE OR REPLACE FUNCTION public.despacho_mega_operario_id()
RETURNS UUID
LANGUAGE SQL
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $despacho_mega$
  SELECT id FROM public.despacho_mega_operarios
  WHERE user_id = auth.uid() AND activo
  LIMIT 1;
$despacho_mega$;

-- ---------------------------------------------------------------------------
-- Operarios
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS despacho_mega_operarios_select_propio ON public.despacho_mega_operarios;
CREATE POLICY despacho_mega_operarios_select_propio
  ON public.despacho_mega_operarios FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS despacho_mega_operarios_select_admin ON public.despacho_mega_operarios;
CREATE POLICY despacho_mega_operarios_select_admin
  ON public.despacho_mega_operarios FOR SELECT TO authenticated
  USING (public.despacho_mega_es_admin());

-- ---------------------------------------------------------------------------
-- Despachos
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS despacho_mega_despachos_select_propio ON public.despacho_mega_despachos;
CREATE POLICY despacho_mega_despachos_select_propio
  ON public.despacho_mega_despachos FOR SELECT TO authenticated
  USING (operario_id = public.despacho_mega_operario_id());

DROP POLICY IF EXISTS despacho_mega_despachos_select_admin ON public.despacho_mega_despachos;
CREATE POLICY despacho_mega_despachos_select_admin
  ON public.despacho_mega_despachos FOR SELECT TO authenticated
  USING (public.despacho_mega_es_admin());

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS despacho_mega_items_select ON public.despacho_mega_despacho_items;
CREATE POLICY despacho_mega_items_select
  ON public.despacho_mega_despacho_items FOR SELECT TO authenticated
  USING (
    public.despacho_mega_es_admin()
    OR EXISTS (
      SELECT 1 FROM public.despacho_mega_despachos d
      WHERE d.id = despacho_id
        AND d.operario_id = public.despacho_mega_operario_id()
    )
  );

-- ---------------------------------------------------------------------------
-- Escaneos
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS despacho_mega_escaneos_select ON public.despacho_mega_escaneos;
CREATE POLICY despacho_mega_escaneos_select
  ON public.despacho_mega_escaneos FOR SELECT TO authenticated
  USING (
    public.despacho_mega_es_admin()
    OR operario_id = public.despacho_mega_operario_id()
  );

-- ---------------------------------------------------------------------------
-- Alertas de inventario
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS despacho_mega_alertas_select ON public.despacho_mega_alertas_inventario;
CREATE POLICY despacho_mega_alertas_select
  ON public.despacho_mega_alertas_inventario FOR SELECT TO authenticated
  USING (
    public.despacho_mega_es_admin()
    OR reportada_por = public.despacho_mega_operario_id()
  );

-- ---------------------------------------------------------------------------
-- Aprobaciones y bitacora — solo admin
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS despacho_mega_aprobaciones_select_admin ON public.despacho_mega_aprobaciones;
CREATE POLICY despacho_mega_aprobaciones_select_admin
  ON public.despacho_mega_aprobaciones FOR SELECT TO authenticated
  USING (public.despacho_mega_es_admin());

DROP POLICY IF EXISTS despacho_mega_eventos_select_admin ON public.despacho_mega_eventos;
CREATE POLICY despacho_mega_eventos_select_admin
  ON public.despacho_mega_eventos FOR SELECT TO authenticated
  USING (public.despacho_mega_es_admin());
