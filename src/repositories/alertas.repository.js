/**
 * alertas.repository.js — Acceso a `despacho_mega_alertas_inventario`.
 */
import { supabaseAdmin } from "../config/supabase.js";

const TABLA = "despacho_mega_alertas_inventario";
const CAMPOS = `
  id, despacho_id, item_id, codigo_item, descripcion, cantidad_faltante,
  motivo, comentario, estado, reportada_por, atendida_por, respuesta,
  created_at, resuelta_at
`;

export async function crear(registro) {
  const { data, error } = await supabaseAdmin
    .from(TABLA)
    .insert(registro)
    .select(CAMPOS)
    .single();

  if (error) throw error;
  return data;
}

export async function porId(id) {
  const { data, error } = await supabaseAdmin
    .from(TABLA)
    .select(CAMPOS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function actualizar(id, cambios) {
  const { data, error } = await supabaseAdmin
    .from(TABLA)
    .update(cambios)
    .eq("id", id)
    .select(CAMPOS)
    .single();

  if (error) throw error;
  return data;
}

export async function listar({ estado, despachoId, desde, hasta, limite = 100 }) {
  let consulta = supabaseAdmin
    .from(TABLA)
    .select(
      `${CAMPOS},
       despacho:despacho_mega_despachos!despacho_id (numero_factura, modo),
       operario:despacho_mega_operarios!reportada_por (nombre, correo)`,
    )
    .order("created_at", { ascending: false })
    .limit(limite);

  if (estado) consulta = consulta.eq("estado", estado);
  if (despachoId) consulta = consulta.eq("despacho_id", despachoId);
  if (desde) consulta = consulta.gte("created_at", `${desde}T00:00:00Z`);
  if (hasta) consulta = consulta.lte("created_at", `${hasta}T23:59:59Z`);

  const { data, error } = await consulta;
  if (error) throw error;
  return data;
}

/**
 * Bandeja del administrador. Lee de `despacho_mega_vw_novedades_inventario`
 * (migracion 007) y no de la tabla, porque necesita tres cosas que la tabla
 * sola no da: cuanto lleva abierta, en que etapa se detecto y el NOMBRE de
 * quien la atendio — `atendida_por` apunta a `auth.users`, no a los operarios
 * del modulo, asi que PostgREST no lo puede resolver con un join automatico.
 *
 * Es una lectura distinta de `listar`, no un reemplazo: `listar` la usa el
 * detalle de una factura y el cierre del despacho, donde la vista seria peso
 * de mas.
 */
export async function bandeja({ estado, motivo, modo, desde, hasta, limite = 100 }) {
  let consulta = supabaseAdmin
    .from("despacho_mega_vw_novedades_inventario")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limite);

  if (estado) consulta = consulta.eq("estado", estado);
  if (motivo) consulta = consulta.eq("motivo", motivo);
  if (modo) consulta = consulta.eq("modo", modo);
  if (desde) consulta = consulta.gte("created_at", `${desde}T00:00:00Z`);
  if (hasta) consulta = consulta.lte("created_at", `${hasta}T23:59:59Z`);

  const { data, error } = await consulta;
  if (error) throw error;
  return data;
}

/** Conteo por estado para las pestañas de la bandeja, en un solo viaje. */
export async function conteoPorEstado({ desde, hasta }) {
  let consulta = supabaseAdmin.from(TABLA).select("estado");

  if (desde) consulta = consulta.gte("created_at", `${desde}T00:00:00Z`);
  if (hasta) consulta = consulta.lte("created_at", `${hasta}T23:59:59Z`);

  const { data, error } = await consulta;
  if (error) throw error;

  return data.reduce((conteo, fila) => {
    conteo[fila.estado] = (conteo[fila.estado] || 0) + 1;
    return conteo;
  }, {});
}

/** Alertas abiertas de un despacho. Decide si cierra `completado` o `con_novedad`. */
export async function abiertasDe(despachoId) {
  const { data, error } = await supabaseAdmin
    .from(TABLA)
    .select("id")
    .eq("despacho_id", despachoId)
    .in("estado", ["abierta", "en_gestion"]);

  if (error) throw error;
  return data;
}
