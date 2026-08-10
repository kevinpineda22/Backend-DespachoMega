/**
 * analitica.repository.js — Lectura de las vistas de analitica.
 *
 * Todo sale de `despacho_mega_vw_*` (ver db/migrations/002 y 007). La definicion
 * de cada metrica vive en SQL, no aca: este archivo solo filtra y ordena.
 *
 * POR QUE ACA NO SE APLICA `limite`
 * Las vistas agregan POR DIA. Cortar en 100 filas antes de sumar el rango daba
 * el bug que tenia el panel: "productos mas despachados" era en realidad el top
 * 100 de pares producto-dia, no el top de productos. El recorte se aplica
 * DESPUES de agrupar, en `agregacion.js`. Lo que se trae aca tiene que ser el
 * rango completo.
 */
import { supabaseAdmin } from "../config/supabase.js";

// Techo de seguridad para no traerse la base entera si alguien pide dos años.
// Es alto a proposito: 30 dias de operacion normal quedan un orden de magnitud
// por debajo. Si algun dia se alcanza, la respuesta correcta es agregar por
// semana o mes en SQL (ver docs/PENDIENTES.md §8), no subir este numero.
const TECHO_FILAS = 5000;

const rango = (consulta, columna, desde, hasta) => {
  let q = consulta;
  if (desde) q = q.gte(columna, desde);
  if (hasta) q = q.lte(columna, hasta);
  return q;
};

async function ejecutar(consulta) {
  const { data, error } = await consulta.range(0, TECHO_FILAS - 1);
  if (error) throw error;
  return data;
}

export async function resumenDiario({ desde, hasta, modo }) {
  let consulta = supabaseAdmin
    .from("despacho_mega_vw_resumen_diario")
    .select("*")
    .order("dia", { ascending: false });

  if (modo) consulta = consulta.eq("modo", modo);
  consulta = rango(consulta, "dia", desde, hasta);

  return ejecutar(consulta);
}

export async function porOperario({ desde, hasta, modo, operario_id: operarioId }) {
  let consulta = supabaseAdmin
    .from("despacho_mega_vw_por_operario")
    .select("*")
    .order("dia", { ascending: false });

  if (modo) consulta = consulta.eq("modo", modo);
  if (operarioId) consulta = consulta.eq("operario_id", operarioId);
  consulta = rango(consulta, "dia", desde, hasta);

  return ejecutar(consulta);
}

export async function productosTop({ desde, hasta }) {
  const consulta = rango(
    supabaseAdmin
      .from("despacho_mega_vw_productos_top")
      .select("*")
      .order("dia", { ascending: false }),
    "dia",
    desde,
    hasta,
  );

  return ejecutar(consulta);
}

export async function picosTrabajo({ desde, hasta }) {
  const consulta = rango(
    supabaseAdmin
      .from("despacho_mega_vw_picos_trabajo")
      .select("*")
      .order("dia", { ascending: false })
      .order("hora", { ascending: true }),
    "dia",
    desde,
    hasta,
  );

  return ejecutar(consulta);
}

export async function novedadesInventario({ desde, hasta, limite }) {
  let consulta = supabaseAdmin
    .from("despacho_mega_vw_novedades_inventario")
    .select("*")
    .order("created_at", { ascending: false });

  consulta = rango(consulta, "dia", desde, hasta);

  const { data, error } = await consulta.range(0, (limite || TECHO_FILAS) - 1);
  if (error) throw error;
  return data;
}

/** Novedades agrupadas por item y dia. Se suma el rango en `agregacion.js`. */
export async function novedadesPorItem({ desde, hasta }) {
  const consulta = rango(
    supabaseAdmin
      .from("despacho_mega_vw_novedades_por_item")
      .select("*")
      .order("dia", { ascending: false }),
    "dia",
    desde,
    hasta,
  );

  return ejecutar(consulta);
}

/** Aciertos y rechazos de escaneo por operario y dia. */
export async function calidadEscaneo({ desde, hasta, operario_id: operarioId }) {
  let consulta = supabaseAdmin
    .from("despacho_mega_vw_calidad_escaneo")
    .select("*")
    .order("dia", { ascending: false });

  if (operarioId) consulta = consulta.eq("operario_id", operarioId);
  consulta = rango(consulta, "dia", desde, hasta);

  return ejecutar(consulta);
}
