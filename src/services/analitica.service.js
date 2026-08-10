/**
 * analitica.service.js — Panel del administrador.
 *
 * Capa entre las vistas diarias y el tablero. Existe por dos razones:
 *
 *   1. Que el frontend pida "el tablero" y no arme ocho requests coordinados.
 *   2. Que el colapso de dia -> rango pase por UN solo lugar. Las vistas agregan
 *      por dia y el panel las mostraba tal cual, asi que cada operario aparecia
 *      una vez por dia y el "top de productos" era el top de pares producto-dia.
 *      La regla de que solo se suma lo aditivo vive en `agregacion.js`.
 *
 * El total de facturas NO sale de aca sino de `despacho_mega_vw_facturas`, que
 * tiene una fila por factura. Ver `facturas.repository.js → indicadores`.
 */
import * as analiticaRepo from "../repositories/analitica.repository.js";
import * as facturasRepo from "../repositories/facturas.repository.js";
import {
  agruparPorOperario,
  agruparProductos,
  agruparNovedadesPorItem,
  agruparCalidad,
  totalizar,
  serieDiaria,
  mapaDeCalor,
} from "./agregacion.js";

const DIAS_POR_DEFECTO = 30;

const fecha = (d) => d.toISOString().slice(0, 10);

/** Completa el rango cuando el frontend no lo manda. */
function normalizarRango({ desde, hasta }) {
  const fin = hasta ? new Date(hasta) : new Date();
  const inicio = desde
    ? new Date(desde)
    : new Date(fin.getTime() - DIAS_POR_DEFECTO * 24 * 60 * 60 * 1000);

  return { desde: fecha(inicio), hasta: fecha(fin) };
}

/**
 * Tablero completo en una sola llamada. Las consultas van en paralelo: son
 * independientes y esperarlas en serie multiplica el tiempo de carga del panel.
 */
export async function tablero(filtros) {
  const rango = normalizarRango(filtros);
  const args = { ...filtros, ...rango };
  const limite = filtros.limite || 20;

  const [
    resumen,
    operariosDia,
    productosDia,
    picos,
    novedades,
    itemsDia,
    calidadDia,
    indicadores,
  ] = await Promise.all([
    analiticaRepo.resumenDiario(args),
    analiticaRepo.porOperario(args),
    analiticaRepo.productosTop(args),
    analiticaRepo.picosTrabajo(args),
    analiticaRepo.novedadesInventario(args),
    analiticaRepo.novedadesPorItem(args),
    analiticaRepo.calidadEscaneo(args),
    facturasRepo.indicadores(rango),
  ]);

  return {
    rango,

    // Series listas para graficar, no filas crudas por dia.
    serie_diaria: serieDiaria(resumen),
    mapa_calor: mapaDeCalor(picos),

    por_operario: agruparPorOperario(operariosDia),
    productos_top: agruparProductos(productosDia, limite),
    novedades_por_item: agruparNovedadesPorItem(itemsDia, limite),
    calidad_escaneo: agruparCalidad(calidadDia),
    novedades_inventario: novedades,

    totales: {
      ...totalizar(resumen),
      // De la vista de facturas, no del resumen diario: ahi estaba inflado.
      facturas: indicadores.facturas,
      facturas_auditadas: indicadores.auditadas,
      facturas_con_diferencia: indicadores.con_diferencia,
      unidades_diferencia: indicadores.unidades_diferencia,
      tasa_discrepancia: indicadores.tasa_discrepancia,
      novedades_abiertas: novedades.filter((n) =>
        ["abierta", "en_gestion"].includes(n.estado),
      ).length,
    },

    por_etapa: indicadores.por_etapa,
  };
}

// Endpoints sueltos. Devuelven lo mismo que el tablero pero de a una metrica,
// para cuando se quiere refrescar una sola tarjeta sin recargar todo.
export const resumen = async (f) =>
  serieDiaria(await analiticaRepo.resumenDiario({ ...f, ...normalizarRango(f) }));

export const porOperario = async (f) =>
  agruparPorOperario(await analiticaRepo.porOperario({ ...f, ...normalizarRango(f) }));

export const productosTop = async (f) =>
  agruparProductos(
    await analiticaRepo.productosTop({ ...f, ...normalizarRango(f) }),
    f.limite || 20,
  );

export const picosTrabajo = async (f) =>
  mapaDeCalor(await analiticaRepo.picosTrabajo({ ...f, ...normalizarRango(f) }));

export const novedades = (f) =>
  analiticaRepo.novedadesInventario({ ...f, ...normalizarRango(f) });

export const calidadEscaneo = async (f) =>
  agruparCalidad(await analiticaRepo.calidadEscaneo({ ...f, ...normalizarRango(f) }));
