/**
 * despachador.service.js — Catalogo de quien entrega fisicamente.
 *
 * El despachador NO es un usuario del modulo: es una persona del muelle que el
 * auditor elige al abrir la factura. Por eso es un catalogo administrado por
 * el admin y no una fila de `despacho_mega_operarios`.
 *
 * BAJA LOGICA, NUNCA DELETE. `despachos.despachador_id` es NOT NULL: borrar un
 * despachador dejaria huerfano el historial de que entrego. `activo = false`
 * lo saca del selector y conserva su nombre en las auditorias viejas.
 */
import * as despachadoresRepo from "../repositories/despachadores.repository.js";
import { conflicto, noEncontrado, solicitudInvalida } from "../lib/errores.js";

// Codigo de PostgreSQL para violacion de unicidad. Lo dispara el indice
// `despacho_mega_despachadores_nombre_idx` sobre LOWER(TRIM(nombre)).
const UNIQUE_VIOLATION = "23505";

const esDuplicado = (error) => error?.code === UNIQUE_VIOLATION;

/**
 * @param {{ todos?: boolean }} [opciones] `todos` incluye inactivos (solo admin;
 *   la regla de rol vive en el controlador).
 */
export async function listar({ todos = false } = {}) {
  return despachadoresRepo.listar({ soloActivos: !todos });
}

/**
 * Crea un despachador. Recorta el nombre y deja que el indice unico decida el
 * duplicado: pre-check + insert tendria una carrera entre dos admins.
 */
export async function crear({ nombre } = {}) {
  const limpio = (nombre ?? "").trim();
  if (!limpio) throw solicitudInvalida("El nombre del despachador es obligatorio.");

  try {
    return await despachadoresRepo.crear({ nombre: limpio, activo: true });
  } catch (error) {
    if (esDuplicado(error)) {
      throw conflicto(`Ya existe un despachador llamado "${limpio}".`);
    }
    throw error;
  }
}

/**
 * @param {string} id
 * @param {{ nombre?: string, activo?: boolean }} cambios `activo: false` es la
 *   baja logica.
 */
export async function actualizar(id, cambios = {}) {
  const existente = await despachadoresRepo.porId(id);
  if (!existente) throw noEncontrado("Despachador no encontrado.");

  const limpios = { ...cambios };
  if (typeof limpios.nombre === "string") {
    limpios.nombre = limpios.nombre.trim();
    if (!limpios.nombre) {
      throw solicitudInvalida("El nombre del despachador es obligatorio.");
    }
  }

  try {
    return await despachadoresRepo.actualizar(id, limpios);
  } catch (error) {
    if (esDuplicado(error)) {
      throw conflicto(`Ya existe un despachador llamado "${limpios.nombre}".`);
    }
    throw error;
  }
}

/**
 * Para abrir una auditoria: el despachador tiene que existir (404) y estar
 * activo (400). Devuelve la fila para que quien llama no vuelva a consultarla.
 */
export async function exigirActivo(id) {
  const despachador = await despachadoresRepo.porId(id);
  if (!despachador) throw noEncontrado("El despachador indicado no existe.");
  if (!despachador.activo) {
    throw solicitudInvalida(
      `El despachador ${despachador.nombre} esta inactivo; elija otro.`,
    );
  }
  return despachador;
}
