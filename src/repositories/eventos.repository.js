/**
 * eventos.repository.js — Bitacora append-only.
 *
 * `registrar` NUNCA lanza. La bitacora es importante, pero no tanto como para
 * tumbar un despacho en curso: si falla el insert, se loguea y se sigue.
 */
import { supabaseAdmin } from "../config/supabase.js";
import { logger } from "../lib/logger.js";

const TABLA = "despacho_mega_eventos";

export const EVENTO = {
  DESPACHO_ABIERTO: "despacho_abierto",
  DESPACHO_REANUDADO: "despacho_reanudado",
  ITEM_VALIDADO: "item_validado",
  ESCANEO_RECHAZADO: "escaneo_rechazado",
  ALERTA_CREADA: "alerta_creada",
  ALERTA_ACTUALIZADA: "alerta_actualizada",
  DESPACHO_FINALIZADO: "despacho_finalizado",
  DESPACHO_CANCELADO: "despacho_cancelado",
  DESPACHO_APROBADO: "despacho_aprobado",
  DESPACHO_RECHAZADO: "despacho_rechazado",
  OPERARIO_CREADO: "operario_creado",
  OPERARIO_ACTUALIZADO: "operario_actualizado",
};

/**
 * @param {{ despachoId?: string, actorUserId?: string, actorCorreo?: string,
 *           evento: string, payload?: object }} datos
 */
export async function registrar({
  despachoId,
  actorUserId,
  actorCorreo,
  evento,
  payload,
}) {
  const { error } = await supabaseAdmin.from(TABLA).insert({
    despacho_id: despachoId ?? null,
    actor_user_id: actorUserId ?? null,
    actor_correo: actorCorreo ?? null,
    evento,
    payload: payload ?? null,
  });

  if (error) {
    logger.warn("No se pudo registrar el evento en la bitacora", {
      evento,
      despachoId,
      error: error.message,
    });
  }
}

export async function historialPorDespacho(despachoId) {
  const { data, error } = await supabaseAdmin
    .from(TABLA)
    .select("id, evento, actor_correo, payload, created_at")
    .eq("despacho_id", despachoId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return data;
}

export async function historialPorCorreo(correo, limite = 200) {
  const { data, error } = await supabaseAdmin
    .from(TABLA)
    .select("id, despacho_id, evento, payload, created_at")
    .eq("actor_correo", correo)
    .order("created_at", { ascending: false })
    .limit(limite);

  if (error) throw error;
  return data;
}
