/**
 * catalogo.repository.js — Resolucion de lo escaneado a (item, cuantas unidades).
 *
 * CATALOGO PROPIO DE MEGAMAYORISTAS
 * Este modulo NO usa `siesa_codigos_barras`: esa tabla guarda el catalogo de la
 * compañia Merkahorro (Cia 1) y su script de sincronizacion descarta el resto.
 * Aca se despacha Megamayoristas (Cia 2), cuyo catalogo vive en
 * `despacho_mega_items` / `despacho_mega_codigos_barras` (migracion 004).
 *
 * Las columnas conservan los nombres crudos de Siesa (`f120_id`,
 * `codigo_barras`, `unidad_medida`) para que un solo script sincronice ambas
 * compañias cambiando solo la tabla destino.
 */
import { supabaseAdmin } from "../config/supabase.js";

const TABLA_CODIGOS = "despacho_mega_codigos_barras";

/**
 * Factor deducido del codigo de unidad (`P12` -> 12).
 *
 * Respaldo para cuando el codigo NO esta en el catalogo pero sigue la
 * convencion `{item}{UNIDAD}`. Lo que esta en la tabla siempre manda: ahi el
 * factor viene de Siesa (`f131_cant_unidad_medida`) y un catalogo real tiene
 * excepciones que ninguna regla de nombres captura.
 *
 * @param {string} unidad
 * @returns {number}
 */
export function factorDeUnidad(unidad) {
  const m = /^P(\d+)$/i.exec(String(unidad ?? "").trim());
  return m ? Number(m[1]) : 1;
}

/**
 * Traduce lo que se escaneo a un item y a cuantas unidades base representa.
 *
 * Tres caminos, en orden:
 *   1. El codigo esta en el catalogo -> se usa su `factor` (el codigo de un
 *      paquete P12 suma 12 unidades de una sola vez).
 *   2. No esta, pero sigue la convencion `{item}{UNIDAD}` (`40027P12`) que ya
 *      usa el catalogo de Merkahorro -> se parte y se deduce el factor.
 *   3. No se reconoce -> se devuelve tal cual con factor 1, y quien llama
 *      decide si corresponde a alguna linea de la factura.
 *
 * @param {string} codigo Lo que llego del escaner o del teclado.
 * @returns {Promise<{ codigoItem: string, factor: number, unidad: string|null,
 *                     origen: 'catalogo'|'sufijo_unidad'|'directo' }>}
 */
export async function resolverCodigo(codigo) {
  const limpio = String(codigo).trim();

  const { data, error } = await supabaseAdmin
    .from(TABLA_CODIGOS)
    .select("f120_id, unidad_medida, factor")
    .eq("codigo_barras", limpio)
    .maybeSingle();

  if (error) throw error;

  if (data) {
    return {
      codigoItem: String(data.f120_id),
      factor: Number(data.factor) || 1,
      // Siesa rellena la unidad con espacios: "UND ", "P6  ".
      unidad: data.unidad_medida?.trim() || null,
      origen: "catalogo",
    };
  }

  // Convencion heredada del catalogo de Merkahorro: `{f120_id}{UNIDAD}`.
  const compuesto = /^(\d+)(UND|KL|P\d+)$/i.exec(limpio);
  if (compuesto) {
    const unidad = compuesto[2].toUpperCase();
    return {
      codigoItem: compuesto[1],
      factor: factorDeUnidad(unidad),
      unidad,
      origen: "sufijo_unidad",
    };
  }

  return { codigoItem: limpio, factor: 1, unidad: null, origen: "directo" };
}
