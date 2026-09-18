/**
 * despachoMega.schema.test.js — Contratos de entrada del flujo auditor-only.
 *
 * Zod puro, sin I/O: `safeParse` sobre cada esquema. Lo que se protege aca es
 * el contrato con el frontend: que `modo` ya no exista, que `despachador_id`
 * viaje como uuid, y que los esquemas nuevos (pase sin escanear, catalogo de
 * despachadores) rechacen lo que el servicio no sabria manejar.
 */
import { describe, it, expect } from "vitest";
import * as schema from "./despachoMega.schema.js";

const UUID = "5f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

describe("abrirDespachoBody", () => {
  it("acepta despachador_id uuid y rechaza uno invalido", () => {
    const ok = schema.abrirDespachoBody.safeParse({
      numero_factura: "1520045",
      despachador_id: UUID,
    });
    expect(ok.success).toBe(true);
    expect(ok.data.despachador_id).toBe(UUID);

    const mal = schema.abrirDespachoBody.safeParse({
      numero_factura: "1520045",
      despachador_id: "carlos",
    });
    expect(mal.success).toBe(false);
  });

  it("no exige despachador_id (la regla de creacion vive en el servicio)", () => {
    const r = schema.abrirDespachoBody.safeParse({ numero_factura: "1520045" });
    expect(r.success).toBe(true);
    expect(r.data.despachador_id).toBeUndefined();
  });

  it("descarta `modo` sin fallar", () => {
    const r = schema.abrirDespachoBody.safeParse({
      numero_factura: "1520045",
      modo: "picking",
    });
    expect(r.success).toBe(true);
    expect(r.data).not.toHaveProperty("modo");
  });

  it("no exporta el enum `modo`", () => {
    expect(schema.modo).toBeUndefined();
  });
});

describe("pasarSinEscanearBody", () => {
  it("exige item_id uuid y cantidad entera positiva", () => {
    expect(
      schema.pasarSinEscanearBody.safeParse({ item_id: UUID, cantidad: 6 }).success,
    ).toBe(true);
    expect(
      schema.pasarSinEscanearBody.safeParse({ item_id: UUID, cantidad: "3" }).data
        ?.cantidad,
    ).toBe(3);

    expect(schema.pasarSinEscanearBody.safeParse({ item_id: UUID, cantidad: 0 }).success).toBe(false);
    expect(schema.pasarSinEscanearBody.safeParse({ item_id: UUID, cantidad: -1 }).success).toBe(false);
    expect(schema.pasarSinEscanearBody.safeParse({ item_id: UUID, cantidad: 1.5 }).success).toBe(false);
    expect(schema.pasarSinEscanearBody.safeParse({ item_id: "x", cantidad: 1 }).success).toBe(false);
  });

  it("permite motivo opcional recortado, con maximo 500", () => {
    const sin = schema.pasarSinEscanearBody.safeParse({ item_id: UUID, cantidad: 1 });
    expect(sin.success).toBe(true);
    expect(sin.data.motivo).toBeUndefined();

    const con = schema.pasarSinEscanearBody.safeParse({
      item_id: UUID,
      cantidad: 1,
      motivo: "  codigo de barras danado  ",
    });
    expect(con.success).toBe(true);
    expect(con.data.motivo).toBe("codigo de barras danado");

    const largo = schema.pasarSinEscanearBody.safeParse({
      item_id: UUID,
      cantidad: 1,
      motivo: "x".repeat(501),
    });
    expect(largo.success).toBe(false);
  });
});

describe("crearDespachadorBody", () => {
  it("recorta el nombre y rechaza vacio o demasiado corto", () => {
    const ok = schema.crearDespachadorBody.safeParse({ nombre: "  Carlos Perez " });
    expect(ok.success).toBe(true);
    expect(ok.data.nombre).toBe("Carlos Perez");

    expect(schema.crearDespachadorBody.safeParse({ nombre: "   " }).success).toBe(false);
    expect(schema.crearDespachadorBody.safeParse({ nombre: "" }).success).toBe(false);
    expect(schema.crearDespachadorBody.safeParse({ nombre: "A" }).success).toBe(false);
    expect(schema.crearDespachadorBody.safeParse({}).success).toBe(false);
  });

  it("acota el nombre a 80 caracteres", () => {
    expect(
      schema.crearDespachadorBody.safeParse({ nombre: "x".repeat(81) }).success,
    ).toBe(false);
  });
});

