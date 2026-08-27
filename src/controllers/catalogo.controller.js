import * as catalogoService from "../services/catalogo.service.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Estado de la ultima sincronizacion de catalogo. */
export const estado = asyncHandler(async (_req, res) => {
  const data = await catalogoService.estadoSincronizacion();
  res.json({ ok: true, data });
});

/** Dispara la sincronizacion de items y codigos de barras. */
export const sincronizar = asyncHandler(async (req, res) => {
  const data = await catalogoService.sincronizarCatalogo(req.usuario);
  res.json({ ok: true, data });
});
