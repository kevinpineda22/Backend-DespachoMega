/**
 * errorHandler.js — Ultimo eslabon. Traduce cualquier excepcion a una
 * respuesta JSON consistente `{ ok, error, detalle? }`.
 *
 * En produccion el detalle se omite: los errores de Supabase y Siesa filtran
 * nombres de tablas y fragmentos de query que no le sirven a un operario y si
 * le sirven a quien busque como atacar.
 */
import { ZodError } from "zod";
import { esProduccion } from "../config/env.js";
import { ErrorHttp } from "../lib/errores.js";
import { logger } from "../lib/logger.js";

export function notFoundHandler(req, res) {
  res.status(404).json({ ok: false, error: `Ruta no encontrada: ${req.path}` });
}

// La firma de 4 parametros es lo que hace que Express lo reconozca como
// manejador de errores. `_next` no se usa pero no se puede quitar.
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: "Datos invalidos.",
      detalle: error.issues.map((i) => ({
        campo: i.path.join("."),
        mensaje: i.message,
      })),
    });
  }

  const status = error instanceof ErrorHttp ? error.status : 500;

  if (status >= 500) {
    logger.error("Error no controlado", {
      ruta: req.path,
      metodo: req.method,
      correo: req.usuario?.correo,
      mensaje: error.message,
      stack: error.stack,
    });
  }

  const cuerpo = {
    ok: false,
    error:
      status >= 500 && esProduccion
        ? "Error interno. Reporte al area de desarrollo."
        : error.message,
  };

  if (!esProduccion && error.detalle) cuerpo.detalle = error.detalle;

  // `datos` SI viaja en produccion: es lo que el cliente necesita para ofrecerle
  // una salida al operario, no contexto de depuracion. Ver `ErrorHttp`.
  if (error.datos) cuerpo.datos = error.datos;

  res.status(status).json(cuerpo);
}