describe("actualizarDespachadorBody", () => {
  it("exige al menos un campo", () => {
    expect(schema.actualizarDespachadorBody.safeParse({}).success).toBe(false);
  });

  it("acepta activo boolean y nombre recortado", () => {
    const baja = schema.actualizarDespachadorBody.safeParse({ activo: false });
    expect(baja.success).toBe(true);
    expect(baja.data.activo).toBe(false);

    const nombre = schema.actualizarDespachadorBody.safeParse({ nombre: " Ana " });
    expect(nombre.success).toBe(true);
    expect(nombre.data.nombre).toBe("Ana");

    expect(schema.actualizarDespachadorBody.safeParse({ activo: "false" }).success).toBe(false);
  });
});

describe("listarDespachadoresQuery", () => {
  it("convierte todos=1/true en booleano y lo omite por defecto", () => {
    expect(schema.listarDespachadoresQuery.safeParse({ todos: "1" }).data.todos).toBe(true);
    expect(schema.listarDespachadoresQuery.safeParse({ todos: "true" }).data.todos).toBe(true);
    expect(schema.listarDespachadoresQuery.safeParse({ todos: "false" }).data.todos).toBe(false);
    expect(schema.listarDespachadoresQuery.safeParse({ todos: "0" }).data.todos).toBe(false);
    expect(schema.listarDespachadoresQuery.safeParse({}).data.todos).toBeUndefined();
    expect(schema.listarDespachadoresQuery.safeParse({ todos: "si" }).success).toBe(false);
  });
});

describe("enums de etapa y cobertura", () => {
  it("etapaFactura y estadoCobertura rechazan alistando/alistada", () => {
    expect(schema.etapaFactura.safeParse("alistando").success).toBe(false);
    expect(schema.etapaFactura.safeParse("alistada").success).toBe(false);
    expect(schema.etapaFactura.safeParse("auditando").success).toBe(true);
    expect(schema.etapaFactura.safeParse("auditada").success).toBe(true);

    expect(schema.estadoCobertura.safeParse("alistando").success).toBe(false);
    expect(schema.estadoCobertura.safeParse("alistada").success).toBe(false);
    expect(schema.estadoCobertura.safeParse("sin_tocar").success).toBe(true);
    expect(schema.estadoCobertura.safeParse("auditando").success).toBe(true);
    expect(schema.estadoCobertura.safeParse("auditada").success).toBe(true);
    expect(schema.estadoCobertura.safeParse("excluida").success).toBe(true);
  });
});

describe("querys de lectura sin modo", () => {
  it("bandejaNovedadesQuery, rangoFechasQuery y listarDespachosQuery descartan modo", () => {
    for (const q of [
      schema.bandejaNovedadesQuery,
      schema.rangoFechasQuery,
      schema.listarDespachosQuery,
    ]) {
      const r = q.safeParse({ modo: "picking" });
      expect(r.success).toBe(true);
      expect(r.data).not.toHaveProperty("modo");
    }
  });

  it("actualizarOperarioBody ya no acepta modo_habilitado como unico campo", () => {
    // Zod descarta la clave desconocida y el refine exige al menos un campo.
    const r = schema.actualizarOperarioBody.safeParse({ modo_habilitado: "auditoria" });
    expect(r.success).toBe(false);
    expect(schema.actualizarOperarioBody.safeParse({ activo: false }).success).toBe(true);
  });
});

describe("validarItemBody", () => {
  it("item_id es opcional", () => {
    const r = schema.validarItemBody.safeParse({ codigo: "A100" });
    expect(r.success).toBe(true);
    expect(r.data.item_id).toBeUndefined();
  });

  it("item_id debe ser uuid", () => {
    expect(schema.validarItemBody.safeParse({ codigo: "A100", item_id: UUID }).success).toBe(true);
    expect(schema.validarItemBody.safeParse({ codigo: "A100", item_id: "x" }).success).toBe(false);
  });
});
