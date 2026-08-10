/**
 * agregacion.test.js — El colapso de dia -> rango.
 *
 * Cada caso de aca corresponde a un numero que el panel mostraba mal. No son
 * pruebas de "que no explote": son la prueba de que los indicadores dicen lo
 * que dicen que dicen.
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
} from "./agregacion.js";

describe("agruparPorOperario", () => {
  it("colapsa los dias en una fila por operario y modo", () => {
    const filas = [
      { operario_id: "u1", nombre: "Ana", modo: "picking", dia: "2026-08-01", despachos: 3, despachos_ok: 3, despachos_con_novedad: 0, items_validados: 30, despachos_finalizados: 3, minutos_totales: 90 },
      { operario_id: "u1", nombre: "Ana", modo: "picking", dia: "2026-08-02", despachos: 2, despachos_ok: 1, despachos_con_novedad: 1, items_validados: 20, despachos_finalizados: 2, minutos_totales: 30 },
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
      { operario_id: "u1", nombre: "Ana", modo: "picking", despachos: 4, despachos_finalizados: 4, minutos_totales: 40, minutos_promedio: 10 },
      { operario_id: "u1", nombre: "Ana", modo: "picking", despachos: 1, despachos_finalizados: 1, minutos_totales: 60, minutos_promedio: 60 },
    ];

    const r = agruparPorOperario(filas);

    expect(r[0].minutos_promedio).toBe(20);
    expect(r[0].minutos_promedio).not.toBe(35);
  });

  it("no colapsa picking con auditoria", () => {
    const filas = [
      { operario_id: "u1", nombre: "Ana", modo: "picking", despachos: 3, despachos_finalizados: 0, minutos_totales: 0 },
      { operario_id: "u1", nombre: "Ana", modo: "auditoria", despachos: 1, despachos_finalizados: 0, minutos_totales: 0 },
    ];

    expect(agruparPorOperario(filas)).toHaveLength(2);
  });

  it("deja el promedio en null cuando nadie finalizo nada", () => {
    const filas = [
      { operario_id: "u1", nombre: "Ana", modo: "picking", despachos: 2, despachos_finalizados: 0, minutos_totales: 0 },
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
      { codigo_item: "A", descripcion: "Prod A", dia: "2026-08-01", reportes: 3, reportes_abiertos: 1, sin_fisico: 3, averiado: 0, ubicacion_errada: 0, diferencia_cantidad: 0, otro: 0, detectadas_en_auditoria: 0, unidades_faltantes: 12 },
      { codigo_item: "A", descripcion: "Prod A", dia: "2026-08-03", reportes: 5, reportes_abiertos: 2, sin_fisico: 4, averiado: 1, ubicacion_errada: 0, diferencia_cantidad: 0, otro: 0, detectadas_en_auditoria: 2, unidades_faltantes: 20 },
    ];

    const r = agruparNovedadesPorItem(filas);

    expect(r[0].reportes).toBe(8);
    expect(r[0].unidades_faltantes).toBe(32);
    expect(r[0].detectadas_en_auditoria).toBe(2);
  });
});

describe("agruparCalidad", () => {
  it("recalcula la tasa sobre los totales, no promediando tasas diarias", () => {
    // Dia 1: 1 escaneo, 0 aceptados   -> 0%
    // Dia 2: 99 escaneos, 99 aceptados -> 100%
    //
    // Promediar las tasas daria 50%. La tasa real es 99/100 = 99%.
    const filas = [
      { operario_id: "u1", nombre: "Ana", escaneos: 1, aceptados: 0, rechazados: 1, no_encontrado: 1, no_pertenece: 0, excede_cantidad: 0, item_completo: 0, manuales: 0 },
      { operario_id: "u1", nombre: "Ana", escaneos: 99, aceptados: 99, rechazados: 0, no_encontrado: 0, no_pertenece: 0, excede_cantidad: 0, item_completo: 0, manuales: 0 },
    ];

    const r = agruparCalidad(filas);

    expect(r[0].escaneos).toBe(100);
    expect(r[0].tasa_acierto).toBe(99);
    expect(r[0].tasa_acierto).not.toBe(50);
  });

  it("deja la tasa en null si no hubo escaneos", () => {
    expect(agruparCalidad([])).toEqual([]);
  });
});

describe("totalizar", () => {
  it("suma lo aditivo y NO inventa un total de facturas", () => {
    // La misma factura aparece en tres grupos: picking, auditoría y un cambio
    // de estado. `total_facturas` sumado daría 3 para UNA factura — por eso el
    // total de facturas ya no sale de acá sino de la vista de facturas.
    const resumen = [
      { dia: "2026-08-01", modo: "picking",   estado: "completado",  total_despachos: 1, total_facturas: 1, items_solicitados: 10, items_validados: 10 },
      { dia: "2026-08-01", modo: "auditoria", estado: "completado",  total_despachos: 1, total_facturas: 1, items_solicitados: 10, items_validados: 10 },
      { dia: "2026-08-01", modo: "picking",   estado: "con_novedad", total_despachos: 1, total_facturas: 1, items_solicitados: 5,  items_validados: 3 },
    ];

    const t = totalizar(resumen);

    expect(t.despachos).toBe(3);
    expect(t.items_validados).toBe(23);
    expect(t).not.toHaveProperty("facturas");
  });
});

describe("serieDiaria", () => {
  it("arma una fila por día con picking y auditoría separados y en orden", () => {
    const resumen = [
      { dia: "2026-08-02", modo: "picking",   total_despachos: 2, items_validados: 20 },
      { dia: "2026-08-01", modo: "picking",   total_despachos: 1, items_validados: 10 },
      { dia: "2026-08-01", modo: "auditoria", total_despachos: 3, items_validados: 30 },
    ];

    const s = serieDiaria(resumen);

    expect(s.map((d) => d.dia)).toEqual(["2026-08-01", "2026-08-02"]);
    expect(s[0]).toMatchObject({ picking: 1, auditoria: 3, items_validados: 40 });
    expect(s[1]).toMatchObject({ picking: 2, auditoria: 0 });
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
});
