/**
 * comparativo.test.js — Cruce de lineas picking <-> auditoria.
 *
 * POR QUE ESTE Y NO OTRO
 * `compararLineas` es logica pura sin I/O y es el punto exacto donde un cambio
 * en `abrirAuditoria` rompe el comparativo EN SILENCIO: las cantidades seguirian
 * apareciendo, pero contra el producto equivocado. Un panel que muestra la
 * diferencia de otra linea es peor que uno que no la muestra.
 *
 * El caso que importa de verdad es el de los items repetidos. La factura puede
 * traer el mismo producto en varias lineas (medido: 2 de 11 documentos, ver
 * docs/PENDIENTES.md §1) y la auditoria renumera desde 1 sobre lo alistado, asi
 * que ni el numero de linea ni el codigo alcanzan por separado.
 */
import { describe, it, expect } from "vitest";
import { compararLineas } from "./comparativo.js";

/** Linea de picking con lo minimo que mira el comparativo. */
const lineaPicking = (linea, codigo, solicitada, validada) => ({
  id: `p${linea}`,
  linea,
  codigo_item: codigo,
  descripcion: `Producto ${codigo}`,
  unidad: "UND",
  cantidad_solicitada: solicitada,
  cantidad_validada: validada,
  estado_item:
    validada === 0 ? "faltante" : validada < solicitada ? "parcial" : "completo",
});

/**
 * Auditoria tal como la arma `abrirAuditoria`: solo las lineas alistadas,
 * renumeradas desde 1, con lo alistado convertido en lo exigido.
 */
const auditoriaDe = (itemsPicking, validadasAuditoria) =>
  itemsPicking
    .filter((i) => i.cantidad_validada > 0)
    .map((i, indice) => ({
      id: `a${indice + 1}`,
      linea: indice + 1,
      codigo_item: i.codigo_item,
      descripcion: i.descripcion,
      unidad: i.unidad,
      cantidad_solicitada: i.cantidad_validada,
      cantidad_validada: validadasAuditoria[indice],
      estado_item:
        validadasAuditoria[indice] >= i.cantidad_validada ? "completo" : "parcial",
    }));

describe("compararLineas", () => {
  it("empareja cada linea con su contraparte cuando los productos son distintos", () => {
    const picking = [
      lineaPicking(1, "A", 10, 10),
      lineaPicking(2, "B", 5, 5),
      lineaPicking(3, "C", 8, 8),
    ];
    const auditoria = auditoriaDe(picking, [10, 5, 8]);

    const r = compararLineas(picking, auditoria);

    expect(r).toHaveLength(3);
    expect(r.map((l) => l.codigo_item)).toEqual(["A", "B", "C"]);
    expect(r.map((l) => l.auditado)).toEqual([10, 5, 8]);
    expect(r.every((l) => l.diferencia_auditoria === 0)).toBe(true);
  });

  it("NO le da la contraparte a una linea que no se alisto", () => {
    // El caso que justifica el guardia `alistado > 0`. Sin el, la linea 1
    // (que nunca se alisto) se quedaria con la auditoria de la linea 2, y el
    // panel mostraria la diferencia colgada del renglon equivocado.
    const picking = [
      lineaPicking(1, "A", 10, 0), // faltante: no llega a la auditoria
      lineaPicking(2, "A", 5, 5), // esta si
    ];
    const auditoria = auditoriaDe(picking, [5]);

    expect(auditoria).toHaveLength(1);

    const r = compararLineas(picking, auditoria);

    expect(r[0].auditado).toBeNull();
    expect(r[0].auditoria_item_id).toBeNull();
    expect(r[1].auditado).toBe(5);
    expect(r[1].auditoria_item_id).toBe("a1");
  });

  it("reparte en orden cuando el mismo producto aparece en varias lineas", () => {
    const picking = [
      lineaPicking(1, "A", 10, 10),
      lineaPicking(2, "B", 3, 3),
      lineaPicking(3, "A", 5, 5), // mismo producto que la linea 1
    ];
    // El auditor encontro todo menos 1 unidad de la ultima linea de "A".
    const auditoria = auditoriaDe(picking, [10, 3, 4]);

    const r = compararLineas(picking, auditoria);

    expect(r[0].auditado).toBe(10);
    expect(r[0].diferencia_auditoria).toBe(0);

    expect(r[2].auditado).toBe(4);
    expect(r[2].diferencia_auditoria).toBe(-1);

    // Cada par tiene que ser el mismo producto, no solo la misma cantidad.
    expect(r[0].auditoria_item_id).toBe("a1");
    expect(r[2].auditoria_item_id).toBe("a3");
  });

  it("deja el lado auditado en null cuando todavia no hubo auditoria", () => {
    const picking = [lineaPicking(1, "A", 10, 7)];

    const r = compararLineas(picking, []);

    expect(r[0].auditado).toBeNull();
    expect(r[0].diferencia_auditoria).toBeNull();
    // El faltante del picking sigue midiendose igual.
    expect(r[0].diferencia_picking).toBe(-3);
  });

  it("reporta el faltante del picking con signo", () => {
    const picking = [lineaPicking(1, "A", 10, 4)];
    const auditoria = auditoriaDe(picking, [4]);

    const r = compararLineas(picking, auditoria);

    expect(r[0].facturado).toBe(10);
    expect(r[0].alistado).toBe(4);
    expect(r[0].diferencia_picking).toBe(-6);
    // La auditoria verifica contra lo ALISTADO, no contra lo facturado: si el
    // auditor encontro las 4 que el picker dijo alistar, no hay diferencia.
    expect(r[0].diferencia_auditoria).toBe(0);
  });

  it("trata las cantidades como numeros aunque Supabase las mande como texto", () => {
    // NUMERIC(14,3) llega como string por PostgREST. Sin la conversion, la
    // resta daria NaN y la diferencia se veria vacia en el panel.
    const picking = [
      { ...lineaPicking(1, "A", 10, 6), cantidad_solicitada: "10.000", cantidad_validada: "6.000" },
    ];
    const auditoria = [
      {
        id: "a1",
        linea: 1,
        codigo_item: "A",
        cantidad_solicitada: "6.000",
        cantidad_validada: "5.000",
        estado_item: "parcial",
      },
    ];

    const r = compararLineas(picking, auditoria);

    expect(r[0].facturado).toBe(10);
    expect(r[0].alistado).toBe(6);
    expect(r[0].auditado).toBe(5);
    expect(r[0].diferencia_auditoria).toBe(-1);
  });

  it("no rompe con una factura sin lineas", () => {
    expect(compararLineas([], [])).toEqual([]);
  });
});

