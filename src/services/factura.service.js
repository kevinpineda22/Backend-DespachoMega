/**
 * factura.service.js — Vision por FACTURA para el panel del administrador.
 *
 * El resto del modulo razona en despachos (una sesion de trabajo). El
 * supervisor no: el quiere una linea por factura y saber en que etapa va. Esta
 * capa hace esa traduccion y arma el detalle de la auditoria, que es lo que
 * responde "¿lo que salio es lo que decia la factura?".
 *
 * Es de uso exclusivo del admin: las rutas lo montan detras de `requireAdmin`,
 * asi que aca no se filtra por operario.
 */
import * as facturasRepo from "../repositories/facturas.repository.js";
import * as despachosRepo from "../repositories/despachos.repository.js";
import * as alertasRepo from "../repositories/alertas.repository.js";
import * as eventosRepo from "../repositories/eventos.repository.js";
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
 * Pedirlo por partes serian cinco requests para pintar una misma pantalla.
 *
 * Cada escaneo viaja con `resultado` y `motivo`: asi el panel distingue lo que
 * se leyo con el lector (`aceptado`) de lo que el operario paso sin escanear
 * (`pasado_sin_escanear`), y muestra por que cuando lo escribio.
 */
export async function detalle(numeroFactura) {
  const resumen = await facturasRepo.porNumero(numeroFactura);

  if (!resumen) {
    throw noEncontrado(
      `La factura ${numeroFactura} no tiene ningun despacho registrado.`,
    );
  }

  const despacho = await despachosRepo.porId(resumen.despacho_id);
  const auditoria = await detalleDespacho(despacho);

  // La bitacora viene de mas reciente a mas viejo; el panel la lee de corrido.
  const lineaTiempo = [...(auditoria?.eventos ?? [])].sort(
    (a, b) => new Date(a.created_at) - new Date(b.created_at),
  );

  return { resumen, auditoria, linea_tiempo: lineaTiempo };
}
