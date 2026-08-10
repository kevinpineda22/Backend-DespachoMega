/**
 * despachos.repository.js — Acceso a despachos, items y escaneos.
 */
import { supabaseAdmin } from "../config/supabase.js";

const TABLA_DESPACHOS = "despacho_mega_despachos";
const TABLA_ITEMS = "despacho_mega_despacho_items";
const TABLA_ESCANEOS = "despacho_mega_escaneos";
const TABLA_APROBACIONES = "despacho_mega_aprobaciones";

const CAMPOS_DESPACHO = `
  id, numero_factura, tipo_documento, fecha_factura, modo, estado, operario_id,
  cliente_nit, cliente_nombre, sede, bodega, total_items, items_validados,
  observaciones, despacho_origen_id, iniciado_at, finalizado_at,
  created_at, updated_at
`;

const CAMPOS_ITEM = `
  id, despacho_id, linea, codigo_item, descripcion, unidad,
  cantidad_solicitada, cantidad_validada, precio_unitario, estado_item,
  validado_por, validado_at
`;

/** Despacho activo (no cancelado) para una factura y un modo. */
export async function despachoVigente(numeroFactura, modo) {
  const { data, error } = await supabaseAdmin
    .from(TABLA_DESPACHOS)
    .select(CAMPOS_DESPACHO)
    .eq("numero_factura", numeroFactura)
    .eq("modo", modo)
    .neq("estado", "cancelado")
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function porId(id) {
  const { data, error } = await supabaseAdmin
    .from(TABLA_DESPACHOS)
    .select(CAMPOS_DESPACHO)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function crearConItems(despacho, items) {
  const { data: creado, error } = await supabaseAdmin
    .from(TABLA_DESPACHOS)
    .insert(despacho)
    .select(CAMPOS_DESPACHO)
    .single();

  if (error) throw error;

  if (items.length > 0) {
    const { error: errorItems } = await supabaseAdmin
      .from(TABLA_ITEMS)
      .insert(items.map((item) => ({ ...item, despacho_id: creado.id })));

    // Un despacho sin items es inservible y ademas bloquea el numero de factura
    // por el indice unico. Se cancela para que el operario pueda reintentar.
    if (errorItems) {
      await supabaseAdmin
        .from(TABLA_DESPACHOS)
        .update({ estado: "cancelado" })
        .eq("id", creado.id);
      throw errorItems;
    }
  }

  return creado;
}

export async function actualizar(id, cambios) {
  const { data, error } = await supabaseAdmin
    .from(TABLA_DESPACHOS)
    .update(cambios)
    .eq("id", id)
    .select(CAMPOS_DESPACHO)
    .single();

  if (error) throw error;
  return data;
}

export async function itemsDe(despachoId) {
  const { data, error } = await supabaseAdmin
    .from(TABLA_ITEMS)
    .select(CAMPOS_ITEM)
    .eq("despacho_id", despachoId)
    .order("linea");

  if (error) throw error;
  return data;
}

export async function actualizarItem(itemId, cambios) {
  const { data, error } = await supabaseAdmin
    .from(TABLA_ITEMS)
    .update(cambios)
    .eq("id", itemId)
    .select(CAMPOS_ITEM)
    .single();

  if (error) throw error;
  return data;
}

export async function registrarEscaneo(escaneo) {
  const { data, error } = await supabaseAdmin
    .from(TABLA_ESCANEOS)
    .insert(escaneo)
    .select("id, created_at, resultado, codigo_ingresado")
    .single();

  if (error) throw error;
  return data;
}

export async function escaneosDe(despachoId) {
  const { data, error } = await supabaseAdmin
    .from(TABLA_ESCANEOS)
    .select(
      "id, item_id, operario_id, codigo_ingresado, codigo_item_resuelto, metodo, resultado, cantidad, created_at",
    )
    .eq("despacho_id", despachoId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}

export async function listar(filtros) {
  const {
    estado,
    modo,
    operario_id: operarioId,
    numero_factura: numeroFactura,
    desde,
    hasta,
    limite,
    offset,
  } = filtros;

  let consulta = supabaseAdmin
    .from(TABLA_DESPACHOS)
    .select(
      `${CAMPOS_DESPACHO}, operario:despacho_mega_operarios!operario_id (id, nombre, correo)`,
      { count: "exact" },
    )
    .order("iniciado_at", { ascending: false })
    .range(offset, offset + limite - 1);

  if (estado) consulta = consulta.eq("estado", estado);
  if (modo) consulta = consulta.eq("modo", modo);
  if (operarioId) consulta = consulta.eq("operario_id", operarioId);
  if (numeroFactura) consulta = consulta.ilike("numero_factura", `%${numeroFactura}%`);
  if (desde) consulta = consulta.gte("iniciado_at", `${desde}T00:00:00Z`);
  if (hasta) consulta = consulta.lte("iniciado_at", `${hasta}T23:59:59Z`);

  const { data, error, count } = await consulta;
  if (error) throw error;

  return { despachos: data, total: count ?? data.length };
}

export async function registrarAprobacion(registro) {
  const { data, error } = await supabaseAdmin
    .from(TABLA_APROBACIONES)
    .insert(registro)
    .select("id, despacho_id, item_id, decision, observacion, admin_correo, created_at")
    .single();

  if (error) throw error;
  return data;
}

export async function aprobacionesDe(despachoId) {
  const { data, error } = await supabaseAdmin
    .from(TABLA_APROBACIONES)
    .select("id, item_id, decision, observacion, admin_correo, created_at")
    .eq("despacho_id", despachoId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return data;
}
