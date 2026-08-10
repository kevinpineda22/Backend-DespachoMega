import * as operarioService from "../services/operario.service.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const listar = asyncHandler(async (req, res) => {
  const data = await operarioService.listar({
    soloActivos: req.query.activos === "true",
  });
  res.json({ ok: true, data });
});

export const crear = asyncHandler(async (req, res) => {
  const data = await operarioService.crear(req.body, req.usuario);
  res.status(201).json({ ok: true, data });
});

export const actualizar = asyncHandler(async (req, res) => {
  const data = await operarioService.actualizar(req.params.id, req.body, req.usuario);
  res.json({ ok: true, data });
});

/** Identidad del usuario logueado, ya resuelta por `requireAuth`. */
export const yo = (req, res) => {
  res.json({ ok: true, data: req.usuario });
};
