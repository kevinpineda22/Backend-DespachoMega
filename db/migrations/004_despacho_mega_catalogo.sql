-- ===========================================================================
-- Despacho Mega — Catalogo de Megamayoristas (Cia 2)
-- ===========================================================================
-- POR QUE TABLAS PROPIAS
-- `items_siesa` / `siesa_codigos_barras` guardan el catalogo de **Merkahorro**
-- (Cia 1): el script de sincronizacion descarta explicitamente todo lo demas.
-- Este modulo despacha **Megamayoristas** (Cia 2). Medido el 6 de agosto de
-- 2026 sobre facturas reales de Mega: de 66 items distintos, solo 36 (55%)
-- existian en `items_siesa`.
--
-- POR QUE LA MISMA ESTRUCTURA, CAMPO POR CAMPO
-- Para que UN solo script sincronice las dos compañias cambiando parametros, y
-- no haya que bifurcar 400 lineas de logica de paginacion y limpieza. Nombres
-- distintos obligarian a mapear columnas por destino; iguales, la unica
-- diferencia es a que tabla se escribe.
--
-- Por eso se conservan los nombres crudos de Siesa (`f120_id`,
-- `f120_descripcion`, `codigo_barras`, `unidad_medida`) aunque sean feos: el
-- costo de traducirlos es mayor que el de leerlos.
--
-- LA UNICA COLUMNA NUEVA: `factor`
-- Sale de `f131_cant_unidad_medida`, que Siesa ya devuelve en
-- `API_v2_ItemsBarras`. Es lo que permite el conteo mixto: escanear el codigo
-- del paquete suma sus unidades de una, escanear la unidad suma 1.
--
-- Ejecutar despues de 001.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Items (espejo de `items_siesa`)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.despacho_mega_items (
  f120_id          INTEGER PRIMARY KEY,
  f120_descripcion VARCHAR(255),
  grupo            VARCHAR(255),
  subgrupo         VARCHAR(255),
  marca            VARCHAR(255),
  activo           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS despacho_mega_items_descripcion_idx
  ON public.despacho_mega_items (f120_descripcion);

CREATE INDEX IF NOT EXISTS despacho_mega_items_activo_idx
  ON public.despacho_mega_items (activo) WHERE activo = TRUE;

DROP TRIGGER IF EXISTS despacho_mega_items_catalogo_touch ON public.despacho_mega_items;
CREATE TRIGGER despacho_mega_items_catalogo_touch
  BEFORE UPDATE ON public.despacho_mega_items
  FOR EACH ROW EXECUTE FUNCTION despacho_mega_touch_updated_at();

-- ---------------------------------------------------------------------------
-- Codigos de barras (espejo de `siesa_codigos_barras` + `factor`)
-- ---------------------------------------------------------------------------
-- `codigo_barras` es UNICO a nivel global, igual que en la tabla de Merkahorro.
-- Es una restriccion fuerte —dos items no pueden compartir un EAN— y el script
-- de sincronizacion ya la respeta descartando repetidos.
--
-- SIN clave foranea a `despacho_mega_items`, a diferencia de lo que uno haria
-- por instinto: el script sube barras e items en pasos separados y una FK
-- convierte cualquier desfase de orden en un lote entero rechazado. La tabla de
-- Merkahorro tampoco la tiene. Los huerfanos simplemente no resuelven al
-- escanear, que es un fallo visible y barato.
CREATE TABLE IF NOT EXISTS public.despacho_mega_codigos_barras (
  id            BIGSERIAL PRIMARY KEY,
  f120_id       INTEGER NOT NULL,
  codigo_barras VARCHAR(100) NOT NULL,
  unidad_medida VARCHAR(20),

  -- Unidades base que suma UN escaneo de este codigo. `f131_cant_unidad_medida`
  -- en Siesa. Default 1: un codigo sin factor conocido vale una unidad, que es
  -- el caso mayoritario y el error mas benigno posible.
  factor        NUMERIC(12,3) NOT NULL DEFAULT 1 CHECK (factor > 0),

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT despacho_mega_codigo_barras_unico UNIQUE (codigo_barras)
);

CREATE INDEX IF NOT EXISTS despacho_mega_codigos_barras_item_idx
  ON public.despacho_mega_codigos_barras (f120_id);

CREATE INDEX IF NOT EXISTS despacho_mega_codigos_barras_lookup_idx
  ON public.despacho_mega_codigos_barras (codigo_barras);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Catalogo de lectura: cualquier usuario autenticado lo consulta (lo necesita
-- el escaner). La escritura queda para el backend y el job de sincronizacion,
-- que usan service_role y por lo tanto ignoran estas politicas.
ALTER TABLE public.despacho_mega_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.despacho_mega_codigos_barras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS despacho_mega_items_catalogo_select ON public.despacho_mega_items;
CREATE POLICY despacho_mega_items_catalogo_select
  ON public.despacho_mega_items FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS despacho_mega_codigos_barras_select ON public.despacho_mega_codigos_barras;
CREATE POLICY despacho_mega_codigos_barras_select
  ON public.despacho_mega_codigos_barras FOR SELECT TO authenticated USING (TRUE);

COMMENT ON TABLE public.despacho_mega_items IS 'Catalogo de items de Megamayoristas (Cia 2). Espejo de items_siesa, que es de Merkahorro (Cia 1).';
COMMENT ON TABLE public.despacho_mega_codigos_barras IS 'Codigos escaneables de Cia 2. `factor` = unidades base que suma un escaneo.';
COMMENT ON COLUMN public.despacho_mega_codigos_barras.factor IS 'f131_cant_unidad_medida de Siesa. Un codigo de paquete P12 vale 12.';
