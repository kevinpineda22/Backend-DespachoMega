/**
 * facturaSiesa.service.js — Trae una factura de Siesa y la deja en la forma
 * que entiende el resto del modulo.
 *
 * FUENTE: consulta Connekta `merkahorro_Despacho_Factura_dev` (POS / punto de
 * venta). Columnas verificadas contra la API real el 6 de agosto de 2026.
 *
 * DOS COSAS DE ESA CONSULTA QUE MANDAN EN EL DISEÑO DE ESTE ARCHIVO:
 *
 *   1. NO RECIBE PARAMETROS. Devuelve TODOS los documentos de los ultimos 2
 *      dias (su propio WHERE). El filtrado por numero de factura se hace aca.
 *      Consecuencia: cada apertura de factura descarga la ventana completa. Con
 *      ~90 lineas es irrelevante; si la ventana crece, conviene parametrizar la
 *      consulta del lado de Siesa antes que paginar de este lado.
 *
 *   2. UN DOCUMENTO NO SE IDENTIFICA SOLO POR EL CONSECUTIVO. La identidad real
 *      es Cia + CoDoc + ID_TIPO_DOCTO + CONSEC_DOCTO, y conviven varias series
 *      (P02, P05, P08, PN5) con numeraciones independientes. Ver `consultarFactura`.
 */
import { env } from "../config/env.js";
import { ejecutarConsulta } from "../lib/siesaClient.js";
import { conflicto, noEncontrado } from "../lib/errores.js";

const texto = (valor) =>
  valor === null || valor === undefined ? null : String(valor).trim() || null;

const numero = (valor) => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

/** Identidad completa del documento, tal como la define Siesa. */
const claveDocumento = (fila) =>
  [fila.Cia, fila.CoDoc, fila.ID_TIPO_DOCTO, fila.CONSEC_DOCTO].join("|");

/**
 * Convierte las filas planas de un documento en `{ encabezado, items }`.
 *
 * @param {Array<object>} filas Filas de UN solo documento.
 */
export function normalizarFactura(filas) {
  const primera = filas[0];

  const encabezado = {
    // El consecutivo llega como numero; el resto del modulo lo trata como texto
    // (la columna en Supabase es TEXT y el operario lo teclea).
    numero_factura: texto(primera.CONSEC_DOCTO),
    tipo_documento: texto(primera.ID_TIPO_DOCTO),
    // "2026-08-06T00:00:00" -> "2026-08-06" (la columna en Supabase es DATE).
    fecha_factura: texto(primera.FECHA_DOCTO)?.slice(0, 10) ?? null,
    cliente_nit: texto(primera.NitTercero) ?? texto(primera.IdTercero),
    cliente_nombre: texto(primera.RazonSocial),
    sede: texto(primera.CoDoc),
    bodega: texto(primera.BODEGA),
  };

  const items = filas
    .map((fila, indice) => {
      const codigoItem = texto(fila.id_item);
      if (!codigoItem) return null;

      return {
        // La consulta no trae numero de linea. El orden de llegada ES la
        // numeracion; `RowidMvto` (GUID del movimiento) queda como identidad
        // estable por si algun dia hace falta reconciliar contra Siesa.
        linea: indice + 1,
        codigo_item: codigoItem,
        descripcion: texto(fila.DescItem),
        // Siesa rellena la unidad con espacios: "UND ", "P6  ".
        unidad: texto(fila.UNIDAD_MEDIDA),
        cantidad_solicitada: numero(fila.CANTIDAD) ?? 0,
        precio_unitario: numero(fila.PrecioUnitDet),
      };
    })
    .filter(Boolean)
    .map((item, indice) => ({ ...item, linea: indice + 1 }));

  return { encabezado, items };
}

/**
 * Busca una factura por su consecutivo.
 *
 * SOBRE LA AMBIGÜEDAD: si el consecutivo aparece en mas de una serie, esto NO
 * elige una. Lanza 409 pidiendo el tipo de documento. Elegir "la primera"
 * significaria que el operario despacha una factura distinta a la que tiene en
 * la mano, y eso no se detecta hasta que el cliente reclama. Hoy la colision no
 * ocurre (0 casos medidos), asi que este camino es una red, no el flujo normal.
 *
 * @param {string|number} numeroFactura Consecutivo que teclea el operario.
 * @param {{ tipoDocumento?: string }} [opciones] Desempate cuando hay ambigüedad.
 * @returns {Promise<{ encabezado: object, items: Array<object>, filasCrudas: Array<object> }>}
 */
export async function consultarFactura(numeroFactura, { tipoDocumento } = {}) {
  const filas = await ejecutarConsulta(env.siesa.consultaFactura);

  const objetivo = String(numeroFactura).trim();
  let candidatas = filas.filter(
    (f) => String(f.CONSEC_DOCTO ?? "").trim() === objetivo,
  );

  if (tipoDocumento) {
    candidatas = candidatas.filter(
      (f) => texto(f.ID_TIPO_DOCTO) === String(tipoDocumento).trim(),
    );
  }

  if (candidatas.length === 0) {
    throw noEncontrado(
      `No se encontro la factura ${objetivo}. La consulta de Siesa solo cubre ` +
        "los ultimos 2 dias: si es mas antigua, no va a aparecer.",
    );
  }

  const grupos = new Map();
  for (const fila of candidatas) {
    const clave = claveDocumento(fila);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(fila);
  }

  if (grupos.size > 1) {
    const tipos = [...new Set(candidatas.map((f) => texto(f.ID_TIPO_DOCTO)))];
    throw conflicto(
      `El consecutivo ${objetivo} existe en varias series (${tipos.join(", ")}). ` +
        "Indique el tipo de documento para continuar.",
      { tipos_documento: tipos },
    );
  }

  const delDocumento = [...grupos.values()][0];
  const { encabezado, items } = normalizarFactura(delDocumento);

  if (items.length === 0) {
    throw noEncontrado(
      `La factura ${objetivo} llego sin lineas de producto legibles.`,
      { columnasRecibidas: Object.keys(delDocumento[0]) },
    );
  }

  return { encabezado, items, filasCrudas: delDocumento };
}
