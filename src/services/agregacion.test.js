/**
 * agregacion.test.js — El colapso de dia -> rango.
 *
 * Cada caso de aca corresponde a un numero que el panel mostraba mal. No son
 * pruebas de "que no explote": son la prueba de que los indicadores dicen lo
 * que dicen que dicen.
 *
 * Desde la migracion 012 el modulo es solo auditoria: las vistas ya no traen
 * `modo`, y aparece `pasados_sin_escanear` como desglose separado de los
 * escaneos reales. Estos casos fijan ese contrato.
 */
import { describe, it, expect } from "vitest";
import {
  agruparPorOperario,
  agruparProductos,
  agruparNovedadesPorItem,
  agruparCalidad,
  totalizar,
  serieDiaria,
  mapaDeCalor,
  facturasPorDiaSemana,
} from "./agregacion.js";

describe("agruparPorOperario", () => {
  it("colapsa los dias en una fila por operario", () => {
    const filas = [
      { operario_id: "u1", nombre: "Ana", dia: "2026-08-01", despachos: 3, despachos_ok: 3, despachos_con_novedad: 0, items_validados: 30, despachos_finalizados: 3, minutos_totales: 90 },
      { operario_id: "u1", nombre: "Ana", dia: "2026-08-02", despachos: 2, despachos_ok: 1, despachos_con_novedad: 1, items_validados: 20, despachos_finalizados: 2, minutos_totales: 30 },
    ];

    const r = agruparPorOperario(filas);

    expect(r).toHaveLength(1);
    expect(r[0].despachos).toBe(5);
    expect(r[0].despachos_con_novedad).toBe(1);
    expect(r[0].items_validados).toBe(50);
  });

  it("NO promedia promedios: pondera por despachos finalizados", () => {
    // Dia 1: 4 despachos, 40 min en total  -> 10 min de promedio
    // Dia 2: 1 despacho,  60 min en total  -> 60 min de promedio
    //
    // Promediar los promedios daria (10 + 60) / 2 = 35 min, que le da el mismo
    // peso a un dia de 4 despachos y a uno de 1. El promedio real del rango es
    // 100 min / 5 despachos = 20 min.
    const filas = [
      { operario_id: "u1", nombre: "Ana", despachos: 4, despachos_finalizados: 4, minutos_totales: 40, minutos_promedio: 10 },
      { operario_id: "u1", nombre: "Ana", despachos: 1, despachos_finalizados: 1, minutos_totales: 60, minutos_promedio: 60 },
    ];

    const r = agruparPorOperario(filas);

    expect(r[0].minutos_promedio).toBe(20);
    expect(r[0].minutos_promedio).not.toBe(35);
  });

  it("colapsa a una sola fila por operario, sin campo modo", () => {
    // Filas viejas que todavia traigan `modo` (por ejemplo, un cliente cacheado)
    // no pueden partir a la persona en dos: la clave es solo el operario.
    const filas = [
      { operario_id: "u1", nombre: "Ana", modo: "auditoria", despachos: 3, despachos_finalizados: 0, minutos_totales: 0 },
      { operario_id: "u1", nombre: "Ana", modo: "otro", despachos: 1, despachos_finalizados: 0, minutos_totales: 0 },
      { operario_id: "u2", nombre: "Beto", despachos: 1, despachos_finalizados: 0, minutos_totales: 0 },
    ];

    const r = agruparPorOperario(filas);

    expect(r).toHaveLength(2);
    expect(r[0]).not.toHaveProperty("modo");
    expect(r.find((o) => o.operario_id === "u1").despachos).toBe(4);
  });

  it("deja el promedio en null cuando nadie finalizo nada", () => {
    const filas = [
      { operario_id: "u1", nombre: "Ana", despachos: 2, despachos_finalizados: 0, minutos_totales: 0 },
    ];

    expect(agruparPorOperario(filas)[0].minutos_promedio).toBeNull();
  });
});

