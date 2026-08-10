/**
 * despacho.service.js — Reglas de negocio del picking y la auditoria.
 *
 * Todo lo que decide si un escaneo vale o no vale esta aca. Los controladores
 * solo traducen HTTP; los repositorios solo hablan con Supabase.
 */
import * as despachosRepo from "../repositories/despachos.repository.js";
import * as alertasRepo from "../repositories/alertas.repository.js";
import * as eventosRepo from "../repositories/eventos.repository.js";
import { EVENTO } from "../repositories/eventos.repository.js";
import { resolverCodigo } from "../repositories/catalogo.repository.js";
import { consultarFactura } from "./facturaSiesa.service.js";
import { conflicto, noEncontrado, prohibido, solicitudInvalida } from "../lib/errores.js";

const ESTADOS_CERRADOS = ["completado", "aprobado", "rechazado"];

/** Un operario solo ve lo suyo; el admin ve todo. */
function asegurarAcceso(despacho, usuario) {
  if (usuario.rol === "admin") return;
  if (despacho.operario_id !== usuario.operarioId) {
    throw prohibido("Este despacho pertenece a otro operario.");
  }
}

// ---------------------------------------------------------------------------
// Abrir / reanudar
// ---------------------------------------------------------------------------

/**
 * Abre una factura en el modo pedido, o reanuda la que ya estaba en curso.
 *
 * Por que reanudar en vez de crear otra: el operario puede quedarse sin bateria
 * o cerrar el navegador a mitad de camino. Si al volver a teclear la factura se
 * creara un despacho nuevo, el avance se perderia y quedarian dos registros
 * compitiendo por la misma factura.
 *
 * @param {{ numeroFactura: string, modo: 'picking'|'auditoria', usuario: object,
 *           tipoDocumento?: string }} args
 */
export async function abrir({ numeroFactura, modo, usuario, tipoDocumento }) {
  const vigente = await despachosRepo.despachoVigente(numeroFactura, modo);

  if (vigente) {
    if (ESTADOS_CERRADOS.includes(vigente.estado)) {
      throw conflicto(
        `La factura ${numeroFactura} ya fue procesada en modo ${modo} (estado: ${vigente.estado}).`,
      );
    }

    asegurarAcceso(vigente, usuario);

    await eventosRepo.registrar({
      despachoId: vigente.id,
      actorUserId: usuario.userId,
      actorCorreo: usuario.correo,
      evento: EVENTO.DESPACHO_REANUDADO,
      payload: { numero_factura: numeroFactura, modo },
    });

    const items = await despachosRepo.itemsDe(vigente.id);
    return { despacho: vigente, items, reanudado: true };
  }

  const { encabezado, items, filasCrudas } = await consultarFactura(numeroFactura, {
    tipoDocumento,
  });

  const despacho = await despachosRepo.crearConItems(
    {
      numero_factura: encabezado.numero_factura,
      tipo_documento: encabezado.tipo_documento,
      fecha_factura: encabezado.fecha_factura,
      modo,
      estado: "en_proceso",
      operario_id: usuario.operarioId,
      cliente_nit: encabezado.cliente_nit,
      cliente_nombre: encabezado.cliente_nombre,
      sede: encabezado.sede,
      bodega: encabezado.bodega,
      total_items: items.length,
      items_validados: 0,
      snapshot_siesa: filasCrudas,
    },
    items,
  );

  await eventosRepo.registrar({
    despachoId: despacho.id,
    actorUserId: usuario.userId,
    actorCorreo: usuario.correo,
    evento: EVENTO.DESPACHO_ABIERTO,
    payload: { numero_factura: numeroFactura, modo, total_items: items.length },
  });

  return {
    despacho,
    items: await despachosRepo.itemsDe(despacho.id),
    reanudado: false,
  };
}

// ---------------------------------------------------------------------------
// Consultar
// ---------------------------------------------------------------------------

