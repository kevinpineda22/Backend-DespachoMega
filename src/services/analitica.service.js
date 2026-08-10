/**
 * analitica.service.js — Panel del administrador.
 *
 * Capa fina sobre las vistas. Existe para que el frontend pida "el tablero" y
 * no arme cinco requests coordinados, y para que el rango por defecto (30 dias)
 * este definido en un solo lugar.
 */
import * as analiticaRepo from "../repositories/analitica.repository.js";

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
 * Tablero completo en una sola llamada. Las cinco consultas van en paralelo:
 * son independientes y esperarlas en serie multiplica por cinco el tiempo de
 * carga del panel.
 */
export async function tablero(filtros) {
  const rango = normalizarRango(filtros);
  const args = { ...filtros, ...rango };

  const [resumen, operarios, productos, picos, novedades] = await Promise.all([
    analiticaRepo.resumenDiario(args),
    analiticaRepo.porOperario(args),
    analiticaRepo.productosTop(args),
    analiticaRepo.picosTrabajo(args),
    analiticaRepo.novedadesInventario(args),
  ]);

  return {
    rango,
    resumen,
    por_operario: operarios,
    productos_top: productos,
    picos_trabajo: picos,
    novedades_inventario: novedades,
    totales: totalizar(resumen),
  };
}

/** Tarjetas de cabecera. Se calcula aca y no en SQL para no crear otra vista. */
function totalizar(resumen) {
  return resumen.reduce(
    (acumulado, fila) => ({
      despachos: acumulado.despachos + Number(fila.total_despachos || 0),
      facturas: acumulado.facturas + Number(fila.total_facturas || 0),
      items_solicitados: acumulado.items_solicitados + Number(fila.items_solicitados || 0),
      items_validados: acumulado.items_validados + Number(fila.items_validados || 0),
    }),
    { despachos: 0, facturas: 0, items_solicitados: 0, items_validados: 0 },
  );
}

export const resumen = (f) => analiticaRepo.resumenDiario({ ...f, ...normalizarRango(f) });
export const porOperario = (f) => analiticaRepo.porOperario({ ...f, ...normalizarRango(f) });
export const productosTop = (f) => analiticaRepo.productosTop({ ...f, ...normalizarRango(f) });
export const picosTrabajo = (f) => analiticaRepo.picosTrabajo({ ...f, ...normalizarRango(f) });
export const novedades = (f) => analiticaRepo.novedadesInventario({ ...f, ...normalizarRango(f) });
