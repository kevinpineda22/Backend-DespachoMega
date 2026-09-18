/**
 * despacho.service.js — Reglas de negocio de la auditoria.
 *
 * Todo lo que decide si un escaneo (o un pase sin escanear) vale o no vale
 * esta aca. Los controladores solo traducen HTTP; los repositorios solo hablan
 * con Supabase.
 */
import * as despachosRepo from "../repositories/despachos.repository.js";
import * as alertasRepo from "../repositories/alertas.repository.js";
import * as eventosRepo from "../repositories/eventos.repository.js";
import { EVENTO } from "../repositories/eventos.repository.js";
import { resolverCodigo } from "../repositories/catalogo.repository.js";
import { consultarFactura } from "./facturaSiesa.service.js";
import { existenciasDeItems } from "./inventarioSiesa.service.js";
import * as despachadorService from "./despachador.service.js";
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
 * Abre la auditoria de una factura, o reanuda la que ya estaba en curso.
 *
 * Por que reanudar en vez de crear otra: el operario puede quedarse sin bateria
 * o cerrar el navegador a mitad de camino. Si al volver a teclear la factura se
 * creara un despacho nuevo, el avance se perderia y quedarian dos registros
 * compitiendo por la misma factura.
 *
 * LA REFERENCIA ES LO FACTURADO EN SIESA. No hay un alistamiento previo contra
 * el que comparar: la auditoria verifica la factura tal como salio del punto de
 * venta.
 * Por eso `cantidad_solicitada` de cada linea es lo facturado, y `snapshot_siesa`
 * guarda la foto de la factura al momento de abrirla.
 *
 * EL DESPACHADOR SE EXIGE SOLO AL CREAR. Al reanudar ya esta guardado y no se
 * vuelve a pedir ni a validar: si lo desactivaron entre medio, la auditoria en
 * curso sigue siendo suya.
 *
 * @param {{ numeroFactura: string, despachadorId?: string, usuario: object,
 *           tipoDocumento?: string }} args
 */