describe("agruparProductos", () => {
  it("suma el mismo producto a lo largo de los dias y ordena por despachado", () => {
    const filas = [
      { codigo_item: "A", descripcion: "Prod A", dia: "2026-08-01", apariciones_en_despachos: 2, cantidad_solicitada: 20, cantidad_despachada: 18, cantidad_faltante: 2 },
      { codigo_item: "A", descripcion: "Prod A", dia: "2026-08-02", apariciones_en_despachos: 1, cantidad_solicitada: 10, cantidad_despachada: 10, cantidad_faltante: 0 },
      { codigo_item: "B", descripcion: "Prod B", dia: "2026-08-01", apariciones_en_despachos: 5, cantidad_solicitada: 60, cantidad_despachada: 60, cantidad_faltante: 0 },
    ];

    const r = agruparProductos(filas);

    expect(r).toHaveLength(2);
    // B despachó más, va primero.
    expect(r[0].codigo_item).toBe("B");
    expect(r[1].codigo_item).toBe("A");
    expect(r[1].cantidad_despachada).toBe(28);
    expect(r[1].apariciones_en_despachos).toBe(3);
  });

  it("recorta DESPUES de agrupar, no antes", () => {
    // Este era el bug: el limite se aplicaba a las filas producto-dia, así que
    // un producto con muchos días partidos podía quedar afuera del top aunque
    // fuera el más despachado del rango.
    const filas = [
      ...Array.from({ length: 5 }, (_, i) => ({
        codigo_item: "REPARTIDO", dia: `2026-08-0${i + 1}`,
        cantidad_despachada: 100, apariciones_en_despachos: 1,
        cantidad_solicitada: 100, cantidad_faltante: 0,
      })),
      { codigo_item: "UNICO", dia: "2026-08-01", cantidad_despachada: 200, apariciones_en_despachos: 1, cantidad_solicitada: 200, cantidad_faltante: 0 },
    ];

    const r = agruparProductos(filas, 1);

    expect(r).toHaveLength(1);
    // 5 x 100 = 500 le gana a 200. Con el recorte previo, "UNICO" ganaba.
    expect(r[0].codigo_item).toBe("REPARTIDO");
    expect(r[0].cantidad_despachada).toBe(500);
  });

  it("conserva la descripción aunque falte en algún día", () => {
    const filas = [
      { codigo_item: "A", descripcion: null, dia: "2026-08-01", cantidad_despachada: 5, apariciones_en_despachos: 1, cantidad_solicitada: 5, cantidad_faltante: 0 },
      { codigo_item: "A", descripcion: "Prod A", dia: "2026-08-02", cantidad_despachada: 5, apariciones_en_despachos: 1, cantidad_solicitada: 5, cantidad_faltante: 0 },
    ];

    expect(agruparProductos(filas)[0].descripcion).toBe("Prod A");
  });
});

describe("agruparNovedadesPorItem", () => {
  it("convierte casos sueltos en un conteo por producto", () => {
    const filas = [
      { codigo_item: "A", descripcion: "Prod A", dia: "2026-08-01", reportes: 3, reportes_abiertos: 1, sin_fisico: 3, averiado: 0, ubicacion_errada: 0, diferencia_cantidad: 0, otro: 0, unidades_faltantes: 12 },
      { codigo_item: "A", descripcion: "Prod A", dia: "2026-08-03", reportes: 5, reportes_abiertos: 2, sin_fisico: 4, averiado: 1, ubicacion_errada: 0, diferencia_cantidad: 0, otro: 0, unidades_faltantes: 20 },
    ];

    const r = agruparNovedadesPorItem(filas);

    expect(r[0].reportes).toBe(8);
    expect(r[0].unidades_faltantes).toBe(32);
    expect(r[0].averiado).toBe(1);
  });

  it("no expone detectadas_en_auditoria: toda novedad es de auditoria", () => {
    const filas = [
      { codigo_item: "A", descripcion: "Prod A", dia: "2026-08-01", reportes: 3, reportes_abiertos: 1, sin_fisico: 3, averiado: 0, ubicacion_errada: 0, diferencia_cantidad: 0, otro: 0, unidades_faltantes: 12 },
    ];

    expect(agruparNovedadesPorItem(filas)[0]).not.toHaveProperty("detectadas_en_auditoria");
  });
});

