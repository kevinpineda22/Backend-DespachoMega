/**
 * errores.js — Error con codigo HTTP para cortar el flujo desde cualquier capa.
 *
 * Sin esto, cada servicio termina devolviendo `{ ok, error }` y el controlador
 * traduciendo a mano; con esto, se lanza y el `errorHandler` responde.
 */
export class ErrorHttp extends Error {
  /**
   * @param {number} status Codigo HTTP.
   * @param {string} mensaje Mensaje apto para mostrarle al operario.
   * @param {object} [detalle] Contexto extra (no se muestra en produccion).
   */
  constructor(status, mensaje, detalle) {
    super(mensaje);
    this.name = "ErrorHttp";
    this.status = status;
    this.detalle = detalle;
  }
}

export const noEncontrado = (mensaje, detalle) =>
  new ErrorHttp(404, mensaje, detalle);

export const solicitudInvalida = (mensaje, detalle) =>
  new ErrorHttp(400, mensaje, detalle);

export const noAutorizado = (mensaje = "Sesion no valida.") =>
  new ErrorHttp(401, mensaje);

export const prohibido = (mensaje = "No tiene permisos para esta accion.") =>
  new ErrorHttp(403, mensaje);

export const conflicto = (mensaje, detalle) =>
  new ErrorHttp(409, mensaje, detalle);

export const errorExterno = (mensaje, detalle) =>
  new ErrorHttp(502, mensaje, detalle);
