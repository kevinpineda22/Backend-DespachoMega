/**
 * despachadores.controller.js — Catalogo de despachadores.
 *
 * No hay handler de borrado a proposito: la baja es `PATCH { activo: false }`.
 */
import * as despachadorService from "../services/despachador.service.js";
import { prohibido } from "../lib/errores.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Cualquier autenticado ve los activos (los necesita el selector al abrir).
 * `?todos=1` incluye inactivos y es solo del admin: un operario no tiene por
 * que ver a quien se dio de baja.
 */
export const listar = asyncHandler(async (req, res) => {
  const todos = req.query.todos === true;

  if (todos && req.usuario?.rol !== "admin") {
    throw prohibido("Solo el administrador puede listar despachadores inactivos.");
  }

  const despachadores = await despachadorService.listar({ todos });
  res.json({ ok: true, data: { despachadores } });
});

export const crear = asyncHandler(async (req, res) => {
  const despachador = await despachadorService.crear(req.body);
  res.status(201).json({ ok: true, data: { despachador } });
});

export const actualizar = asyncHandler(async (req, res) => {
  const despachador = await despachadorService.actualizar(req.params.id, req.body);
  res.json({ ok: true, data: { despachador } });
});
