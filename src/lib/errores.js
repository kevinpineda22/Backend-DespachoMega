/**
 * errores.js — Error con codigo HTTP para cortar el flujo desde cualquier capa.
 *
 * Sin esto, cada servicio termina devolviendo `{ ok, error }` y el controlador
 * traduciendo a mano; con esto, se lanza y el `errorHandler` responde.
 */
export class ErrorHttp extends Error {
  /**
   * DOS CANALES, Y LA DIFERENCIA IMPORTA
   *
   * `detalle` es para DEPURAR: se omite en produccion porque los errores de
   * Supabase y Siesa arrastran nombres de tablas y fragmentos de query.
   *
   * `datos` es para que el CLIENTE ACTUE: viaja siempre, tambien en produccion.
   * Existe porque hay errores cuya respuesta correcta no es un mensaje sino una
   * opcion. El caso que lo motivo: un consecutivo que vive en dos cajas devuelve
   * 409, y el operario necesita saber CUALES son para elegir. Con esa lista en
   * `detalle`, en produccion llegaba un 409 sin las cajas y el selector no tenia
   * nada que ofrecer — un callejon sin salida que en desarrollo no se veia.
   *
   * Regla al usar `datos`: solo lo que ya se le puede decir al operario en voz
   * alta. Nunca nombres de tablas, columnas ni fragmentos de consulta.
   *
   * @param {number} status Codigo HTTP.
   * @param {string} mensaje Mensaje apto para mostrarle al operario.
   * @param {object} [detalle] Contexto de depuracion (se omite en produccion).
   * @param {object} [datos] Datos accionables para el cliente (siempre viajan).
   */
  constructor(status, mensaje, detalle, datos) {
    super(mensaje);
    this.name = "ErrorHttp";
    this.status = status;
    this.detalle = detalle;
    this.datos = datos;
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

export const conflicto = (mensaje, detalle, datos) =>
  new ErrorHttp(409, mensaje, detalle, datos);

export const errorExterno = (mensaje, detalle) =>
  new ErrorHttp(502, mensaje, detalle);