describe("agruparCalidad", () => {
  it("recalcula la tasa sobre los totales, no promediando tasas diarias", () => {
    // Dia 1: 1 escaneo, 0 aceptados   -> 0%
    // Dia 2: 99 escaneos, 99 aceptados -> 100%
    //
    // Promediar las tasas daria 50%. La tasa real es 99/100 = 99%.
    const filas = [
      { operario_id: "u1", nombre: "Ana", escaneos: 1, aceptados: 0, rechazados: 1, no_encontrado: 1, no_pertenece: 0, excede_cantidad: 0, item_completo: 0, manuales: 0, pasados_sin_escanear: 0 },
      { operario_id: "u1", nombre: "Ana", escaneos: 99, aceptados: 99, rechazados: 0, no_encontrado: 0, no_pertenece: 0, excede_cantidad: 0, item_completo: 0, manuales: 0, pasados_sin_escanear: 0 },
    ];

    const r = agruparCalidad(filas);

    expect(r[0].escaneos).toBe(100);
    expect(r[0].tasa_acierto).toBe(99);
    expect(r[0].tasa_acierto).not.toBe(50);
  });

  it("suma pasados_sin_escanear sin mezclarlos con rechazados y la tasa usa solo intentos", () => {
    // La vista ya excluye el pase de `escaneos` y de `rechazados`. Aca solo se
    // suma el rango: 3 pases en dos dias no pueden tocar la tasa de acierto.
    const filas = [
      { operario_id: "u1", nombre: "Ana", escaneos: 10, aceptados: 8, rechazados: 2, no_encontrado: 2, no_pertenece: 0, excede_cantidad: 0, item_completo: 0, manuales: 0, pasados_sin_escanear: 1 },
      { operario_id: "u1", nombre: "Ana", escaneos: 10, aceptados: 8, rechazados: 2, no_encontrado: 0, no_pertenece: 2, excede_cantidad: 0, item_completo: 0, manuales: 0, pasados_sin_escanear: 2 },
    ];

    const r = agruparCalidad(filas);

    expect(r[0].pasados_sin_escanear).toBe(3);
    expect(r[0].rechazados).toBe(4);
    expect(r[0].escaneos).toBe(20);
    expect(r[0].tasa_acierto).toBe(80);
  });

  it("deja la tasa en null si no hubo escaneos", () => {
    expect(agruparCalidad([])).toEqual([]);
  });
});

describe("totalizar", () => {
  it("suma lo aditivo y NO inventa un total de facturas", () => {
    // La misma factura aparece en dos grupos por cambio de estado.
    // `total_facturas` sumado daría 2 para UNA factura — por eso el total de
    // facturas ya no sale de acá sino de la vista de facturas.
    const resumen = [
      { dia: "2026-08-01", estado: "completado",  total_despachos: 2, total_facturas: 2, items_solicitados: 20, items_validados: 20 },
      { dia: "2026-08-01", estado: "con_novedad", total_despachos: 1, total_facturas: 1, items_solicitados: 5,  items_validados: 3 },
    ];

    const t = totalizar(resumen);

    expect(t.despachos).toBe(3);
    expect(t.items_validados).toBe(23);
    expect(t).not.toHaveProperty("facturas");
  });
});

describe("serieDiaria", () => {
  it("devuelve { dia, despachos, items_validados } por dia, en orden", () => {
    const resumen = [
      { dia: "2026-08-02", estado: "completado",  total_despachos: 2, items_validados: 20 },
      { dia: "2026-08-01", estado: "completado",  total_despachos: 1, items_validados: 10 },
      { dia: "2026-08-01", estado: "con_novedad", total_despachos: 3, items_validados: 30 },
    ];

    const s = serieDiaria(resumen);

    expect(s.map((d) => d.dia)).toEqual(["2026-08-01", "2026-08-02"]);
    expect(s[0]).toEqual({ dia: "2026-08-01", despachos: 4, items_validados: 40 });
    expect(s[1]).toEqual({ dia: "2026-08-02", despachos: 2, items_validados: 20 });
  });

  it("no expone claves picking ni auditoria", () => {
    const s = serieDiaria([{ dia: "2026-08-01", total_despachos: 1, items_validados: 1 }]);

    expect(s[0]).not.toHaveProperty("picking");
    expect(s[0]).not.toHaveProperty("auditoria");
  });
});

