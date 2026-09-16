/**
 * cobertura.service.test.js — Totales del tablero de cobertura.
 *
 * Desde la migracion 012 la cobertura se mide sobre auditorias FINALIZADAS
 * (`cubiertas`), no sobre picking. Estos casos fijan que el porcentaje sale de
 * `cubiertas / aplican` y que ninguna clave de picking sobrevive en `totales`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../repositories/cobertura.repository.js", () => ({
  guardarSnapshot: vi.fn(),
  listar: vi.fn(),
  resumenPorDia: vi.fn(),
  porId: vi.fn(),
  actualizarExclusion: vi.fn(),
}));

vi.mock("./facturaSiesa.service.js", () => ({
  documentosDeLaVentana: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import * as coberturaRepo from "../repositories/cobertura.repository.js";
import * as servicio from "./cobertura.service.js";

const diaBase = {
  facturadas: 0, excluidas: 0, aplican: 0, sin_tocar: 0, auditando: 0, cubiertas: 0,
  valor_sin_tocar: 0, mostrador: 0, con_cliente: 0, mostrador_aplican: 0,
  mostrador_cubiertas: 0, con_cliente_aplican: 0, con_cliente_cubiertas: 0, notas_credito: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  coberturaRepo.listar.mockResolvedValue({ facturas: [], total: 0 });
});

describe("tablero", () => {
  it("cobertura_pct = cubiertas / aplican (7 de 10 -> 70)", async () => {
    coberturaRepo.resumenPorDia.mockResolvedValue([
      { ...diaBase, dia: "2026-09-14", facturadas: 6, aplican: 6, cubiertas: 4, auditando: 1, sin_tocar: 1 },
      { ...diaBase, dia: "2026-09-15", facturadas: 4, aplican: 4, cubiertas: 3, sin_tocar: 1 },
    ]);

    const r = await servicio.tablero({ desde: "2026-09-14", hasta: "2026-09-15" });

    expect(r.totales.cubiertas).toBe(7);
    expect(r.totales.aplican).toBe(10);
    expect(r.totales.auditando).toBe(1);
    expect(r.totales.cobertura_pct).toBe(70);
  });

  it("los angulos mostrador / cliente usan sus propias cubiertas", async () => {
    coberturaRepo.resumenPorDia.mockResolvedValue([
      {
        ...diaBase, dia: "2026-09-15", facturadas: 8, aplican: 8, cubiertas: 5,
        mostrador_aplican: 4, mostrador_cubiertas: 1,
        con_cliente_aplican: 4, con_cliente_cubiertas: 4,
      },
    ]);

    const r = await servicio.tablero({ desde: "2026-09-15" });

    expect(r.totales.cobertura_mostrador_pct).toBe(25);
    expect(r.totales.cobertura_identificado_pct).toBe(100);
  });

  it("no expone claves de picking ni alistando en totales", async () => {
    coberturaRepo.resumenPorDia.mockResolvedValue([{ ...diaBase, dia: "2026-09-15" }]);

    const r = await servicio.tablero({ desde: "2026-09-15" });

    for (const clave of ["alistando", "con_picking", "con_auditoria", "mostrador_con_picking", "con_cliente_con_picking"]) {
      expect(r.totales).not.toHaveProperty(clave);
    }
    expect(r.totales).toHaveProperty("mostrador_cubiertas");
    expect(r.totales).toHaveProperty("con_cliente_cubiertas");
  });

  it("sin facturas que apliquen, el porcentaje es null y no 100", async () => {
    coberturaRepo.resumenPorDia.mockResolvedValue([]);

    const r = await servicio.tablero({ desde: "2026-09-15" });

    expect(r.totales.cobertura_pct).toBeNull();
    expect(r.totales.cubiertas).toBe(0);
  });
});
