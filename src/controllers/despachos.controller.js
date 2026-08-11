/**
 * despachos.controller.js — Traduce HTTP a llamadas de servicio y nada mas.
 *
 * `asyncHandler` evita repetir try/catch en cada handler: Express 4 no atrapa
 * los rechazos de una promesa, y sin este envoltorio un error dentro de un
 * `async` deja el request colgado hasta el timeout en vez de responder 500.
 */
import * as despachoService from "../services/despacho.service.js";
import {
  consultarFactura,
  cajasDisponibles,
} from "../services/facturaSiesa.service.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/** Vista previa de la factura en Siesa, sin crear nada. */
export const previsualizarFactura = asyncHandler(async (req, res) => {
  const { encabezado, items } = await consultarFactura(req.params.numero, {
    tipoDocumento: req.query.tipo_documento,
  });
  res.json({ ok: true, data: { encabezado, items } });
});

/**
 * Cajas con documentos en la ventana actual, para el selector del operario.
 *
 * No exige admin: la usa la pantalla del operario, que ya pasó por `requireAuth`
 * y solo va a ver códigos de caja y cuántos documentos tiene cada una.
 */
export const listarCajas = asyncHandler(async (_req, res) => {
  res.json({ ok: true, data: await cajasDisponibles() });
});

export const abrir = asyncHandler(async (req, res) => {
  const resultado = await despachoService.abrir({
    numeroFactura: req.body.numero_factura,
    modo: req.body.modo,
    tipoDocumento: req.body.tipo_documento,
    usuario: req.usuario,
  });

  res.status(resultado.reanudado ? 200 : 201).json({ ok: true, data: resultado });
});

export const obtener = asyncHandler(async (req, res) => {
  const data = await despachoService.obtener(req.params.id, req.usuario);
  res.json({ ok: true, data });
});

export const listar = asyncHandler(async (req, res) => {
  const data = await despachoService.listar(req.query);
  res.json({ ok: true, ...data });
});

export const validar = asyncHandler(async (req, res) => {
  const data = await despachoService.validar(req.params.id, req.body, req.usuario);

  // Un escaneo rechazado NO es un error de la API: la peticion se proceso bien
  // y el rechazo quedo registrado. Devolver 4xx haria que el frontend lo trate
  // como fallo de red y pierda el mensaje que el operario necesita leer.
  res.json({ ok: true, data });
});

/** Resuelve un codigo a la linea que le toca, sin mutar. Para abrir el modal. */
export const resolver = asyncHandler(async (req, res) => {
  const data = await despachoService.resolver(
    req.params.id,
    req.query.codigo,
    req.usuario,
  );
  res.json({ ok: true, data });
});

/** Ajusta el total de una linea (0 = devolver a pendientes). */
export const ajustar = asyncHandler(async (req, res) => {
  const data = await despachoService.ajustar(
    req.params.id,
    req.params.itemId,
    req.body.cantidad,
    req.usuario,
  );
  res.json({ ok: true, data });
});

export const finalizar = asyncHandler(async (req, res) => {
  const data = await despachoService.finalizar(req.params.id, req.body, req.usuario);
  res.json({ ok: true, data });
});

export const cancelar = asyncHandler(async (req, res) => {
  const data = await despachoService.cancelar(req.params.id, req.usuario);
  res.json({ ok: true, data });
});

/** Bitacora del despacho: linea de tiempo de quien hizo que. */
export const eventos = asyncHandler(async (req, res) => {
  const data = await despachoService.historial(req.params.id, req.usuario);
  res.json({ ok: true, data });
});

export const aprobar = asyncHandler(async (req, res) => {
  const data = await despachoService.aprobar(req.params.id, req.body, req.usuario);
  res.json({ ok: true, data });
});
