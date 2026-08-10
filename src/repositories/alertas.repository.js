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
