/**
 * agregacion.js — Colapsa las vistas diarias a totales del rango.
 *
 * EL PROBLEMA QUE RESUELVE
 * Todas las vistas de analitica agrupan POR DIA. El panel las mostraba tal cual,
 * asi que "Despachos por usuario" repetia a cada persona una vez por dia y
 * "Productos mas despachados" era en realidad el top de pares producto-dia. Con
 * treinta dias de rango eso no es una tabla larga: es una tabla equivocada.
 *
 * LA REGLA, Y POR QUE IMPORTA
 * Solo se pueden sumar entre dias las columnas ADITIVAS:
 *
 *   COUNT(*) y SUM(...)      -> aditivos. Se suman y ya.
 *   COUNT(DISTINCT x)        -> NO aditivo. La misma factura cuenta en dos dias.
 *   AVG(...)                 -> NO aditivo. Promediar promedios le da el mismo
 *                               peso a un dia de 2 despachos y a uno de 20.
 *
 * Por eso la migracion 007 le agrego `minutos_totales` y `despachos_finalizados`
 * a `vw_por_operario`: con esas dos el promedio se recalcula exacto para
 * cualquier rango, en vez de promediar promedios.
 *
 * MODULO SIN DEPENDENCIAS, a proposito: es logica pura y se prueba sin base de
 * datos. Ver agregacion.test.js y docs/PENDIENTES.md §7.
 */

const num = (v) => Number(v || 0);

/** Suma los campos indicados de `origen` sobre `destino`, en el lugar. */
function acumular(destino, origen, campos) {
  for (const campo of campos) destino[campo] += num(origen[campo]);
}

const CAMPOS_OPERARIO = [
  "despachos",
  "despachos_ok",
  "despachos_con_novedad",
  "items_validados",
  "despachos_finalizados",
  "minutos_totales",
];

/**
 * Una fila por operario y modo, no por operario, modo y dia.
 *
 * Se conserva la apertura por modo porque picking y auditoria son trabajos
 * distintos: colapsarlos escondería que alguien audita mucho y alista poco.
 */
export function agruparPorOperario(filas = []) {
  const mapa = new Map();

  for (const f of filas) {
    const clave = `${f.operario_id}|${f.modo}`;
    let acumulado = mapa.get(clave);

    if (!acumulado) {
      acumulado = {
        operario_id: f.operario_id,
        nombre: f.nombre,
        correo: f.correo,
        sede: f.sede,
        modo: f.modo,
        ...Object.fromEntries(CAMPOS_OPERARIO.map((c) => [c, 0])),
      };
      mapa.set(clave, acumulado);
    }

    acumular(acumulado, f, CAMPOS_OPERARIO);
  }

  return [...mapa.values()]
    .map((o) => ({
      ...o,
      // El promedio se RECALCULA sobre los totales. `minutos_promedio` de la
      // vista es por dia y no sirve para el rango.
      minutos_promedio: o.despachos_finalizados
        ? o.minutos_totales / o.despachos_finalizados
        : null,
    }))
    .sort((a, b) => b.despachos - a.despachos);
}

const CAMPOS_PRODUCTO = [
  "apariciones_en_despachos",
  "cantidad_solicitada",
  "cantidad_despachada",
  "cantidad_faltante",
];

/**
 * Top de productos del rango, de verdad.
 *
 * `apariciones_en_despachos` es un COUNT(DISTINCT despacho_id) y aun asi se
 * puede sumar: la vista agrupa por dia usando la fecha del despacho, asi que un
 * despacho cae en un unico dia y no puede contarse dos veces.
 */
export function agruparProductos(filas = [], limite = 20) {
  const mapa = new Map();

  for (const f of filas) {
    let acumulado = mapa.get(f.codigo_item);

    if (!acumulado) {
      acumulado = {
        codigo_item: f.codigo_item,
        descripcion: f.descripcion,
        ...Object.fromEntries(CAMPOS_PRODUCTO.map((c) => [c, 0])),
      };
      mapa.set(f.codigo_item, acumulado);
    }

    acumular(acumulado, f, CAMPOS_PRODUCTO);
    // La descripcion puede faltar en algunos dias; se conserva la primera que
    // aparezca en vez de dejar la del ultimo dia, que podria ser null.
    if (!acumulado.descripcion && f.descripcion) acumulado.descripcion = f.descripcion;
  }

  return [...mapa.values()]
    .sort((a, b) => b.cantidad_despachada - a.cantidad_despachada)
    .slice(0, limite);
}

