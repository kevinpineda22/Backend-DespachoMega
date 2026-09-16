/**
 * facturas.repository.js — Lectura de `despacho_mega_vw_facturas`.
 *
 * La vista tiene una fila por auditoria, con el despachador resuelto por JOIN
 * (ver db/migrations/012). Aca solo se filtra, ordena y pagina: la definicion
 * de "etapa" y de "diferencia" vive en SQL, no repartida entre backend y
 * frontend.
 */
import { supabaseAdmin } from "../config/supabase.js";

const VISTA = "despacho_mega_vw_facturas";

/**
 * Un `or=(...)` de PostgREST se parsea por comas y parentesis. Si el operador
 * teclea "SAS, LTDA" en el buscador, esa coma parte la condicion y la consulta
 * responde 400. Se limpian los tres caracteres estructurales en vez de escapar:
 * ninguno aporta nada a una busqueda por numero de factura o nombre de cliente.
 */
const limpiarParaOr = (texto) => texto.replace(/[(),]/g, " ").trim();

export async function listar(filtros) {
  const {
    etapa,
    operario_id: operarioId,
    texto,
    sede,
    desde,
    hasta,
    con_novedades: conNovedades,
    con_diferencia: conDiferencia,
    estancadas_minutos: estancadasMinutos,
    limite,
    offset,
  } = filtros;

  let consulta = supabaseAdmin
    .from(VISTA)
    .select("*", { count: "exact" })
    // Lo mas recientemente tocado primero: el panel es un monitor de lo que
    // esta pasando, no un archivo historico.
    .order("ultimo_movimiento_at", { ascending: false, nullsFirst: false })
    .range(offset, offset + limite - 1);

  if (etapa) consulta = consulta.eq("etapa", etapa);
  if (sede) consulta = consulta.eq("sede", sede);

  if (operarioId) consulta = consulta.eq("operario_id", operarioId);

  if (texto) {
    const t = limpiarParaOr(texto);
    if (t) {
      consulta = consulta.or(
        `numero_factura.ilike.%${t}%,cliente_nombre.ilike.%${t}%`,
      );
    }
  }

  if (desde) consulta = consulta.gte("iniciado_at", `${desde}T00:00:00Z`);
  if (hasta) consulta = consulta.lte("iniciado_at", `${hasta}T23:59:59Z`);

  if (conNovedades) consulta = consulta.gt("novedades_abiertas", 0);
  if (conDiferencia) consulta = consulta.eq("tiene_diferencia", true);

  // ESTANCADAS: sin movimiento hace mas de N minutos y todavia con alguien
  // trabajando. Sin la restriccion de etapa, toda factura terminada hace un mes
  // aparecereria como estancada, que es exactamente el ruido que se quiere
  // evitar.
  if (estancadasMinutos) {
    const corte = new Date(Date.now() - estancadasMinutos * 60 * 1000).toISOString();
    consulta = consulta
      .lt("ultimo_movimiento_at", corte)
      .eq("etapa", "auditando");
  }

  const { data, error, count } = await consulta;
  if (error) throw error;

  return { facturas: data, total: count ?? data.length };
}

export async function porNumero(numeroFactura) {
  const { data, error } = await supabaseAdmin
    .from(VISTA)
    .select("*")
    .eq("numero_factura", numeroFactura)
    .maybeSingle();

  if (error) throw error;
  return data;
}

// Techo de seguridad, mismo criterio que en analitica.repository.js.
const TECHO_FILAS = 5000;

/**
 * Indicadores del rango calculados sobre la vista de facturas.
 *
 * ES LA FUENTE CORRECTA PARA "TOTAL DE FACTURAS". El resumen diario trae
 * `total_facturas` como COUNT(DISTINCT) por dia+estado, y sumarlo contaba la
 * misma factura otra vez si cambiaba de estado. Aca hay exactamente una fila
 * por factura, asi que contar filas es contar facturas.
 *
 * Se trae una sola vez y se cuenta en memoria: seis `count` con `head: true`
 * serian seis viajes para responder una pregunta que cabe en uno.
 */
export async function indicadores({ desde, hasta }) {
  let consulta = supabaseAdmin
    .from(VISTA)
    .select("etapa, tiene_diferencia, unidades_diferencia, finalizado_at");

  if (desde) consulta = consulta.gte("iniciado_at", `${desde}T00:00:00Z`);
  if (hasta) consulta = consulta.lte("iniciado_at", `${hasta}T23:59:59Z`);

  const { data, error } = await consulta.range(0, TECHO_FILAS - 1);
  if (error) throw error;

  const porEtapa = {};
  let auditadas = 0;
  let conDiferencia = 0;
  let unidadesDiferencia = 0;

  for (const f of data) {
    porEtapa[f.etapa] = (porEtapa[f.etapa] || 0) + 1;

    // Solo cuentan las auditorias CERRADAS: mientras corre, todo lo que el
    // auditor aun no escaneo se veria como diferencia.
    if (f.finalizado_at) {
      auditadas++;
      if (f.tiene_diferencia) {
        conDiferencia++;
        unidadesDiferencia += Number(f.unidades_diferencia || 0);
      }
    }
  }

  return {
    facturas: data.length,
    por_etapa: porEtapa,
    auditadas,
    con_diferencia: conDiferencia,
    unidades_diferencia: unidadesDiferencia,
    // LA METRICA QUE JUSTIFICA EL MODULO: de las auditorias cerradas, cuantas
    // quedaron con faltante frente a lo facturado. Si sostenidamente da cero,
    // la auditoria es un costo sin retorno; si no, ahi esta el caso de negocio.
    tasa_discrepancia: auditadas ? (conDiferencia / auditadas) * 100 : null,
  };
}
