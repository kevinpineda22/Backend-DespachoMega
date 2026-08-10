/**
 * alerta.service.js — Novedades que el operario le reporta a inventario.
 *
 * COMO LLEGA LA ALERTA A INVENTARIO
 * Por dos canales, y el orden importa:
 *
 *   1. Supabase Realtime — canal principal. La alerta se INSERTA y el panel del
 *      administrador la ve en el momento, porque ya escucha
 *      `despacho_mega_alertas_inventario` (ver db/migrations/001).
 *
 *   2. Correo — respaldo, para cuando nadie tiene el panel abierto. Es
 *      best-effort: se dispara DESPUES del insert y su resultado se ignora.
 *      Que el SMTP falle no puede tumbar el reporte de un faltante que el
 *      operario ya hizo.
 */
import * as alertasRepo from "../repositories/alertas.repository.js";
import * as despachosRepo from "../repositories/despachos.repository.js";
import * as eventosRepo from "../repositories/eventos.repository.js";
import { EVENTO } from "../repositories/eventos.repository.js";
import { notificarAlertaInventario } from "../lib/correo.js";
import { conflicto, noEncontrado, prohibido, solicitudInvalida } from "../lib/errores.js";

export async function crear(datos, usuario) {
  const despacho = await despachosRepo.porId(datos.despacho_id);
  if (!despacho) throw noEncontrado("Despacho no encontrado.");

  if (usuario.rol !== "admin" && despacho.operario_id !== usuario.operarioId) {
    throw prohibido("Este despacho pertenece a otro operario.");
  }

  if (despacho.estado === "cancelado") {
    throw conflicto("No se pueden reportar novedades sobre un despacho cancelado.");
  }

  // La descripcion se copia de la linea de la factura en vez de pedirsela al
  // cliente: asi la alerta describe el producto tal como Siesa lo nombra, y no
  // como lo escribio quien la reporto.
  let descripcion = null;
  if (datos.item_id) {
    const items = await despachosRepo.itemsDe(despacho.id);
    descripcion = items.find((i) => i.id === datos.item_id)?.descripcion ?? null;
  }

  const alerta = await alertasRepo.crear({
    despacho_id: datos.despacho_id,
    item_id: datos.item_id ?? null,
    codigo_item: datos.codigo_item,
    descripcion,
    cantidad_faltante: datos.cantidad_faltante,
    motivo: datos.motivo,
    comentario: datos.comentario ?? null,
    estado: "abierta",
    reportada_por: usuario.operarioId,
  });

  await eventosRepo.registrar({
    despachoId: despacho.id,
    actorUserId: usuario.userId,
    actorCorreo: usuario.correo,
    evento: EVENTO.ALERTA_CREADA,
    payload: {
      codigo_item: datos.codigo_item,
      motivo: datos.motivo,
      cantidad_faltante: datos.cantidad_faltante,
    },
  });

  // Sin `await`: el operario no tiene por que esperar a Office 365 para seguir
  // escaneando. `notificarAlertaInventario` nunca lanza, asi que este promise
  // suelto no puede terminar en un rechazo sin capturar.
  //
  // OJO EN VERCEL: al responder, la funcion serverless puede congelarse antes
  // de que el correo salga. No se pierde la alerta (ya esta en la base y viajo
  // por Realtime), pero el correo es best-effort de verdad. Si algun dia tiene
  // que ser confiable, el camino es una cola o un trigger de base de datos, no
  // un `await` aca. Ver docs/PENDIENTES.md.
  notificarAlertaInventario({
    numeroFactura: despacho.numero_factura,
    modo: despacho.modo,
    codigoItem: datos.codigo_item,
    descripcion,
    cantidadFaltante: datos.cantidad_faltante,
    motivo: datos.motivo,
    comentario: datos.comentario,
    reportadoPor: `${usuario.nombre} (${usuario.correo})`,
  });

  return alerta;
}

export async function listar(filtros) {
  return alertasRepo.listar(filtros);
}

/** Bandeja del administrador: la vista enriquecida mas el conteo por estado. */
export async function bandeja(filtros) {
  const [novedades, conteo] = await Promise.all([
    alertasRepo.bandeja(filtros),
    alertasRepo.conteoPorEstado(filtros),
  ]);

  return { novedades, conteo_por_estado: conteo };
}

// Cerrar una novedad es afirmar algo sobre el inventario, y eso tiene que
// quedar escrito. `descartada` sobre todo: significa "el operario se equivoco",
// y esa afirmacion hay que poder sustentarla dentro de un mes.
const ESTADOS_CERRADOS = ["resuelta", "descartada"];

/** Gestion de la alerta por parte del administrador / inventario. */
export async function actualizar(id, { estado, respuesta }, usuario) {
  const alerta = await alertasRepo.porId(id);
  if (!alerta) throw noEncontrado("Alerta no encontrada.");

  const cerrada = ESTADOS_CERRADOS.includes(estado);
  const texto = respuesta?.trim() || alerta.respuesta?.trim() || null;

  if (cerrada && !texto) {
    throw solicitudInvalida(
      `Para marcar la novedad como ${estado} hay que escribir que se hizo. ` +
        "Una novedad cerrada sin explicacion no sirve como antecedente.",
    );
  }

  const actualizada = await alertasRepo.actualizar(id, {
    estado,
    respuesta: texto,
    atendida_por: usuario.userId,
    // Se limpia al reabrir: `minutos_abierta` usa COALESCE(resuelta_at, NOW()),
    // asi que dejar la fecha vieja congelaria el reloj de una novedad que
    // volvio a estar en gestion.
    resuelta_at: cerrada ? new Date().toISOString() : null,
  });

  await eventosRepo.registrar({
    despachoId: alerta.despacho_id,
    actorUserId: usuario.userId,
    actorCorreo: usuario.correo,
    evento: EVENTO.ALERTA_ACTUALIZADA,
    payload: { alerta_id: id, estado, respuesta: respuesta ?? null },
  });

  return actualizada;
}
