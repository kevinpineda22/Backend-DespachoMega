/**
 * despachadores.repository.js — Acceso a `despacho_mega_despachadores`.
 *
 * Catalogo de quien entrega fisicamente. No hay `eliminar` a proposito: la
 * baja es logica (`activo = false`) porque `despachos.despachador_id` es NOT
 * NULL y un despachador con historial no puede desaparecer.
 */
import { supabaseAdmin } from "../config/supabase.js";

const TABLA = "despacho_mega_despachadores";
const CAMPOS = "id, nombre, activo, created_at, updated_at";

export async function listar({ soloActivos = true } = {}) {
  let consulta = supabaseAdmin.from(TABLA).select(CAMPOS).order("nombre");
  if (soloActivos) consulta = consulta.eq("activo", true);

  const { data, error } = await consulta;
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

/**
 * Inserta y deja que el indice unico sobre LOWER(TRIM(nombre)) decida el
 * duplicado: el error `23505` sube tal cual y el servicio lo traduce a 409.
 * Un pre-check + insert tendria una carrera entre dos admins.
 */
export async function crear(registro) {
  const { data, error } = await supabaseAdmin
    .from(TABLA)
    .insert(registro)
    .select(CAMPOS)
    .single();

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