export async function abrir({ numeroFactura, despachadorId, usuario, tipoDocumento }) {
  // LA CAJA NO SE EXIGE.
  //
  // `tipoDocumento` es un DESEMPATE opcional, no un requisito: la caja
  // (`ID_TIPO_DOCTO`) ya viene en la consulta a Siesa, asi que el consecutivo
  // alcanza para resolver el documento. Exigirla obligaba al operario a tipear un
  // dato que el sistema ya tiene, cincuenta veces por jornada y con guantes.
  //
  // Cuando el mismo consecutivo SI vive en dos cajas, `consultarFactura` no elige
  // ninguna: responde 409 con la lista en `datos.cajas` y el operario desempata.
  // Ese es el unico momento en que la caja se pregunta — y es una excepcion
  // medida (0 colisiones en 468 documentos), no el flujo normal.
  const vigente = await despachosRepo.despachoVigente(numeroFactura);

  if (vigente) {
    if (ESTADOS_CERRADOS.includes(vigente.estado)) {
      throw conflicto(
        `La factura ${numeroFactura} ya fue auditada (estado: ${vigente.estado}).`,
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
      payload: { numero_factura: numeroFactura },
    });

    const items = await despachosRepo.itemsDe(vigente.id);

    return { despacho: vigente, items, reanudado: true };
  }

  // Se valida ANTES de ir a Siesa: un 400 por despachador no tiene por que
  // costar una descarga de la ventana de facturas.
  if (!despachadorId) {
    throw solicitudInvalida("Debe indicar el despachador para abrir la auditoria.");
  }
  const despachador = await despachadorService.exigirActivo(despachadorId);

  const { encabezado, items, filasCrudas } = await consultarFactura(numeroFactura, {
    tipoDocumento,
  });

  // `modo` no se envia: la columna tiene DEFAULT 'auditoria' y es el unico
  // valor del enum.
  const despacho = await despachosRepo.crearConItems(
    {
      numero_factura: encabezado.numero_factura,
      tipo_documento: encabezado.tipo_documento,
      fecha_factura: encabezado.fecha_factura,
      estado: "en_proceso",
      operario_id: usuario.operarioId,
      despachador_id: despachador.id,
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
    payload: {
      numero_factura: numeroFactura,
      total_items: items.length,
      despachador_id: despachador.id,
      despachador: despachador.nombre,
    },
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

/**
 * Existencias en vivo de los items de un despacho, en SU bodega.
 *
 * LA BODEGA NO VIAJA DESDE EL CLIENTE, y tampoco los codigos: los dos salen del
 * despacho. Si el cliente pudiera mandarlos, este endpoint seria un consultor
 * de inventario de toda la compañia con la sesion de cualquier operario, y no
 * es lo que hace falta: hace falta saber si lo de ESTA factura esta en bodega.
 *
 * Falla suave a proposito. Si Siesa no responde, devuelve `{}` y el panel
 * muestra las tarjetas sin existencias en vez de romperse: la auditoria se
 * puede hacer sin este dato, que es una ayuda y no un requisito.
 */
export async function inventarioDe(id, usuario) {
  const despacho = await despachosRepo.porId(id);
  if (!despacho) throw noEncontrado("Despacho no encontrado.");
  asegurarAcceso(despacho, usuario);

  if (!despacho.bodega) return {};

  const items = await despachosRepo.itemsDe(id);
  return existenciasDeItems({
    items: items.map((i) => i.codigo_item),
    bodega: despacho.bodega,
  });
}

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

  // `escaneos` trae `resultado` y `motivo`: el detalle distingue lo escaneado
  // de lo pasado sin escanear sin una consulta aparte.
  return { despacho, items, escaneos, alertas, aprobaciones };
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
 * LINEA FIJADA (`item_id`, opcional). El modo cine muestra UNA linea y solo
 * acepta escaneos para ella. Si la misma referencia esta en dos lineas de la
 * factura, la regla "primera con cupo" podia sumar a la que NO estaba en
 * pantalla. Con `item_id` la linea destino es esa y ninguna otra; el codigo
 * escaneado tiene que resolver a su `codigo_item`, y si no lo hace se rechaza
 * como `no_pertenece` (producto conocido, pero no es el de la linea). Sin
 * `item_id` nada cambia.
 *
 * @returns {{ resultado: string, mensaje: string, item?: object, despacho?: object }}
 */
export async function validar(id, { codigo, metodo, cantidad, item_id: itemId }, usuario) {
  const despacho = await despachosRepo.porId(id);
  if (!despacho) throw noEncontrado("Despacho no encontrado.");
  asegurarAcceso(despacho, usuario);

  if (despacho.estado !== "en_proceso") {
    throw conflicto(
      `El despacho esta en estado ${despacho.estado} y ya no admite escaneos.`,
    );
  }

  // Se verifica ANTES de resolver el codigo: un `item_id` ajeno es un error
  // del cliente (404), no un escaneo que haya que registrar.
  const items = await despachosRepo.itemsDe(id);
  const lineaFijada = itemId ? items.find((i) => i.id === itemId) : null;
  if (itemId && !lineaFijada) {
    throw noEncontrado("La linea no pertenece a este despacho.");
  }

  // CONTEO MIXTO. `factor` dice cuantas unidades base vale UN escaneo de este
  // codigo: escanear el paquete P12 suma 12, escanear la botella suma 1. La
  // factura pide unidades base (verificado contra Siesa: `CANTIDAD` viene en
  // unidad base aunque `UNIDAD_MEDIDA` diga P12), asi que todo el conteo se
  // hace en esa moneda y `cantidad` solo dice cuantos escaneos representa.
  const { codigoItem, factor, unidad, origen } = await resolverCodigo(codigo);
  const unidadesBase = cantidad * factor;

  // Con linea fijada, las "coincidencias" son esa linea o ninguna: asi el resto
  // del flujo (completa, excede, aceptado) queda identico y sin ramas nuevas.
  const coincidencias = lineaFijada
    ? [lineaFijada].filter((i) => i.codigo_item === codigoItem)
    : items.filter((i) => i.codigo_item === codigoItem);

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
    // Linea fijada y el codigo resolvio a OTRA referencia: el producto puede
    // estar en la factura, pero no es el que esta en pantalla. Se registra
    // contra la linea fijada para que la bitacora diga sobre que se escaneo.
    if (lineaFijada && origen !== "directo") {
      return rechazar(
        "no_pertenece",
        `El codigo corresponde a ${codigoItem}, no a la linea en pantalla ` +
          `(${lineaFijada.codigo_item}).`,
        lineaFijada,
      );
    }

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
// Pasar un item sin escanear
// ---------------------------------------------------------------------------

/**
 * Registra que un item se despacho SIN leer su codigo de barras: etiqueta
 * danada, producto sin codigo, lector que no responde. Es una accion guiada por
 * `item_id` (el operario ya esta parado sobre la linea), no por codigo.
 *
 * MISMAS REGLAS QUE `validar()`, por diseño: guard `en_proceso`, acceso,
 * tope contra lo facturado con rechazo entero del exceso, `actualizarItem` y
 * recalculo de `items_validados`. `validar()` no se toca.
 *
 * LO QUE CAMBIA ES LA EVIDENCIA. El registro en `despacho_mega_escaneos` lleva
 * `resultado = 'pasado_sin_escanear'` y `metodo = 'pase'`, asi las vistas lo
 * distinguen de un escaneo real y NO lo cuentan como rechazo ni como intento.
 * `codigo_ingresado` es NOT NULL y no hubo codigo: se guarda el `codigo_item`
 * de la linea, que es lo que el operario tenia en pantalla.
 *
 * @param {string} id Despacho.
 * @param {{ item_id: string, cantidad: number, motivo?: string }} datos
 *   `cantidad` en unidades base, entera y positiva (lo garantiza el esquema).
 * @returns {{ resultado: string, mensaje: string, item: object, despacho?: object, motivo?: string|null }}
 */
export async function pasarSinEscanear(id, { item_id: itemId, cantidad, motivo }, usuario) {
  const despacho = await despachosRepo.porId(id);
  if (!despacho) throw noEncontrado("Despacho no encontrado.");
  asegurarAcceso(despacho, usuario);

  if (despacho.estado !== "en_proceso") {
    throw conflicto(
      `El despacho esta en estado ${despacho.estado} y ya no admite pases.`,
    );
  }

  const items = await despachosRepo.itemsDe(id);
  const objetivo = items.find((i) => i.id === itemId);
  if (!objetivo) throw noEncontrado("La linea no pertenece a este despacho.");

  const codigoItem = objetivo.codigo_item;
  const validadaActual = Number(objetivo.cantidad_validada);
  const solicitada = Number(objetivo.cantidad_solicitada);
  const restante = solicitada - validadaActual;

  // REGLA DE NEGOCIO CONFIRMADA: no se despacha mas de lo facturado. El exceso
  // se rechaza entero, igual que en `validar()`. Una linea ya completa cae aca
  // (restante = 0) con cualquier cantidad.
  if (cantidad > restante) {
    await despachosRepo.registrarEscaneo({
      despacho_id: id,
      item_id: objetivo.id,
      operario_id: usuario.operarioId,
      codigo_ingresado: codigoItem,
      codigo_item_resuelto: codigoItem,
      metodo: "pase",
      resultado: "excede_cantidad",
      cantidad,
      // El motivo solo se guarda cuando el pase entra: un rechazo no es un pase.
      motivo: null,
    });

    await eventosRepo.registrar({
      despachoId: id,
      actorUserId: usuario.userId,
      actorCorreo: usuario.correo,
      evento: EVENTO.ESCANEO_RECHAZADO,
      payload: { codigoItem, resultado: "excede_cantidad", metodo: "pase", cantidad },
    });

    return {
      resultado: "excede_cantidad",
      mensaje:
        restante > 0
          ? `Solo faltan ${restante} unidades de ${codigoItem}; se intento pasar ${cantidad}.`
          : `El producto ${codigoItem} ya esta completo en esta factura.`,
      item: objetivo,
    };
  }

  const nuevaCantidad = validadaActual + cantidad;
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

  const motivoLimpio = motivo ?? null;

  await despachosRepo.registrarEscaneo({
    despacho_id: id,
    item_id: objetivo.id,
    operario_id: usuario.operarioId,
    codigo_ingresado: codigoItem,
    codigo_item_resuelto: codigoItem,
    metodo: "pase",
    resultado: "pasado_sin_escanear",
    cantidad,
    motivo: motivoLimpio,
  });

  await eventosRepo.registrar({
    despachoId: id,
    actorUserId: usuario.userId,
    actorCorreo: usuario.correo,
    evento: EVENTO.ITEM_PASE_REGISTRADO,
    payload: {
      codigoItem,
      cantidad,
      motivo: motivoLimpio,
      estadoItem,
      linea: objetivo.linea,
    },
  });

  return {
    resultado: "pasado_sin_escanear",
    mensaje:
      estadoItem === "completo"
        ? `Producto ${codigoItem} completo (pasado sin escanear).`
        : `Van ${nuevaCantidad} de ${solicitada} de ${codigoItem} (pasado sin escanear).`,
    item: actualizado,
    despacho: despachoActualizado,
    motivo: motivoLimpio,
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