export async function obtener(id, usuario) {
  const despacho = await despachosRepo.porId(id);
  if (!despacho) throw noEncontrado("Despacho no encontrado.");
  asegurarAcceso(despacho, usuario);

  const [items, escaneos, alertas, aprobaciones] = await Promise.all([
    despachosRepo.itemsDe(id),
    despachosRepo.escaneosDe(id),
    alertasRepo.listar({ despachoId: id }),
    despachosRepo.aprobacionesDe(id),
  ]);

  return { despacho, items, escaneos, alertas, aprobaciones };
}

export async function listar(filtros) {
  return despachosRepo.listar(filtros);
}

// ---------------------------------------------------------------------------
// Validar un escaneo
// ---------------------------------------------------------------------------

/**
 * Procesa un escaneo o un ingreso manual contra las lineas de la factura.
 *
 * SIEMPRE deja rastro: los intentos rechazados tambien se guardan en
 * `despacho_mega_escaneos`. Un operario que escanea diez veces algo que no va
 * es informacion — de capacitacion, de rotulado, o de que la factura esta mal.
 *
 * @returns {{ resultado: string, mensaje: string, item?: object, despacho?: object }}
 */
export async function validar(id, { codigo, metodo, cantidad }, usuario) {
  const despacho = await despachosRepo.porId(id);
  if (!despacho) throw noEncontrado("Despacho no encontrado.");
  asegurarAcceso(despacho, usuario);

  if (despacho.estado !== "en_proceso") {
    throw conflicto(
      `El despacho esta en estado ${despacho.estado} y ya no admite escaneos.`,
    );
  }

  // CONTEO MIXTO. `factor` dice cuantas unidades base vale UN escaneo de este
  // codigo: escanear el paquete P12 suma 12, escanear la botella suma 1. La
  // factura pide unidades base (verificado contra Siesa: `CANTIDAD` viene en
  // unidad base aunque `UNIDAD_MEDIDA` diga P12), asi que todo el conteo se
  // hace en esa moneda y `cantidad` solo dice cuantos escaneos representa.
  const { codigoItem, factor, unidad, origen } = await resolverCodigo(codigo);
  const unidadesBase = cantidad * factor;

  const items = await despachosRepo.itemsDe(id);
  const coincidencias = items.filter((i) => i.codigo_item === codigoItem);

  const rechazar = async (resultado, mensaje, item = null) => {
    await despachosRepo.registrarEscaneo({
      despacho_id: id,
      item_id: item?.id ?? null,
      operario_id: usuario.operarioId,
      codigo_ingresado: codigo,
      codigo_item_resuelto: codigoItem,
      metodo,
      resultado,
      // Se guarda en unidades base, no en numero de escaneos: es la moneda en
      // la que esta todo lo demas y evita tener que saber el factor para leer
      // el historial.
      cantidad: unidadesBase,
    });

    await eventosRepo.registrar({
      despachoId: id,
      actorUserId: usuario.userId,
      actorCorreo: usuario.correo,
      evento: EVENTO.ESCANEO_RECHAZADO,
      payload: { codigo, codigoItem, resultado },
    });

    return { resultado, mensaje, item };
  };

  if (coincidencias.length === 0) {
    // `directo` = el codigo no se reconocio en ningun lado. Cualquier otro
    // origen significa que SI sabemos que producto es, y entonces el problema
    // es que no pertenece a esta factura. La diferencia le importa al operario:
    // "producto equivocado" y "codigo ilegible" se resuelven distinto.
    return origen === "directo"
      ? rechazar(
          "no_encontrado",
          `El codigo ${codigo} no corresponde a ningun producto conocido.`,
        )
      : rechazar(
          "no_pertenece",
          `El producto ${codigoItem} no hace parte de la factura ${despacho.numero_factura}.`,
        );
  }

  // Un item puede aparecer en varias lineas. Se llena la primera que tenga
  // cupo, en orden de factura: asi el avance se ve donde el operario lo espera.
  const objetivo = coincidencias.find(
    (i) => Number(i.cantidad_validada) < Number(i.cantidad_solicitada),
  );

  if (!objetivo) {
    return rechazar(
      "item_completo",
      `El producto ${codigoItem} ya esta completo en esta factura.`,
      coincidencias[0],
    );
  }

  const validadaActual = Number(objetivo.cantidad_validada);
  const solicitada = Number(objetivo.cantidad_solicitada);
  const restante = solicitada - validadaActual;

  // REGLA DE NEGOCIO CONFIRMADA: no se despacha mas de lo facturado. El exceso
  // se rechaza entero, no se aplica parcialmente hasta completar. Aplicar la
  // parte que cabe dejaria a la linea completa y al operario creyendo que su
  // escaneo entro tal cual, que es peor que un rechazo claro.
  if (unidadesBase > restante) {
    // Se nombra el paquete cuando lo hubo: "escaneaste un P12 (12 unidades) y
    // solo faltan 5" es accionable; "se intento validar 12" deja al operario
    // sin saber por que, si el escaneo fue uno solo.
    const detalle =
      factor > 1
        ? `un ${unidad} equivale a ${factor} unidades`
        : `se intento validar ${unidadesBase}`;

    return rechazar(
      "excede_cantidad",
      `Solo faltan ${restante} unidades de ${codigoItem}; ${detalle}.`,
      objetivo,
    );
  }

  const nuevaCantidad = validadaActual + unidadesBase;
  const estadoItem = nuevaCantidad >= solicitada ? "completo" : "parcial";

  const actualizado = await despachosRepo.actualizarItem(objetivo.id, {
    cantidad_validada: nuevaCantidad,
    estado_item: estadoItem,
    validado_por: usuario.operarioId,
    validado_at: new Date().toISOString(),
  });

  const completos = items.filter(
    (i) => (i.id === objetivo.id ? estadoItem : i.estado_item) === "completo",
  ).length;

  const despachoActualizado = await despachosRepo.actualizar(id, {
    items_validados: completos,
  });

  await despachosRepo.registrarEscaneo({
    despacho_id: id,
    item_id: objetivo.id,
    operario_id: usuario.operarioId,
    codigo_ingresado: codigo,
    codigo_item_resuelto: codigoItem,
    metodo,
    resultado: "aceptado",
    // Unidades base, igual que en `rechazar`. Si aceptados y rechazados se
    // guardaran en escalas distintas, la bitacora seria imposible de sumar.
    cantidad: unidadesBase,
  });

  await eventosRepo.registrar({
    despachoId: id,
    actorUserId: usuario.userId,
    actorCorreo: usuario.correo,
    evento: EVENTO.ITEM_VALIDADO,
    payload: {
      codigoItem,
      unidadesBase,
      factor,
      unidad,
      estadoItem,
      linea: objetivo.linea,
    },
  });

  // Cuando el escaneo valio mas de una unidad se dice explicitamente: el
  // operario tiene que poder confirmar que el sistema conto el paquete, no una
  // botella suelta.
  const aporte = factor > 1 ? ` (+${unidadesBase} por ${unidad})` : "";

  return {
    resultado: "aceptado",
    mensaje:
      estadoItem === "completo"
        ? `Producto ${codigoItem} completo${aporte}.`
        : `Van ${nuevaCantidad} de ${solicitada} de ${codigoItem}${aporte}.`,
    item: actualizado,
    despacho: despachoActualizado,
  };
}

