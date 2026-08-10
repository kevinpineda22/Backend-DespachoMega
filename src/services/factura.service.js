/**
 * factura.service.js — Vision por FACTURA para el panel del administrador.
 *
 * El resto del modulo razona en despachos (una sesion de trabajo). El
 * supervisor no: el quiere una linea por factura y saber en que etapa va. Esta
 * capa hace esa traduccion y arma el comparativo picking <-> auditoria, que es
 * lo unico que responde "¿lo que salio es lo que decia la factura?".
 *
 * Es de uso exclusivo del admin: las rutas lo montan detras de `requireAdmin`,
 * asi que aca no se filtra por operario.
 */
import * as facturasRepo from "../repositories/facturas.repository.js";
import * as despachosRepo from "../repositories/despachos.repository.js";
import * as alertasRepo from "../repositories/alertas.repository.js";
import * as eventosRepo from "../repositories/eventos.repository.js";
import { compararLineas } from "./comparativo.js";
import { noEncontrado } from "../lib/errores.js";

export async function listar(filtros) {
  const [listado, indicadores] = await Promise.all([
    facturasRepo.listar(filtros),
    facturasRepo.indicadores(filtros),
  ]);

  return { ...listado, conteo_por_etapa: indicadores.por_etapa };
}

/** Trae items, escaneos, alertas y bitacora de un despacho. */
async function detalleDespacho(despacho) {
  if (!despacho) return null;

  const [items, escaneos, alertas, eventos] = await Promise.all([
    despachosRepo.itemsDe(despacho.id),
    despachosRepo.escaneosDe(despacho.id),
    alertasRepo.listar({ despachoId: despacho.id }),
    eventosRepo.historialPorDespacho(despacho.id),
  ]);

  return { despacho, items, escaneos, alertas, eventos };
}

/**
 * Todo lo que necesita el panel lateral de una factura, en una sola llamada.
 *
 * Pedirlo por partes serian seis requests para pintar una misma pantalla, con
 * el agravante de que el comparativo no se puede armar hasta tenerlas todas.
 */
export async function detalle(numeroFactura) {
  const resumen = await facturasRepo.porNumero(numeroFactura);

  if (!resumen) {
    throw noEncontrado(
      `La factura ${numeroFactura} no tiene ningun despacho registrado.`,
    );
  }

  const [picking, auditoria] = await Promise.all([
    resumen.picking_id ? despachosRepo.porId(resumen.picking_id) : null,
    resumen.auditoria_id ? despachosRepo.porId(resumen.auditoria_id) : null,
  ]);

  const [detallePicking, detalleAuditoria] = await Promise.all([
    detalleDespacho(picking),
    detalleDespacho(auditoria),
  ]);

  const comparativo = detallePicking
    ? compararLineas(detallePicking.items, detalleAuditoria?.items ?? [])
    : [];

  // Una sola linea de tiempo con las dos etapas entrelazadas: leer dos
  // bitacoras en paralelo y ordenarlas mentalmente es justo el trabajo que el
  // panel tiene que ahorrar.
  const lineaTiempo = [
    ...(detallePicking?.eventos ?? []).map((e) => ({ ...e, etapa: "picking" })),
    ...(detalleAuditoria?.eventos ?? []).map((e) => ({ ...e, etapa: "auditoria" })),
  ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  return {
    resumen,
    picking: detallePicking,
    auditoria: detalleAuditoria,
    comparativo,
    linea_tiempo: lineaTiempo,
  };
}
