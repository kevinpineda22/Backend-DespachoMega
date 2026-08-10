/**
 * analitica.repository.js — Lectura de las vistas de analitica.
 *
 * Todo sale de `despacho_mega_vw_*` (ver db/migrations/002). La definicion de
 * cada metrica vive en SQL, no aca: este archivo solo filtra y ordena.
 */
import { supabaseAdmin } from "../config/supabase.js";

const rango = (consulta, columna, desde, hasta) => {
  let q = consulta;
  if (desde) q = q.gte(columna, desde);
  if (hasta) q = q.lte(columna, hasta);
  return q;
};

export async function resumenDiario({ desde, hasta, modo }) {
  let consulta = supabaseAdmin
    .from("despacho_mega_vw_resumen_diario")
    .select("*")
    .order("dia", { ascending: false });

  if (modo) consulta = consulta.eq("modo", modo);
  consulta = rango(consulta, "dia", desde, hasta);

  const { data, error } = await consulta;
  if (error) throw error;
  return data;
}

export async function porOperario({ desde, hasta, modo, operario_id: operarioId, limite }) {
  let consulta = supabaseAdmin
    .from("despacho_mega_vw_por_operario")
    .select("*")
    .order("despachos", { ascending: false })
    .limit(limite);

  if (modo) consulta = consulta.eq("modo", modo);
  if (operarioId) consulta = consulta.eq("operario_id", operarioId);
  consulta = rango(consulta, "dia", desde, hasta);

  const { data, error } = await consulta;
  if (error) throw error;
  return data;
}

export async function productosTop({ desde, hasta, limite }) {
  let consulta = supabaseAdmin
    .from("despacho_mega_vw_productos_top")
    .select("*")
    .order("cantidad_despachada", { ascending: false })
    .limit(limite);

  consulta = rango(consulta, "dia", desde, hasta);

  const { data, error } = await consulta;
  if (error) throw error;
  return data;
}

export async function picosTrabajo({ desde, hasta }) {
  let consulta = supabaseAdmin
    .from("despacho_mega_vw_picos_trabajo")
    .select("*")
    .order("dia", { ascending: false })
    .order("hora", { ascending: true });

  consulta = rango(consulta, "dia", desde, hasta);

  const { data, error } = await consulta;
  if (error) throw error;
  return data;
}

export async function novedadesInventario({ desde, hasta, limite }) {
  let consulta = supabaseAdmin
    .from("despacho_mega_vw_novedades_inventario")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limite);

  consulta = rango(consulta, "dia", desde, hasta);

  const { data, error } = await consulta;
  if (error) throw error;
  return data;
}