// ---------------------------------------------------------------------------
// Cerrar
// ---------------------------------------------------------------------------

/**
 * Cierra el despacho. No exige que todo este completo: un despacho con
 * faltantes es un hecho real del negocio, no un error a bloquear. Se marca
 * `con_novedad` y queda para que el administrador lo revise.
 */
export async function finalizar(id, { observaciones }, usuario) {
  const despacho = await despachosRepo.porId(id);
  if (!despacho) throw noEncontrado("Despacho no encontrado.");
  asegurarAcceso(despacho, usuario);

  if (despacho.estado !== "en_proceso") {
    throw conflicto(`El despacho ya fue cerrado (estado: ${despacho.estado}).`);
  }

  const [items, alertasAbiertas] = await Promise.all([
    despachosRepo.itemsDe(id),
    alertasRepo.abiertasDe(id),
  ]);

  // Las lineas que quedaron cortas se marcan explicitamente. Sin este paso,
  // una linea sin escanear quedaria como `pendiente` para siempre y la
  // analitica no podria distinguir "no se despacho" de "todavia no se toca".
  const incompletas = items.filter(
    (i) => Number(i.cantidad_validada) < Number(i.cantidad_solicitada),
  );

  await Promise.all(
    incompletas.map((i) =>
      despachosRepo.actualizarItem(i.id, {
        estado_item: Number(i.cantidad_validada) > 0 ? "parcial" : "faltante",
      }),
    ),
  );

  const estado =
    incompletas.length > 0 || alertasAbiertas.length > 0
      ? "con_novedad"
      : "completado";

  const actualizado = await despachosRepo.actualizar(id, {
    estado,
    observaciones: observaciones ?? despacho.observaciones,
    finalizado_at: new Date().toISOString(),
  });

  await eventosRepo.registrar({
    despachoId: id,
    actorUserId: usuario.userId,
    actorCorreo: usuario.correo,
    evento: EVENTO.DESPACHO_FINALIZADO,
    payload: {
      estado,
      lineas_incompletas: incompletas.length,
      alertas_abiertas: alertasAbiertas.length,
    },
  });

  return { despacho: actualizado, incompletas: incompletas.length };
}