const CAMPOS_ITEM = [
  "reportes",
  "reportes_abiertos",
  "sin_fisico",
  "averiado",
  "ubicacion_errada",
  "diferencia_cantidad",
  "otro",
  "detectadas_en_auditoria",
  "unidades_faltantes",
];

/** Novedades por item: de casos sueltos a "este producto es un problema". */
export function agruparNovedadesPorItem(filas = [], limite = 20) {
  const mapa = new Map();

  for (const f of filas) {
    let acumulado = mapa.get(f.codigo_item);

    if (!acumulado) {
      acumulado = {
        codigo_item: f.codigo_item,
        descripcion: f.descripcion,
        ...Object.fromEntries(CAMPOS_ITEM.map((c) => [c, 0])),
      };
      mapa.set(f.codigo_item, acumulado);
    }

    acumular(acumulado, f, CAMPOS_ITEM);
    if (!acumulado.descripcion && f.descripcion) acumulado.descripcion = f.descripcion;
  }

  return [...mapa.values()]
    .sort((a, b) => b.reportes - a.reportes)
    .slice(0, limite);
}

const CAMPOS_CALIDAD = [
  "escaneos",
  "aceptados",
  "rechazados",
  "no_encontrado",
  "no_pertenece",
  "excede_cantidad",
  "item_completo",
  "manuales",
];

/**
 * Calidad de escaneo por operario, con la tasa de acierto recalculada.
 *
 * La tasa sale de los totales del rango, no del promedio de las tasas diarias:
 * un dia con 3 escaneos no puede pesar lo mismo que uno con 300.
 */
export function agruparCalidad(filas = []) {
  const mapa = new Map();

  for (const f of filas) {
    let acumulado = mapa.get(f.operario_id);

    if (!acumulado) {
      acumulado = {
        operario_id: f.operario_id,
        nombre: f.nombre,
        correo: f.correo,
        ...Object.fromEntries(CAMPOS_CALIDAD.map((c) => [c, 0])),
      };
      mapa.set(f.operario_id, acumulado);
    }

    acumular(acumulado, f, CAMPOS_CALIDAD);
  }

  return [...mapa.values()]
    .map((o) => ({
      ...o,
      tasa_acierto: o.escaneos ? (o.aceptados / o.escaneos) * 100 : null,
    }))
    .sort((a, b) => b.escaneos - a.escaneos);
}

/**
 * Totales de cabecera.
 *
 * OJO CON LO QUE NO ESTA ACA: `facturas`. El resumen diario trae
 * `total_facturas` como COUNT(DISTINCT numero_factura) POR grupo dia+modo+estado,
 * y sumarlo contaba la misma factura una vez por picking, otra por auditoria y
 * otra vez si cambiaba de estado. El total real sale de
 * `despacho_mega_vw_facturas`, que ya tiene una fila por factura.
 *
 * `operarios_activos` tampoco: es otro COUNT(DISTINCT) por dia.
 */
export function totalizar(resumen = []) {
  return resumen.reduce(
    (acumulado, fila) => ({
      despachos: acumulado.despachos + num(fila.total_despachos),
      items_solicitados: acumulado.items_solicitados + num(fila.items_solicitados),
      items_validados: acumulado.items_validados + num(fila.items_validados),
    }),
    { despachos: 0, items_solicitados: 0, items_validados: 0 },
  );
}

/** Serie diaria para la grafica de volumen, con picking y auditoria separados. */
export function serieDiaria(resumen = []) {
  const mapa = new Map();

  for (const f of resumen) {
    let dia = mapa.get(f.dia);
    if (!dia) {
      dia = { dia: f.dia, picking: 0, auditoria: 0, items_validados: 0 };
      mapa.set(f.dia, dia);
    }

    dia[f.modo] += num(f.total_despachos);
    dia.items_validados += num(f.items_validados);
  }

  return [...mapa.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

/**
 * Mapa de calor dia de semana x hora.
 *
 * La vista ya devuelve la grilla completa; el panel la aplastaba sumando todo
 * en una tabla de horas y tiraba a la basura la dimension mas util. Saber que
 * los martes a las 10 se satura sirve para programar gente; saber que "a las 10
 * hay mucho trabajo" no dice que dia.
 */
export function mapaDeCalor(picos = []) {
  const celdas = new Map();

  for (const p of picos) {
    const clave = `${p.dia_semana}|${p.hora}`;
    const celda = celdas.get(clave) || {
      dia_semana: Number(p.dia_semana),
      hora: Number(p.hora),
      escaneos: 0,
      escaneos_ok: 0,
    };

    celda.escaneos += num(p.escaneos);
    celda.escaneos_ok += num(p.escaneos_ok);
    celdas.set(clave, celda);
  }

  return [...celdas.values()];
}
