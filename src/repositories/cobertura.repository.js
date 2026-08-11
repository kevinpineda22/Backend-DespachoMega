/**
 * cobertura.repository.js — Snapshot de lo facturado y su cruce contra el modulo.
 *
 * Tabla: `despacho_mega_facturas_dia` (escritura).
 * Vistas: `despacho_mega_vw_cobertura_dia` y `..._resumen` (lectura).
 * Ver db/migrations/008.
 */
import { supabaseAdmin } from "../config/supabase.js";

const TABLA = "despacho_mega_facturas_dia";
const VISTA = "despacho_mega_vw_cobertura_dia";
const VISTA_RESUMEN = "despacho_mega_vw_cobertura_resumen";

const TECHO_FILAS = 5000;

/**
 * Guarda el snapshot. IDEMPOTENTE: la clave unica
 * (cia, co_docto, tipo_documento, numero_factura) hace que correr el
 * sincronizador dos veces el mismo dia actualice en vez de duplicar.
 *
 * NO se tocan `excluida`, `motivo_exclusion` ni `excluida_por`: son decisiones
 * humanas y una sincronizacion no puede borrarlas. Por eso el upsert manda solo
 * las columnas que vienen de Siesa.
 */
export async function guardarSnapshot(documentos) {
  if (documentos.length === 0) return [];

  const ahora = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from(TABLA)
    .upsert(
      documentos.map((d) => ({ ...d, sincronizada_at: ahora })),
      {
        onConflict: "cia,co_docto,tipo_documento,numero_factura",
        ignoreDuplicates: false,
      },
    )
    .select("id, numero_factura, tipo_documento, fecha_factura");

  if (error) throw error;
  return data;
}

export async function listar({
  desde,
  hasta,
  cobertura,
  tipo_documento: tipo,
  origen,
  texto,
  limite = TECHO_FILAS,
}) {
  let consulta = supabaseAdmin
    .from(VISTA)
    .select("*", { count: "exact" })
    // Lo mas grande primero dentro del dia: si hay 200 pendientes y solo se
    // pueden revisar 20, que sean los 20 que mas plata mueven.
    .order("fecha_factura", { ascending: false })
    .order("valor_neto", { ascending: false, nullsFirst: false });

  if (desde) consulta = consulta.gte("fecha_factura", desde);
  if (hasta) consulta = consulta.lte("fecha_factura", hasta);
  if (cobertura) consulta = consulta.eq("cobertura", cobertura);
  if (tipo) consulta = consulta.eq("tipo_documento", tipo);

  // El control cubre todo, pero mirar mostrador y cliente identificado juntos
  // mezcla dos operaciones distintas. Esto no descuenta nada del conteo: solo
  // separa la vista.
  if (origen === "mostrador") consulta = consulta.eq("es_mostrador", true);
  if (origen === "identificado") consulta = consulta.eq("es_mostrador", false);

  if (texto) {
    // Mismo cuidado que en facturas.repository: las comas y parentesis parten
    // el `or=` de PostgREST y la consulta responde 400.
    const t = texto.replace(/[(),]/g, " ").trim();
    if (t) {
      consulta = consulta.or(
        `numero_factura.ilike.%${t}%,cliente_nombre.ilike.%${t}%`,
      );
    }
  }

  const { data, error, count } = await consulta.range(0, limite - 1);
  if (error) throw error;

  return { facturas: data, total: count ?? data.length };
}

export async function resumenPorDia({ desde, hasta }) {
  let consulta = supabaseAdmin
    .from(VISTA_RESUMEN)
    .select("*")
    .order("dia", { ascending: false });

  if (desde) consulta = consulta.gte("dia", desde);
  if (hasta) consulta = consulta.lte("dia", hasta);

  const { data, error } = await consulta.range(0, TECHO_FILAS - 1);
  if (error) throw error;
  return data;
}

export async function porId(id) {
  const { data, error } = await supabaseAdmin
    .from(TABLA)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function actualizarExclusion(id, cambios) {
  const { data, error } = await supabaseAdmin
    .from(TABLA)
    .update(cambios)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data;
}
