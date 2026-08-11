/**
 * cobertura.controller.js — Control de cobertura diaria.
 */
import * as coberturaService from "../services/cobertura.service.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const tablero = asyncHandler(async (req, res) => {
  const data = await coberturaService.tablero(req.query);
  res.json({ ok: true, ...data });
});

/**
 * Sincroniza contra Siesa a pedido.
 *
 * Es un COMPLEMENTO del cron, no el mecanismo: si la captura dependiera de que
 * alguien apriete este boton, los dias que nadie entre al panel se pierden — y
 * Siesa solo conserva ~4 dias, asi que no hay como recuperarlos.
 */
export const sincronizar = asyncHandler(async (req, res) => {
  const data = await coberturaService.sincronizar({ fecha: req.body?.fecha });
  res.json({ ok: true, data });
});

export const excluir = asyncHandler(async (req, res) => {
  const data = await coberturaService.excluir(req.params.id, req.body, req.usuario);
  res.json({ ok: true, data });
});
