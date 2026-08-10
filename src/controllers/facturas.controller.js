/**
 * facturas.controller.js — Panel de facturas del administrador.
 *
 * Ojo con el nombre: `despachos.controller.js → previsualizarFactura` consulta
 * la factura en SIESA. Esto de aca consulta lo que paso con ella EN EL MODULO.
 * Fuentes distintas, preguntas distintas.
 */
import * as facturaService from "../services/factura.service.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const listar = asyncHandler(async (req, res) => {
  const data = await facturaService.listar(req.query);
  res.json({ ok: true, ...data });
});

export const detalle = asyncHandler(async (req, res) => {
  const data = await facturaService.detalle(req.params.numero);
  res.json({ ok: true, data });
});