/**
 * Cancela un despacho. Libera el numero de factura (el indice unico excluye
 * los cancelados) para poder reintentar sin borrar historial.
 */
export async function cancelar(id, usuario) {
  const despacho = await despachosRepo.porId(id);
  if (!despacho) throw noEncontrado("Despacho no encontrado.");
  asegurarAcceso(despacho, usuario);

  if (ESTADOS_CERRADOS.includes(despacho.estado)) {
    throw conflicto("No se puede cancelar un despacho ya cerrado.");
  }

  const actualizado = await despachosRepo.actualizar(id, {
    estado: "cancelado",
    finalizado_at: new Date().toISOString(),
  });

  await eventosRepo.registrar({
    despachoId: id,
    actorUserId: usuario.userId,
    actorCorreo: usuario.correo,
    evento: EVENTO.DESPACHO_CANCELADO,
  });

  return actualizado;
}

// ---------------------------------------------------------------------------
// Aprobacion del administrador
// ---------------------------------------------------------------------------

/**
 * Registra la decision del admin. Si `item_id` viene, aplica solo a esa linea
 * y el despacho no cambia de estado; sin `item_id`, cierra el despacho entero.
 */
export async function aprobar(id, { item_id: itemId, decision, observacion }, usuario) {
  const despacho = await despachosRepo.porId(id);
  if (!despacho) throw noEncontrado("Despacho no encontrado.");

  if (despacho.estado === "en_proceso") {
    throw solicitudInvalida(
      "El despacho todavia esta en proceso; el operario debe finalizarlo primero.",
    );
  }

  const registro = await despachosRepo.registrarAprobacion({
    despacho_id: id,
    item_id: itemId ?? null,
    admin_user_id: usuario.userId,
    admin_correo: usuario.correo,
    decision,
    observacion: observacion ?? null,
  });

  let actualizado = despacho;

  if (!itemId) {
    actualizado = await despachosRepo.actualizar(id, { estado: decision });
  }

  await eventosRepo.registrar({
    despachoId: id,
    actorUserId: usuario.userId,
    actorCorreo: usuario.correo,
    evento:
      decision === "aprobado"
        ? EVENTO.DESPACHO_APROBADO
        : EVENTO.DESPACHO_RECHAZADO,
    payload: { item_id: itemId ?? null, observacion: observacion ?? null },
  });

  return { aprobacion: registro, despacho: actualizado };
}
