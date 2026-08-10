/**
 * logger.js — Log estructurado en una linea JSON.
 *
 * Vercel indexa stdout; JSON plano se filtra mucho mejor que texto libre
 * cuando hay que rastrear un despacho puntual.
 */
import { esProduccion } from "../config/env.js";

const emitir = (nivel, mensaje, contexto = {}) => {
  const linea = {
    nivel,
    mensaje,
    ts: new Date().toISOString(),
    ...contexto,
  };

  const salida = esProduccion ? JSON.stringify(linea) : linea;
  if (nivel === "error") console.error(salida);
  else if (nivel === "warn") console.warn(salida);
  else console.log(salida);
};

export const logger = {
  info: (mensaje, contexto) => emitir("info", mensaje, contexto),
  warn: (mensaje, contexto) => emitir("warn", mensaje, contexto),
  error: (mensaje, contexto) => emitir("error", mensaje, contexto),
};
