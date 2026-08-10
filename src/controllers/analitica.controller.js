import * as analiticaService from "../services/analitica.service.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const tablero = asyncHandler(async (req, res) => {
  const data = await analiticaService.tablero(req.query);
  res.json({ ok: true, data });
});

export const resumen = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await analiticaService.resumen(req.query) });
});

export const porOperario = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await analiticaService.porOperario(req.query) });
});

export const productosTop = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await analiticaService.productosTop(req.query) });
});

export const picosTrabajo = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await analiticaService.picosTrabajo(req.query) });
});

export const novedades = asyncHandler(async (req, res) => {
  res.json({ ok: true, data: await analiticaService.novedades(req.query) });
});
