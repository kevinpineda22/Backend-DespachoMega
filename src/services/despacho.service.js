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
  // La caja se exige SOLO para picking, y solo al crear.
  //
  // En auditoria no se pide porque esa se abre contra el picking finalizado,
  // que ya tiene la caja resuelta: volver a preguntarla seria pedir dos veces
  // el mismo dato y abrir la puerta a que las dos respuestas no coincidan.
  //
  // Se valida antes de tocar la base: si falta, no tiene sentido ni buscar si
  // hay un despacho vigente.
  if (modo === "picking" && !tipoDocumento) {
    throw solicitudInvalida(
      "Debe seleccionar la caja de la factura antes de continuar.",
    );
  }

  const vigente = await despachosRepo.despachoVigente(numeroFactura, modo);

  if (vigente) {
    if (ESTADOS_CERRADOS.includes(vigente.estado)) {
      throw conflicto(
        `La factura ${numeroFactura} ya fue procesada en modo ${modo} (estado: ${vigente.estado}).`,
      );
    }

    asegurarAcceso(vigente, usuario);

    // La caja tambien se verifica al REANUDAR. Sin esto, exigirla al crear no
    // sirve de nada: bastaria con que la factura ya estuviera abierta para que
    // el operario entrara con la caja equivocada y siguiera trabajando sobre un
    // despacho que no es el suyo.
    if (
      tipoDocumento &&
      vigente.tipo_documento &&
      vigente.tipo_documento !== tipoDocumento
    ) {
      throw conflicto(
        `La factura ${numeroFactura} en curso es de la caja ` +
          `${vigente.tipo_documento}, no de ${tipoDocumento}.`,
        { caja_correcta: vigente.tipo_documento },
      );
    }

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

  if (modo === "auditoria") {
    return abrirAuditoria({ numeroFactura, usuario });
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

// Estados en los que un picking ya termino y puede auditarse.
const PICKING_AUDITABLE = ["completado", "con_novedad", "aprobado"];

/**
 * Abre una auditoria sobre un picking YA FINALIZADO.
 *
 * NO CONSULTA SIESA, y eso es deliberado por dos razones:
 *
 *   1. SEMANTICA. El auditor no verifica la factura, verifica **lo que el
 *      picker efectivamente alisto**. Si el picking cerro con faltantes, lo que
 *      salio de la bodega es lo validado, no lo facturado. Auditar contra la
 *      factura marcaria como faltante algo que ya se reporto y gestiono.
 *
 *   2. ALCANCE. La consulta POS de Siesa solo conserva ~4 dias (ver
 *      docs/PENDIENTES.md §1-ter). Atarse a ella dejaria sin auditar cualquier
 *      despacho de la semana pasada. Contra nuestra propia base, la auditoria
 *      funciona mientras exista el picking.
 *
 * Solo entran las lineas con cantidad validada mayor a cero: una linea que
 * nunca se alisto no tiene nada fisico que verificar, y mostrarla como 0/0
 * seria ruido que el auditor tiene que aprender a ignorar.
 */
async function abrirAuditoria({ numeroFactura, usuario }) {
  const picking = await despachosRepo.despachoVigente(numeroFactura, "picking");

  if (!picking) {
    throw conflicto(
      `La factura ${numeroFactura} no tiene picking registrado. ` +
        "Primero hay que alistarla antes de poder auditarla.",
    );
  }

  if (picking.estado === "en_proceso") {
    throw conflicto(
      `El picking de la factura ${numeroFactura} todavia esta en proceso. ` +
        "Se puede auditar cuando el operario lo finalice.",
    );
  }

  if (!PICKING_AUDITABLE.includes(picking.estado)) {
    throw conflicto(
      `El picking de la factura ${numeroFactura} esta en estado ` +
        `${picking.estado} y no se puede auditar.`,
    );
  }

  const itemsPicking = await despachosRepo.itemsDe(picking.id);
  const alistados = itemsPicking.filter((i) => Number(i.cantidad_validada) > 0);

  if (alistados.length === 0) {
    throw conflicto(
      `El picking de la factura ${numeroFactura} cerro sin alistar ningun ` +
        "producto. No hay nada que auditar.",
    );
  }

  const despacho = await despachosRepo.crearConItems(
    {
      numero_factura: picking.numero_factura,
      tipo_documento: picking.tipo_documento,
      fecha_factura: picking.fecha_factura,
      modo: "auditoria",
      estado: "en_proceso",
      operario_id: usuario.operarioId,
      cliente_nit: picking.cliente_nit,
      cliente_nombre: picking.cliente_nombre,
      sede: picking.sede,
      bodega: picking.bodega,
      total_items: alistados.length,
      items_validados: 0,
      // El snapshot de Siesa ya lo guarda el picking; `despacho_origen_id`
      // lleva hasta el. Duplicarlo solo ocuparia espacio.
      snapshot_siesa: null,
      despacho_origen_id: picking.id,
    },
    alistados.map((i, indice) => ({
      linea: indice + 1,
      codigo_item: i.codigo_item,
      descripcion: i.descripcion,
      unidad: i.unidad,
      // Lo alistado pasa a ser lo exigido: es contra eso que se verifica.
      cantidad_solicitada: i.cantidad_validada,
      precio_unitario: i.precio_unitario,
    })),
  );

  await eventosRepo.registrar({
    despachoId: despacho.id,
    actorUserId: usuario.userId,
    actorCorreo: usuario.correo,
    evento: EVENTO.DESPACHO_ABIERTO,
    payload: {
      numero_factura: numeroFactura,
      modo: "auditoria",
      total_items: alistados.length,
      picking_id: picking.id,
      picking_estado: picking.estado,
    },
  });

  return {
    despacho,
    items: await despachosRepo.itemsDe(despacho.id),
    reanudado: false,
    picking: {
      id: picking.id,
      estado: picking.estado,
      operario_id: picking.operario_id,
      finalizado_at: picking.finalizado_at,
      lineas_factura: itemsPicking.length,
      lineas_alistadas: alistados.length,
    },
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

  // Si es una auditoria, se adjunta el contexto del picking de origen (el banner
  // "Verificando el alistado"). Se resuelve ACA y no en el cliente porque el
  // picking puede ser de OTRO operario, y el cliente solo puede leer lo suyo.
  // Con esto, al recargar una auditoria en curso el banner vuelve a aparecer.
  const picking = await contextoPicking(despacho);

  return { despacho, items, escaneos, alertas, aprobaciones, picking };
}

/**
 * Arma el resumen del picking de origen de una auditoria, con la misma forma que
 * devuelve `abrir`. Devuelve `null` si el despacho no es una auditoria o si el
 * origen ya no existe. Usa el repo con `service_role`: no aplica ownership, lo
 * cual es correcto — el auditor tiene que ver contra que esta verificando aunque
 * el picking sea de otra persona.
 */
async function contextoPicking(despacho) {
  if (!despacho.despacho_origen_id) return null;

  const origen = await despachosRepo.porId(despacho.despacho_origen_id);
  if (!origen) return null;

  const itemsOrigen = await despachosRepo.itemsDe(origen.id);
  return {
    id: origen.id,
    estado: origen.estado,
    operario_id: origen.operario_id,
    finalizado_at: origen.finalizado_at,
    lineas_factura: itemsOrigen.length,
    lineas_alistadas: itemsOrigen.filter(
      (i) => Number(i.cantidad_validada) > 0,
    ).length,
  };
}

export async function listar(filtros) {
  return despachosRepo.listar(filtros);
}

/**
 * Bitacora del despacho, en orden cronologico.
 *
 * `despacho_mega_eventos` se venia escribiendo desde el primer dia y no habia
 * forma de leerla: quien abrio, quien reanudo, cada rechazo y cada aprobacion
 * estaban guardados y eran invisibles. Esto es lo que convierte esos registros
 * en trazabilidad de verdad.
 *
 * Pasa por `asegurarAcceso`: un operario puede revisar su propio historial, no
 * el de otro.
 */
export async function historial(id, usuario) {
  const despacho = await despachosRepo.porId(id);
  if (!despacho) throw noEncontrado("Despacho no encontrado.");
  asegurarAcceso(despacho, usuario);

  return eventosRepo.historialPorDespacho(id);
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
// Resolver un codigo SIN mutar
// ---------------------------------------------------------------------------

/**
 * Traduce un codigo (de barras o de item) a la linea de la factura que le
 * corresponde, SIN tocar nada.
 *
 * POR QUE EXISTE
 * El frontend puede matchear lo que el operario teclea contra el `codigo_item`
 * de las lineas que ya tiene, pero NO contra un codigo de barras: el mapeo
 * barra -> item vive en el catalogo del backend (`resolverCodigo`), y la factura
 * de Siesa solo trae el `codigo_item`. Sin esto, escanear una barra no podia
 * abrir el modal de cantidad — solo sumaba de a uno.
 *
 * Devuelve `item_id` (la primera linea con cupo, en orden de factura, igual que
 * `validar`) para que el front abra el modal en la linea correcta.
 */
export async function resolver(id, codigo, usuario) {
  const despacho = await despachosRepo.porId(id);
  if (!despacho) throw noEncontrado("Despacho no encontrado.");
  asegurarAcceso(despacho, usuario);

  const { codigoItem, factor, unidad, origen } = await resolverCodigo(codigo);
  const items = await despachosRepo.itemsDe(id);
  const coincidencias = items.filter((i) => i.codigo_item === codigoItem);

  if (coincidencias.length === 0) {
    // Misma distincion que `validar`: "codigo ilegible" y "producto equivocado"
    // se resuelven distinto, y al operario le importa cual de los dos es.
    return {
      pertenece: false,
      resultado: origen === "directo" ? "no_encontrado" : "no_pertenece",
      codigo_item: codigoItem,
      mensaje:
        origen === "directo"
          ? `El codigo ${codigo} no corresponde a ningun producto conocido.`
          : `El producto ${codigoItem} no hace parte de la factura ${despacho.numero_factura}.`,
    };
  }

  const objetivo =
    coincidencias.find(
      (i) => Number(i.cantidad_validada) < Number(i.cantidad_solicitada),
    ) || coincidencias[0];

  return {
    pertenece: true,
    resultado: "ok",
    codigo_item: codigoItem,
    item_id: objetivo.id,
    // Informativos: el modal cuenta en unidades base (manda `codigo_item` a
    // `validar`, factor 1), pero saber que se escaneo un P12 ayuda a la UI.
    factor,
    unidad: unidad || objetivo.unidad,
  };
}

// ---------------------------------------------------------------------------
// Ajustar una linea (devolver a pendientes / corregir de mas)
// ---------------------------------------------------------------------------

/**
 * Fija el total ABSOLUTO validado de una linea. `cantidad` no es un incremento:
 * es donde tiene que quedar la linea. 0 la devuelve a pendientes.
 *
 * POR QUE ABSOLUTO Y NO UN DECREMENTO
 * El operario no piensa "resta 3": piensa "esto va en 5" o "esto no lo aliste,
 * mandalo de vuelta". Un total absoluto es idempotente (reintentar no acumula) y
 * evita el clasico bug de restar dos veces por un doble tap.
 *
 * Baja de cantidad tambien es trazable: queda un evento `item_ajustado` con el
 * de/a, porque devolver mercancia es tan auditable como despacharla.
 */
export async function ajustar(id, itemId, cantidadNueva, usuario) {
  const despacho = await despachosRepo.porId(id);
  if (!despacho) throw noEncontrado("Despacho no encontrado.");
  asegurarAcceso(despacho, usuario);

  if (despacho.estado !== "en_proceso") {
    throw conflicto(
      `El despacho esta en estado ${despacho.estado} y ya no admite ajustes.`,
    );
  }

  const items = await despachosRepo.itemsDe(id);
  const objetivo = items.find((i) => i.id === itemId);
  if (!objetivo) throw noEncontrado("La linea no pertenece a este despacho.");

  const solicitada = Number(objetivo.cantidad_solicitada);

  // La misma regla que en `validar`: no se despacha mas de lo facturado. Aca
  // aplica al total, no al incremento.
  if (cantidadNueva > solicitada) {
    throw solicitudInvalida(
      `La linea ${objetivo.codigo_item} pide ${solicitada}; no puede quedar en ${cantidadNueva}.`,
    );
  }

  const anterior = Number(objetivo.cantidad_validada);
  const estadoItem =
    cantidadNueva <= 0
      ? "pendiente"
      : cantidadNueva >= solicitada
        ? "completo"
        : "parcial";

  const actualizado = await despachosRepo.actualizarItem(itemId, {
    cantidad_validada: cantidadNueva,
    estado_item: estadoItem,
    // Devolver a pendientes borra la firma: la linea vuelve a estar "sin tocar".
    validado_por: cantidadNueva > 0 ? usuario.operarioId : null,
    validado_at: cantidadNueva > 0 ? new Date().toISOString() : null,
  });

  const completos = items.filter(
    (i) => (i.id === itemId ? estadoItem : i.estado_item) === "completo",
  ).length;

  const despachoActualizado = await despachosRepo.actualizar(id, {
    items_validados: completos,
  });

  await eventosRepo.registrar({
    despachoId: id,
    actorUserId: usuario.userId,
    actorCorreo: usuario.correo,
    evento: EVENTO.ITEM_AJUSTADO,
    payload: {
      codigoItem: objetivo.codigo_item,
      linea: objetivo.linea,
      de: anterior,
      a: cantidadNueva,
      estadoItem,
    },
  });

  return {
    resultado: "ajustado",
    item: actualizado,
    despacho: despachoActualizado,
    mensaje:
      cantidadNueva <= 0
        ? `${objetivo.codigo_item} devuelto a pendientes.`
        : `${objetivo.codigo_item} quedo en ${cantidadNueva} de ${solicitada}.`,
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
