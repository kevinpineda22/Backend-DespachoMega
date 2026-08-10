-- ===========================================================================
-- Despacho Mega — La auditoria apunta al picking que verifica
-- ===========================================================================
-- REGLA DE NEGOCIO
-- Una auditoria no se abre contra la factura: se abre contra un picking YA
-- FINALIZADO. Auditar una factura que nadie alisto no verifica nada — solo
-- vuelve a contar lo mismo, y encima da la impresion de que hubo control.
--
-- Por eso la auditoria guarda a que picking corresponde. Sin este vinculo:
--   * el auditor no puede ver que valido el picker, que es justamente contra
--     lo que tiene que comparar;
--   * el administrador no puede reconstruir la pareja alistado/verificado de
--     una factura sin cruzar por numero y modo, que es fragil.
--
-- Autorreferencia y no una tabla aparte: es una relacion 1 a 1 entre filas de
-- la misma tabla. Una tabla puente para eso seria ceremonia sin beneficio.
--
-- Ejecutar despues de 001.
-- ===========================================================================

ALTER TABLE public.despacho_mega_despachos
  ADD COLUMN IF NOT EXISTS despacho_origen_id UUID
    REFERENCES public.despacho_mega_despachos(id) ON DELETE SET NULL;

-- ON DELETE SET NULL, no CASCADE: si algun dia se borra un picking, la
-- auditoria y su evidencia (escaneos, alertas) tienen que sobrevivir. Perder
-- el vinculo es aceptable; perder la auditoria no.

COMMENT ON COLUMN public.despacho_mega_despachos.despacho_origen_id IS
  'Solo en modo auditoria: el picking finalizado que esta verificando. NULL en picking.';

-- Busqueda de "que auditoria verifica este picking".
CREATE INDEX IF NOT EXISTS despacho_mega_despachos_origen_idx
  ON public.despacho_mega_despachos (despacho_origen_id)
  WHERE despacho_origen_id IS NOT NULL;