describe("mapaDeCalor", () => {
  it("colapsa los días conservando día de semana y hora", () => {
    const picos = [
      { dia: "2026-08-04", dia_semana: 2, hora: 10, escaneos: 50, escaneos_ok: 48 },
      { dia: "2026-08-11", dia_semana: 2, hora: 10, escaneos: 30, escaneos_ok: 30 },
      { dia: "2026-08-05", dia_semana: 3, hora: 10, escaneos: 5,  escaneos_ok: 5 },
    ];

    const m = mapaDeCalor(picos);

    expect(m).toHaveLength(2);
    const martes10 = m.find((c) => c.dia_semana === 2 && c.hora === 10);
    expect(martes10.escaneos).toBe(80);
    expect(martes10.escaneos_ok).toBe(78);
  });

  it("acumula pasados_sin_escanear por celda, separado de escaneos_ok", () => {
    const picos = [
      { dia: "2026-08-04", dia_semana: 2, hora: 10, escaneos: 10, escaneos_ok: 9, pasados_sin_escanear: 2 },
      { dia: "2026-08-11", dia_semana: 2, hora: 10, escaneos: 10, escaneos_ok: 10, pasados_sin_escanear: 1 },
    ];

    const [martes10] = mapaDeCalor(picos);

    expect(martes10.pasados_sin_escanear).toBe(3);
    expect(martes10.escaneos_ok).toBe(19);
    expect(martes10.escaneos).toBe(20);
  });
});

/**
 * El total por dia de semana NO sale de sumar las horas del mapa de calor.
 *
 * Es la trampa que justifica que existan dos vistas en la migracion 011: un
 * COUNT(DISTINCT) por hora no es aditivo. Si alguien 'simplifica' esto sumando
 * la fila del mapa, estos casos lo agarran.
 */
describe("facturasPorDiaSemana", () => {
  it("devuelve los siete dias aunque falten en el dato", () => {
    const r = facturasPorDiaSemana([{ dia: "2026-08-11", dia_semana: 2, facturas: 12 }]);

    expect(r).toHaveLength(7);
    expect(r.map((d) => d.dia_semana)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Un dia sin trabajo es justamente el que hay que poder ver.
    expect(r[0].facturas).toBe(0);
    expect(r[2].facturas).toBe(12);
  });

  it("acumula las fechas distintas que caen en el mismo dia de semana", () => {
    const r = facturasPorDiaSemana([
      { dia: "2026-08-04", dia_semana: 2, facturas: 10 },
      { dia: "2026-08-11", dia_semana: 2, facturas: 15 },
    ]);

    expect(r[2].facturas).toBe(25);
    // Sin esto no se sabe si 25 son de un martes o el acumulado de dos.
    expect(r[2].dias_con_datos).toBe(2);
  });

  it("no expone facturas_picking ni facturas_auditoria", () => {
    const r = facturasPorDiaSemana([{ dia: "2026-08-11", dia_semana: 2, facturas: 1 }]);

    expect(r[2]).toEqual({ dia_semana: 2, facturas: 1, dias_con_datos: 1 });
    expect(r[2]).not.toHaveProperty("facturas_picking");
    expect(r[2]).not.toHaveProperty("facturas_auditoria");
  });

  it("NO coincide con sumar las horas del mapa: por eso son dos vistas", () => {
    // Misma factura tocada a las 9 y a las 11 de un martes: el mapa la cuenta
    // en las dos celdas, el total del dia la cuenta una vez.
    const mapa = mapaDeCalor([
      { dia: "2026-08-11", dia_semana: 2, hora: 9,  facturas: 1, escaneos: 3, escaneos_ok: 3 },
      { dia: "2026-08-11", dia_semana: 2, hora: 11, facturas: 1, escaneos: 2, escaneos_ok: 2 },
    ]);
    const sumandoHoras = mapa.reduce((t, c) => t + c.facturas, 0);

    const total = facturasPorDiaSemana([
      { dia: "2026-08-11", dia_semana: 2, facturas: 1 },
    ]);

    expect(sumandoHoras).toBe(2);
    expect(total[2].facturas).toBe(1);
    expect(sumandoHoras).not.toBe(total[2].facturas);
  });
});
