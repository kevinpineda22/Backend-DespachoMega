/**
 * operarios.repository.js — Acceso a `despacho_mega_operarios`.
 */
import { supabaseAdmin } from "../config/supabase.js";

const TABLA = "despacho_mega_operarios";
const CAMPOS =
  "id, user_id, correo, nombre, documento, rol, modo_habilitado, sede, activo, creado_por, created_at, updated_at";

export async function listar({ soloActivos = false } = {}) {
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

export async function porUserId(userId) {
  const { data, error } = await supabaseAdmin
    .from(TABLA)
    .select(CAMPOS)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function porCorreo(correo) {
  const { data, error } = await supabaseAdmin
    .from(TABLA)
    .select(CAMPOS)
    .ilike("correo", correo)
    .maybeSingle();

  if (error) throw error;
  return data;
}

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
