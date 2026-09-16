/**
 * factura.service.test.js — Detalle de factura para el panel del admin.
 *
 * Desde la migracion 012 hay una sola sesion por factura (la auditoria): el
 * detalle deja de cruzar picking con auditoria y deja de existir el
 * comparativo. Lo que se fija aca es la forma de la respuesta que el panel
 * consume y que cada escaneo viaje con `resultado` y `motivo`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../repositories/facturas.repository.js", () => ({
  listar: vi.fn(),
  porNumero: vi.fn(),
  indicadores: vi.fn(),
}));

vi.mock("../repositories/despachos.repository.js", () => ({
  porId: vi.fn(),
  itemsDe: vi.fn(),
  escaneosDe: vi.fn(),
}));

vi.mock("../repositories/alertas.repository.js", () => ({
  listar: vi.fn(),
}));

vi.mock("../repositories/eventos.repository.js", () => ({
  historialPorDespacho: vi.fn(),
}));

import * as facturasRepo from "../repositories/facturas.repository.js";
import * as despachosRepo from "../repositories/despachos.repository.js";
import * as alertasRepo from "../repositories/alertas.repository.js";
import * as eventosRepo from "../repositories/eventos.repository.js";
import * as servicio from "./factura.service.js";

const DESPACHO_ID = "11111111-1111-4111-8111-111111111111";

const resumen = {
  numero_factura: "1520045",
  etapa: "auditada",
  despacho_id: DESPACHO_ID,
  estado: "completado",
  operario_id: "u1",
  operario_nombre: "Ana",
  despachador_id: "d1",
  despachador: "Carlos Perez",
  escaneados: 2,
  pasados_sin_escanear: 1,
};

const despacho = { id: DESPACHO_ID, numero_factura: "1520045", estado: "completado" };

const escaneos = [
  { id: 1, item_id: "i1", metodo: "escaner", resultado: "aceptado", cantidad: 1, motivo: null },
  { id: 2, item_id: "i2", metodo: "pase", resultado: "pasado_sin_escanear", cantidad: 3, motivo: "codigo danado" },
  { id: 3, item_id: "i3", metodo: "pase", resultado: "pasado_sin_escanear", cantidad: 1, motivo: null },
];

const eventos = [
  { id: 2, evento: "item_pase_registrado", created_at: "2026-09-15T10:05:00Z" },
  { id: 1, evento: "despacho_abierto", created_at: "2026-09-15T10:00:00Z" },
];

beforeEach(() => {
  vi.clearAllMocks();
  facturasRepo.porNumero.mockResolvedValue(resumen);
  despachosRepo.porId.mockResolvedValue(despacho);
  despachosRepo.itemsDe.mockResolvedValue([{ id: "i1" }, { id: "i2" }, { id: "i3" }]);
  despachosRepo.escaneosDe.mockResolvedValue(escaneos);
  alertasRepo.listar.mockResolvedValue([]);
  eventosRepo.historialPorDespacho.mockResolvedValue(eventos);
});

describe("detalle", () => {
  it("devuelve { resumen, auditoria, linea_tiempo } sin picking ni comparativo", async () => {
    const r = await servicio.detalle("1520045");

    expect(Object.keys(r).sort()).toEqual(["auditoria", "linea_tiempo", "resumen"]);
    expect(r).not.toHaveProperty("picking");
    expect(r).not.toHaveProperty("comparativo");
    expect(r.auditoria).toMatchObject({ despacho, alertas: [] });
    expect(r.auditoria.items).toHaveLength(3);
  });

  it("busca el despacho por resumen.despacho_id, no por picking_id/auditoria_id", async () => {
    await servicio.detalle("1520045");

    expect(despachosRepo.porId).toHaveBeenCalledTimes(1);
    expect(despachosRepo.porId).toHaveBeenCalledWith(DESPACHO_ID);
  });

  it("cada escaneo trae resultado y motivo; el pase sin motivo queda en null", async () => {
    const r = await servicio.detalle("1520045");

    const pases = r.auditoria.escaneos.filter((e) => e.resultado === "pasado_sin_escanear");
    expect(pases).toHaveLength(2);
    expect(pases[0]).toMatchObject({ metodo: "pase", motivo: "codigo danado" });
    expect(pases[1].motivo).toBeNull();
    expect(r.auditoria.escaneos[0]).toMatchObject({ resultado: "aceptado", motivo: null });
  });

  it("resumen.despachador viaja tal como lo entrega la vista", async () => {
    const r = await servicio.detalle("1520045");

    expect(r.resumen.despachador).toBe("Carlos Perez");
    expect(r.resumen.despachador_id).toBe("d1");
  });

  it("linea_tiempo son solo los eventos de la auditoria, en orden cronologico y sin etapa", async () => {
    const r = await servicio.detalle("1520045");

    expect(r.linea_tiempo.map((e) => e.id)).toEqual([1, 2]);
    expect(r.linea_tiempo[0]).not.toHaveProperty("etapa");
  });

  it("lanza noEncontrado (404) si la factura no tiene despacho", async () => {
    facturasRepo.porNumero.mockResolvedValue(null);

    await expect(servicio.detalle("999")).rejects.toMatchObject({ status: 404 });
    expect(despachosRepo.porId).not.toHaveBeenCalled();
  });
});
