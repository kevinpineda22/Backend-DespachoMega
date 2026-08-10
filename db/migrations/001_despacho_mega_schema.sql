-- ===========================================================================
-- Despacho Mega — Esquema base
-- ===========================================================================
-- CONVENCION DE NOMBRES
-- El proyecto Supabase es COMPARTIDO por varios modulos (ecommerce, traslados,
-- inventario, siesa_*). Para que nada se cruce, TODO objeto de este modulo
-- lleva el prefijo `despacho_mega_`: tablas, tipos, indices, vistas, funciones
-- y politicas. No crear objetos de este modulo sin ese prefijo.
--
-- Ejecutar en orden: 001 -> 002 (vistas) -> 003 (RLS).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Tipos enumerados
-- ---------------------------------------------------------------------------

-- Rol dentro del modulo. Se guarda ACA y no en `profiles.role` porque
-- `profiles.role` gobierna el menu de toda la intranet: reutilizarlo obligaria
-- a inventar roles globales ("admin_despacho_mega") para una decision que solo
-- le importa a este modulo. Aca la pregunta "¿este correo es admin de Despacho
-- Mega?" se responde con una sola lectura y sin efectos en otros paneles.
DO $despacho_mega$ BEGIN
  CREATE TYPE despacho_mega_rol AS ENUM ('operario', 'admin'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $despacho_mega$;

-- Que procesos puede ejecutar un operario. `ambos` evita tener que duplicar
-- el registro cuando la misma persona pickea y audita segun el turno.
DO $despacho_mega$ BEGIN
  CREATE TYPE despacho_mega_modo_operario AS ENUM ('picking', 'auditoria', 'ambos'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $despacho_mega$;

-- Proceso concreto de una sesion de trabajo sobre una factura.
DO $despacho_mega$ BEGIN
  CREATE TYPE despacho_mega_modo AS ENUM ('picking', 'auditoria'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $despacho_mega$;

DO $despacho_mega$ BEGIN
  CREATE TYPE despacho_mega_estado AS ENUM ('en_proceso',   -- el operario esta escaneando
  'con_novedad',  -- termino pero quedaron faltantes / alertas abiertas
  'completado',   -- termino y cuadro contra la factura
  'aprobado',     -- un admin lo valido
  'rechazado',    -- un admin lo devolvio
  'cancelado'     -- se abandono; libera el numero de factura para reintentar
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $despacho_mega$;

-- NO existe 'sobrante' y es una decision del negocio, no un olvido: no se
-- permite validar mas de lo que dice la factura. Un escaneo que excede la
-- cantidad se RECHAZA (queda como `excede_cantidad` en `despacho_mega_escaneos`)
-- y la linea nunca supera lo solicitado. Si algun dia cambia esa regla, agregar
-- el valor aca NO alcanza: hay que cambiar `validar()` en despacho.service.js,
-- que es donde vive el rechazo.
DO $despacho_mega$ BEGIN
  CREATE TYPE despacho_mega_estado_item AS ENUM ('pendiente',
  'completo',
  'parcial',
  'faltante'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $despacho_mega$;

DO $despacho_mega$ BEGIN
  CREATE TYPE despacho_mega_metodo_captura AS ENUM ('escaner', 'manual'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $despacho_mega$;

-- Resultado de un intento de validacion. Se guardan TAMBIEN los intentos
-- fallidos: son la evidencia de que el operario escaneo algo que no iba, y
-- alimentan la analitica de errores.
DO $despacho_mega$ BEGIN
  CREATE TYPE despacho_mega_resultado_escaneo AS ENUM ('aceptado',
  'no_pertenece',     -- el codigo no esta en la factura
  'item_completo',    -- ya se habia validado la cantidad total
  'excede_cantidad',  -- el escaneo supera lo solicitado
  'no_encontrado'     -- el codigo de barras no resuelve a ningun item
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $despacho_mega$;

DO $despacho_mega$ BEGIN
  CREATE TYPE despacho_mega_motivo_alerta AS ENUM ('sin_fisico',
  'averiado',
  'ubicacion_errada',
  'diferencia_cantidad',
  'otro'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $despacho_mega$;

DO $despacho_mega$ BEGIN
  CREATE TYPE despacho_mega_estado_alerta AS ENUM ('abierta',
  'en_gestion',
  'resuelta',
  'descartada'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $despacho_mega$;

DO $despacho_mega$ BEGIN
  CREATE TYPE despacho_mega_decision AS ENUM ('aprobado', 'rechazado'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $despacho_mega$;

-- ---------------------------------------------------------------------------
-- Funcion de apoyo: updated_at
-- ---------------------------------------------------------------------------
-- Prefijada a proposito: `update_modified_column()` ya existe en este proyecto
-- (la creo el modulo de items de Siesa) y redefinirla afectaria a ese modulo.
CREATE OR REPLACE FUNCTION despacho_mega_touch_updated_at()
RETURNS TRIGGER AS $despacho_mega$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$despacho_mega$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 1. Operarios
-- ---------------------------------------------------------------------------
-- Un operario es un usuario de Supabase Auth habilitado para este modulo.
-- La tabla NO reemplaza a `profiles`: la complementa. `profiles` dice quien es
-- la persona en la empresa; esta dice que puede hacer dentro de Despacho Mega.
CREATE TABLE IF NOT EXISTS public.despacho_mega_operarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  correo        TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  documento     TEXT,
  rol           despacho_mega_rol NOT NULL DEFAULT 'operario',
  modo_habilitado despacho_mega_modo_operario NOT NULL DEFAULT 'ambos',
  sede          TEXT,
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  creado_por    UUID REFERENCES auth.users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- El correo llega del login y se compara crudo en varios lugares. Guardarlo en
-- minuscula evita que "Juan@..." y "juan@..." se traten como dos personas.
CREATE UNIQUE INDEX IF NOT EXISTS despacho_mega_operarios_correo_lower_idx
  ON public.despacho_mega_operarios (LOWER(correo));

CREATE INDEX IF NOT EXISTS despacho_mega_operarios_activo_idx
  ON public.despacho_mega_operarios (activo) WHERE activo = TRUE;

DROP TRIGGER IF EXISTS despacho_mega_operarios_touch ON public.despacho_mega_operarios;
CREATE TRIGGER despacho_mega_operarios_touch
  BEFORE UPDATE ON public.despacho_mega_operarios
  FOR EACH ROW EXECUTE FUNCTION despacho_mega_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Despachos (una sesion de trabajo sobre una factura)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.despacho_mega_despachos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_factura  TEXT NOT NULL,
  tipo_documento  TEXT,
  fecha_factura   DATE,
  modo            despacho_mega_modo NOT NULL,
  estado          despacho_mega_estado NOT NULL DEFAULT 'en_proceso',
  operario_id     UUID NOT NULL REFERENCES public.despacho_mega_operarios(id),

  cliente_nit     TEXT,
  cliente_nombre  TEXT,
  sede            TEXT,
  bodega          TEXT,

  total_items     INTEGER NOT NULL DEFAULT 0,
  items_validados INTEGER NOT NULL DEFAULT 0,

  -- Respuesta cruda de Siesa al abrir la factura. Es la foto del momento: si
  -- manana la factura cambia en Siesa, el despacho sigue siendo auditable
  -- contra lo que el operario realmente vio.
  snapshot_siesa  JSONB,

  observaciones   TEXT,
  iniciado_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalizado_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Una factura se pickea una vez y se audita una vez. Los cancelados quedan
-- fuera del indice a proposito: si algo salio mal, se cancela y se reintenta
-- sin tener que borrar historial.
CREATE UNIQUE INDEX IF NOT EXISTS despacho_mega_despachos_factura_modo_idx
  ON public.despacho_mega_despachos (numero_factura, modo)
  WHERE estado <> 'cancelado';

CREATE INDEX IF NOT EXISTS despacho_mega_despachos_operario_idx
  ON public.despacho_mega_despachos (operario_id, iniciado_at DESC);

CREATE INDEX IF NOT EXISTS despacho_mega_despachos_estado_idx
  ON public.despacho_mega_despachos (estado, iniciado_at DESC);

CREATE INDEX IF NOT EXISTS despacho_mega_despachos_iniciado_idx
  ON public.despacho_mega_despachos (iniciado_at DESC);

DROP TRIGGER IF EXISTS despacho_mega_despachos_touch ON public.despacho_mega_despachos;
CREATE TRIGGER despacho_mega_despachos_touch
  BEFORE UPDATE ON public.despacho_mega_despachos
  FOR EACH ROW EXECUTE FUNCTION despacho_mega_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Items del despacho
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.despacho_mega_despacho_items (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  despacho_id         UUID NOT NULL REFERENCES public.despacho_mega_despachos(id) ON DELETE CASCADE,
  linea               INTEGER NOT NULL,
  codigo_item         TEXT NOT NULL,          -- f120_id de Siesa
  descripcion         TEXT,
  unidad              TEXT,
  cantidad_solicitada NUMERIC(14,3) NOT NULL,
  cantidad_validada   NUMERIC(14,3) NOT NULL DEFAULT 0,
  precio_unitario     NUMERIC(14,2),
  estado_item         despacho_mega_estado_item NOT NULL DEFAULT 'pendiente',
  validado_por        UUID REFERENCES public.despacho_mega_operarios(id),
  validado_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT despacho_mega_items_linea_unica UNIQUE (despacho_id, linea)
);

-- Una factura puede repetir el mismo item en dos lineas (precios o lotes
-- distintos). Por eso la unicidad es por linea, no por codigo, y este indice
-- es de busqueda, no de restriccion.
CREATE INDEX IF NOT EXISTS despacho_mega_items_codigo_idx
  ON public.despacho_mega_despacho_items (despacho_id, codigo_item);

CREATE INDEX IF NOT EXISTS despacho_mega_items_codigo_global_idx
  ON public.despacho_mega_despacho_items (codigo_item);

DROP TRIGGER IF EXISTS despacho_mega_items_touch ON public.despacho_mega_despacho_items;
CREATE TRIGGER despacho_mega_items_touch
  BEFORE UPDATE ON public.despacho_mega_despacho_items
  FOR EACH ROW EXECUTE FUNCTION despacho_mega_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Escaneos (trazabilidad fina)
-- ---------------------------------------------------------------------------
-- Cada intento de validacion, incluidos los rechazados. Es la fuente del
-- "historial por usuario" y de la analitica de picos de trabajo.
CREATE TABLE IF NOT EXISTS public.despacho_mega_escaneos (
  id                    BIGSERIAL PRIMARY KEY,
  despacho_id           UUID NOT NULL REFERENCES public.despacho_mega_despachos(id) ON DELETE CASCADE,
  item_id               UUID REFERENCES public.despacho_mega_despacho_items(id) ON DELETE SET NULL,
  operario_id           UUID NOT NULL REFERENCES public.despacho_mega_operarios(id),
  codigo_ingresado      TEXT NOT NULL,
  codigo_item_resuelto  TEXT,
  metodo                despacho_mega_metodo_captura NOT NULL,
  resultado             despacho_mega_resultado_escaneo NOT NULL,
  cantidad              NUMERIC(14,3) NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS despacho_mega_escaneos_despacho_idx
  ON public.despacho_mega_escaneos (despacho_id, created_at DESC);

CREATE INDEX IF NOT EXISTS despacho_mega_escaneos_operario_idx
  ON public.despacho_mega_escaneos (operario_id, created_at DESC);

CREATE INDEX IF NOT EXISTS despacho_mega_escaneos_created_idx
  ON public.despacho_mega_escaneos (created_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Alertas a inventario
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.despacho_mega_alertas_inventario (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  despacho_id       UUID NOT NULL REFERENCES public.despacho_mega_despachos(id) ON DELETE CASCADE,
  item_id           UUID REFERENCES public.despacho_mega_despacho_items(id) ON DELETE SET NULL,
  codigo_item       TEXT NOT NULL,
  descripcion       TEXT,
  cantidad_faltante NUMERIC(14,3) NOT NULL,
  motivo            despacho_mega_motivo_alerta NOT NULL,
  comentario        TEXT,
  estado            despacho_mega_estado_alerta NOT NULL DEFAULT 'abierta',
  reportada_por     UUID NOT NULL REFERENCES public.despacho_mega_operarios(id),
  atendida_por      UUID REFERENCES auth.users(id),
  respuesta         TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resuelta_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS despacho_mega_alertas_estado_idx
  ON public.despacho_mega_alertas_inventario (estado, created_at DESC);

CREATE INDEX IF NOT EXISTS despacho_mega_alertas_despacho_idx
  ON public.despacho_mega_alertas_inventario (despacho_id);

CREATE INDEX IF NOT EXISTS despacho_mega_alertas_codigo_idx
  ON public.despacho_mega_alertas_inventario (codigo_item, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. Aprobaciones del administrador
-- ---------------------------------------------------------------------------
-- `item_id` NULL significa que la decision aplica al despacho completo.
CREATE TABLE IF NOT EXISTS public.despacho_mega_aprobaciones (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  despacho_id   UUID NOT NULL REFERENCES public.despacho_mega_despachos(id) ON DELETE CASCADE,
  item_id       UUID REFERENCES public.despacho_mega_despacho_items(id) ON DELETE CASCADE,
  admin_user_id UUID NOT NULL REFERENCES auth.users(id),
  admin_correo  TEXT NOT NULL,
  decision      despacho_mega_decision NOT NULL,
  observacion   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS despacho_mega_aprobaciones_despacho_idx
  ON public.despacho_mega_aprobaciones (despacho_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. Bitacora de eventos
-- ---------------------------------------------------------------------------
-- Log append-only de todo lo que pasa en el modulo. Los escaneos ya tienen su
-- tabla; esta guarda el resto (abrir factura, finalizar, aprobar, crear
-- operario) para poder reconstruir "quien hizo que" sin cruzar cinco tablas.
CREATE TABLE IF NOT EXISTS public.despacho_mega_eventos (
  id             BIGSERIAL PRIMARY KEY,
  despacho_id    UUID REFERENCES public.despacho_mega_despachos(id) ON DELETE CASCADE,
  actor_user_id  UUID REFERENCES auth.users(id),
  actor_correo   TEXT,
  evento         TEXT NOT NULL,
  payload        JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS despacho_mega_eventos_despacho_idx
  ON public.despacho_mega_eventos (despacho_id, created_at DESC);

CREATE INDEX IF NOT EXISTS despacho_mega_eventos_actor_idx
  ON public.despacho_mega_eventos (actor_correo, created_at DESC);

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
-- El panel admin escucha estas tres tablas para el monitor en vivo.
--
-- GUARDADO A PROPOSITO. Un `ALTER PUBLICATION ... ADD TABLE` pelado revienta en
-- tres casos reales, y como la migracion corre dentro de una transaccion, ese
-- error aborta TODO lo anterior:
--   1. La publicacion `supabase_realtime` no existe todavia.
--   2. Esta definida como FOR ALL TABLES (no admite ADD TABLE).
--   3. La tabla ya es miembro, por una corrida previa.
--
-- Realtime es una comodidad del panel, no un requisito del modulo: si no se
-- puede publicar, el resto del esquema tiene que quedar igual.
DO $despacho_mega$
DECLARE
  t TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'Sin publicacion supabase_realtime: el monitor en vivo no recibira eventos.';
    RETURN;
  END IF;

  IF (SELECT puballtables FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'supabase_realtime es FOR ALL TABLES: las tablas ya quedan publicadas.';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY[
    'despacho_mega_despachos',
    'despacho_mega_despacho_items',
    'despacho_mega_alertas_inventario'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $despacho_mega$;

-- ---------------------------------------------------------------------------
-- Comentarios
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.despacho_mega_operarios IS 'Usuarios habilitados en Despacho Mega y el proceso que pueden ejecutar.';
COMMENT ON TABLE public.despacho_mega_despachos IS 'Sesion de picking o auditoria sobre una factura de Siesa.';
COMMENT ON TABLE public.despacho_mega_despacho_items IS 'Lineas de la factura con su avance de validacion.';
COMMENT ON TABLE public.despacho_mega_escaneos IS 'Cada intento de validacion, aceptado o rechazado.';
COMMENT ON TABLE public.despacho_mega_alertas_inventario IS 'Novedades reportadas a inventario durante el despacho.';
COMMENT ON TABLE public.despacho_mega_aprobaciones IS 'Decisiones del administrador sobre un despacho o una linea.';
COMMENT ON TABLE public.despacho_mega_eventos IS 'Bitacora append-only del modulo.';
