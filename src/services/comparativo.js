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
 * @returns {Array} Una fila por linea del picking, con las tres cantidades.
 */
export function compararLineas(itemsPicking, itemsAuditoria) {
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

  return itemsPicking.map((p) => {
    // Las cantidades son NUMERIC en Postgres y PostgREST las manda como texto.
    // Sin convertir, la resta daria NaN y la diferencia se veria vacia.
    const facturado = Number(p.cantidad_solicitada);
    const alistado = Number(p.cantidad_validada);

    // Solo se empareja lo que se alisto, que es exactamente lo que
    // `abrirAuditoria` copia. Si se emparejaran tambien las lineas en cero, una
    // linea vacia se robaria la contraparte de la siguiente del mismo producto
    // y el panel colgaria la diferencia del renglon equivocado.
    const cola = porCodigo.get(p.codigo_item);
    const a = alistado > 0 && cola?.length ? cola.shift() : null;
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
}
