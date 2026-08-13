/**
 * comparativo.js — Cruce de las lineas del picking con las de la auditoria.
 *
 * MODULO SIN NINGUNA DEPENDENCIA, A PROPOSITO
 * Es la regla mas delicada del panel y la unica que se puede probar de verdad
 * sin base de datos. Mientras vivio dentro de `factura.service.js` no habia
 * forma de testearla: importarla arrastraba los repositorios y con ellos el
 * cliente de Supabase, que exige credenciales al cargar. Una funcion pura no
 * deberia necesitar una service_role key para probarse.
 *
 * Ver docs/PENDIENTES.md §7: los candidatos a test son justamente los de logica
 * pura sin I/O.
 */

/**
 * @param {Array} itemsPicking   Lineas del picking, en orden de factura.
 * @param {Array} itemsAuditoria Lineas de la auditoria, en su propio orden.
 * @param {{ auditoriaDerivada?: boolean }} opciones
 *   `auditoriaDerivada` (por defecto true) = la auditoria se creo COPIANDO lo
 *   alistado del picking. Cuando es false la auditoria se abrio por su cuenta
 *   contra Siesa, y las dos listas son independientes.
 * @returns {Array} Una fila por linea del picking, con las tres cantidades, mas
 *   las lineas auditadas que no encontraron pareja.
 */
export function compararLineas(
  itemsPicking,
  itemsAuditoria,
  { auditoriaDerivada = true } = {},
) {
  // NO SE PUEDE CRUZAR POR NUMERO DE LINEA. `abrirAuditoria` renumera desde 1
  // sobre las lineas efectivamente alistadas, asi que la linea 3 de una
  // auditoria puede ser la 7 de la factura. Y tampoco alcanza con el codigo del
  // item: una factura puede repetir el mismo producto en varias lineas (medido:
  // 2 de 11 documentos, ver docs/PENDIENTES.md §1).
  //
  // El cruce correcto es por codigo Y en orden, consumiendo de a una: la
  // auditoria conserva el orden del picking.
  const porCodigo = new Map();

  for (const item of itemsAuditoria) {
    const cola = porCodigo.get(item.codigo_item) || [];
    cola.push(item);
    porCodigo.set(item.codigo_item, cola);
  }

  const filas = itemsPicking.map((p) => {
    // Las cantidades son NUMERIC en Postgres y PostgREST las manda como texto.
    // Sin convertir, la resta daria NaN y la diferencia se veria vacia.
    const facturado = Number(p.cantidad_solicitada);
    const alistado = Number(p.cantidad_validada);

    // EL GUARDIA `alistado > 0` SOLO VALE SI LA AUDITORIA SALIO DEL PICKING.
    //
    // Cuando `abrirAuditoria` copia lo alistado, una linea en cero NO tiene
    // contraparte por construccion: emparejarla le robaria la de la siguiente
    // del mismo producto y el panel colgaria la diferencia del renglon
    // equivocado. Ese es el caso que cubre el test de items repetidos.
    //
    // Pero una auditoria abierta contra Siesa no copia nada: trae la factura
    // entera, incluidas las lineas que el picker nunca toco. Ahi el guardia
    // esconde justo lo que el auditor conto —medido en la factura 48263: el
    // picking quedo en 0 y el comparativo mostraba "auditado" vacio aunque el
    // auditor habia registrado 1800 unidades.
    const cola = porCodigo.get(p.codigo_item);
    const puedeEmparejar = auditoriaDerivada ? alistado > 0 : true;
    const a = puedeEmparejar && cola?.length ? cola.shift() : null;
    const auditado = a ? Number(a.cantidad_validada) : null;

    return {
      linea: p.linea,
      codigo_item: p.codigo_item,
      descripcion: p.descripcion,
      unidad: p.unidad,

      facturado,
      alistado,
      auditado,

      // Negativo = falto. Se guarda con signo para que el frontend no tenga que
      // saber en que direccion restar para pintarlo en rojo.
      diferencia_picking: alistado - facturado,
      diferencia_auditoria: auditado === null ? null : auditado - alistado,

      estado_picking: p.estado_item,
      estado_auditoria: a ? a.estado_item : null,

      picking_item_id: p.id,
      auditoria_item_id: a ? a.id : null,
    };
  });

  // LO QUE EL AUDITOR CONTO Y EL PICKING NO TIENE.
  // Pasa cuando la auditoria se abrio por su cuenta y trae lineas que el
  // picking no incluye —por ejemplo un picking viejo, creado antes de excluir
  // el item 44736, o abierto sobre otra version de la factura.
  //
  // Sin esto esas lineas desaparecen del panel: el auditor las conto y nadie
  // las ve. `facturado` y `alistado` van en null y no en cero, porque cero
  // afirmaria que el picking pidio ese producto y no alisto nada, y lo que
  // pasa es que ese renglon no existe del lado del picking.
  const sueltas = [];
  for (const cola of porCodigo.values()) {
    for (const a of cola) {
      const auditado = Number(a.cantidad_validada);
      sueltas.push({
        linea: a.linea,
        codigo_item: a.codigo_item,
        descripcion: a.descripcion,
        unidad: a.unidad,

        facturado: null,
        alistado: null,
        auditado,

        diferencia_picking: null,
        diferencia_auditoria: null,

        estado_picking: null,
        estado_auditoria: a.estado_item,

        picking_item_id: null,
        auditoria_item_id: a.id,
        solo_auditoria: true,
      });
    }
  }

  return [...filas, ...sueltas];
}
