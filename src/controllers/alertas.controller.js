import * as alertaService from "../services/alerta.service.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const crear = asyncHandler(async (req, res) => {
  const data = await alertaService.crear(req.body, req.usuario);
  res.status(201).json({ ok: true, data });
});

export const listar = asyncHandler(async (req, res) => {
  const data = await alertaService.listar({
    estado: req.query.estado,
    despachoId: req.query.despacho_id,
    desde: req.query.desde,
    hasta: req.query.hasta,
    limite: req.query.limite,
  });
  res.json({ ok: true, data });
});

export const actualizar = asyncHandler(async (req, res) => {
  const data = await alertaService.actualizar(req.params.id, req.body, req.usuario);
  res.json({ ok: true, data });
});