/**
 * Auditoria abierta contra Siesa, sin copiar el picking.
 *
 * Existe desde que se permitio auditar sin alistado previo. Rompe el supuesto
 * central del bloque de arriba —"la auditoria solo contiene lo alistado"— y por
 * eso necesita sus propios casos: aplicar aca el guardia `alistado > 0`
 * esconderia justo lo que el auditor conto.
 */
describe("compararLineas con auditoria independiente", () => {
  const independiente = { auditoriaDerivada: false };

  /** Linea de auditoria propia: exige lo FACTURADO, no lo alistado. */
  const lineaAuditoria = (linea, codigo, solicitada, validada) => ({
    id: `a${linea}`,
    linea,
    codigo_item: codigo,
    descripcion: `Producto ${codigo}`,
    unidad: "UND",
    cantidad_solicitada: solicitada,
    cantidad_validada: validada,
    estado_item: validada >= solicitada ? "completo" : "parcial",
  });

  it("muestra lo auditado aunque el picking no haya alistado nada", () => {
    // El caso real de la factura 48263: picking abandonado en 0, el auditor
    // conto 1800. Con el guardia puesto, "auditado" salia vacio.
    const picking = [lineaPicking(1, "40117", 1800, 0)];
    const auditoria = [lineaAuditoria(1, "40117", 1800, 1800)];

    const r = compararLineas(picking, auditoria, independiente);

    expect(r).toHaveLength(1);
    expect(r[0].alistado).toBe(0);
    expect(r[0].auditado).toBe(1800);
    expect(r[0].auditoria_item_id).toBe("a1");
  });

  it("sigue repartiendo en orden con productos repetidos", () => {
    // Que el guardia no aplique NO significa emparejar de cualquier forma: el
    // cruce por codigo y en orden tiene que seguir intacto.
    const picking = [
      lineaPicking(1, "A", 10, 0),
      lineaPicking(2, "B", 3, 3),
      lineaPicking(3, "A", 5, 0),
    ];
    const auditoria = [
      lineaAuditoria(1, "A", 10, 10),
      lineaAuditoria(2, "B", 3, 3),
      lineaAuditoria(3, "A", 5, 4),
    ];

    const r = compararLineas(picking, auditoria, independiente);

    expect(r[0].auditado).toBe(10);
    expect(r[0].auditoria_item_id).toBe("a1");
    expect(r[2].auditado).toBe(4);
    expect(r[2].auditoria_item_id).toBe("a3");
  });

  it("saca a la luz una linea que auditaron y el picking no tiene", () => {
    // Pasa con un picking viejo, creado antes de excluir el item 44736.
    const picking = [lineaPicking(1, "A", 10, 0)];
    const auditoria = [
      lineaAuditoria(1, "A", 10, 10),
      lineaAuditoria(2, "Z", 4, 4),
    ];

    const r = compararLineas(picking, auditoria, independiente);

    expect(r).toHaveLength(2);
    const suelta = r[1];
    expect(suelta.codigo_item).toBe("Z");
    expect(suelta.auditado).toBe(4);
    expect(suelta.solo_auditoria).toBe(true);
    // En null y no en cero: cero afirmaria que el picking pidio ese producto.
    expect(suelta.facturado).toBeNull();
    expect(suelta.alistado).toBeNull();
    expect(suelta.picking_item_id).toBeNull();
  });

  it("arma el comparativo cuando NO hubo picking en absoluto", () => {
    const auditoria = [lineaAuditoria(1, "A", 10, 9)];

    const r = compararLineas([], auditoria, independiente);

    expect(r).toHaveLength(1);
    expect(r[0].auditado).toBe(9);
    expect(r[0].solo_auditoria).toBe(true);
  });
});
