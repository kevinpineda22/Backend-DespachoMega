/**
 * siesaClient.js — Cliente HTTP de Siesa Connekta v3.
 *
 * Lo que hace distinto a un `fetch` pelado, y por que:
 *
 *   1. REINTENTOS. Siesa responde 200 con cuerpo vacio o JSON truncado con
 *      cierta frecuencia. No es un error de red y `fetch` no lo detecta: hay
 *      que mirar el cuerpo. Los mismos sintomas ya se manejan asi en los
 *      scripts de sincronizacion del frontend.
 *
 *   2. NORMALIZACION DE LA FORMA. Segun la consulta, las filas llegan en
 *      `detalle.Datos`, `detalle.Table`, `Datos`, `datos`, `Table`, o como
 *      string JSON anidado. `extraerFilas` prueba todas antes de rendirse.
 *
 * Ese comportamiento esta aislado ACA para que ningun servicio tenga que
 * saberlo.
 */
import { env } from "../config/env.js";
import { ErrorHttp, errorExterno } from "./errores.js";
import { logger } from "./logger.js";

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Desanida cualquiera de las formas en que Siesa envuelve las filas.
 * @param {unknown} valor
 * @returns {Array<object>}
 */
function candidatoAFilas(valor) {
  if (Array.isArray(valor)) return valor;

  if (typeof valor === "string") {
    try {
      return candidatoAFilas(JSON.parse(valor));
    } catch {
      return [];
    }
  }

  if (valor && typeof valor === "object") {
    return candidatoAFilas(valor.Datos)
      .concat(candidatoAFilas(valor.Table))
      .concat(candidatoAFilas(valor.datos))
      .concat(candidatoAFilas(valor.table));
  }

  return [];
}

/**
 * Extrae el arreglo de filas de una respuesta de Siesa.
 * @param {unknown} json
 * @returns {Array<object>}
 */
export function extraerFilas(json) {
  const candidatos = [
    json?.detalle?.Datos,
    json?.detalle?.Table,
    json?.detalle?.datos,
    json?.detalle?.table,
    json?.Datos,
    json?.Table,
    json?.datos,
    json?.table,
    json?.detalle,
    json,
  ];

  for (const candidato of candidatos) {
    const filas = candidatoAFilas(candidato);
    if (filas.length > 0) return filas;
  }

  return [];
}

const CODIGO_VACIO = "SIESA_RESPUESTA_VACIA";
const CODIGO_JSON = "SIESA_JSON_INVALIDO";

async function leerRespuesta(respuesta, descripcion) {
  const texto = await respuesta.text();

  if (!respuesta.ok) {
    // TRAMPA DE CONNEKTA, verificada contra la API real (6 ago 2026):
    // una consulta que NO esta publicada devuelve 401 "No autorizado, los datos
    // proporcionados son incorrectos" — el mismo codigo y mensaje que unas
    // credenciales malas. No devuelve 404.
    //
    // Sin este caso aparte, el operario ve "intente de nuevo en unos segundos"
    // para un problema que ningun reintento arregla, y quien depura pierde el
    // rato revisando CONNI_KEY cuando lo que falta es la consulta.
    if (respuesta.status === 401 || respuesta.status === 403) {
      throw errorExterno(
        `Siesa rechazo la consulta "${descripcion}". Puede ser que la consulta ` +
          "no este publicada en Siesa, o que CONNI_KEY / CONNI_TOKEN no sean validos. " +
          "Reintentar no ayuda: es configuracion.",
        texto.trim().slice(0, 240),
      );
    }

    throw errorExterno(
      `Siesa respondio HTTP ${respuesta.status}.`,
      texto.trim().slice(0, 240) || "Cuerpo vacio",
    );
  }

  if (!texto.trim()) {
    const error = new Error("Siesa respondio vacio.");
    error.code = CODIGO_VACIO;
    throw error;
  }

  try {
    return JSON.parse(texto);
  } catch (causa) {
    const error = new Error(`Respuesta de Siesa no es JSON valido: ${causa.message}`);
    error.code = CODIGO_JSON;
    throw error;
  }
}

/**
 * Ejecuta una consulta publicada en Siesa Connekta.
 *
 * @param {string} descripcion Nombre de la consulta en Siesa.
 * @param {Record<string, string|number>} [parametros] Parametros de la consulta
 *   (Siesa los recibe como query string con el prefijo que defina la consulta).
 * @returns {Promise<Array<object>>} Filas planas.
 */
export async function ejecutarConsulta(descripcion, parametros = {}) {
  const url = new URL(`${env.siesa.baseUrl}/ejecutarconsulta`);
  url.searchParams.set("idCompania", env.siesa.idCompania);
  url.searchParams.set("descripcion", descripcion);

  for (const [clave, valor] of Object.entries(parametros)) {
    if (valor !== undefined && valor !== null && valor !== "") {
      url.searchParams.set(clave, String(valor));
    }
  }

  let ultimoError = null;

  for (let intento = 1; intento <= env.siesa.maxRetries; intento += 1) {
    const abortar = AbortSignal.timeout(env.siesa.timeoutMs);

    try {
      const respuesta = await fetch(url, {
        method: "GET",
        cache: "no-store",
        signal: abortar,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
          conniKey: env.siesa.conniKey,
          conniToken: env.siesa.conniToken,
        },
      });

      const json = await leerRespuesta(respuesta, descripcion);
      return extraerFilas(json);
    } catch (error) {
      ultimoError = error;

      // Solo se reintenta lo que puede cambiar con el tiempo: respuestas
      // truncadas, cuerpos vacios y timeouts. Un error de configuracion
      // (401/403) o de sintaxis da igual cuantas veces se pida.
      const reintentable =
        error.code === CODIGO_VACIO ||
        error.code === CODIGO_JSON ||
        error.name === "TimeoutError";

      if (!reintentable || intento === env.siesa.maxRetries) break;

      const espera = 900 * intento;
      logger.warn("Respuesta de Siesa incompleta, reintentando", {
        descripcion,
        intento,
        espera,
      });
      await esperar(espera);
    }
  }

  logger.error("Consulta a Siesa fallida", {
    descripcion,
    error: ultimoError?.message,
  });

  // Los errores que ya vienen con diagnostico util (401/403 de configuracion)
  // se propagan tal cual. Envolverlos en el mensaje generico de mas abajo
  // borraria justo la parte que le dice a quien depura donde mirar.
  if (ultimoError instanceof ErrorHttp) throw ultimoError;

  throw errorExterno(
    "No se pudo consultar Siesa. Intente de nuevo en unos segundos.",
    ultimoError?.message,
  );
}
