/**
 * alerta.service.test.js — Reporte de novedades a inventario.
 *
 * El correo de respaldo describia el "proceso" (picking / auditoria). Con un
 * solo modo esa fila no dice nada: el payload del correo no lleva `modo`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../repositories/alertas.repository.js", () => ({
  crear: vi.fn(),
  porId: vi.fn(),
  actualizar: vi.fn(),
  listar: vi.fn(),
  bandeja: vi.fn(),
  conteoPorEstado: vi.fn(),
  abiertasDe: vi.fn(),
}));

vi.mock("../repositories/despachos.repository.js", () => ({
  porId: vi.fn(),
  itemsDe: vi.fn(),
}));

vi.mock("../repositories/eventos.repository.js", () => ({
  registrar: vi.fn(),
  EVENTO: {
    ALERTA_CREADA: "alerta_creada",
    ALERTA_ACTUALIZADA: "alerta_actualizada",
  },
}));

vi.mock("../lib/correo.js", () => ({
  notificarAlertaInventario: vi.fn().mockResolvedValue(true),
}));

import * as alertasRepo from "../repositories/alertas.repository.js";
import * as despachosRepo from "../repositories/despachos.repository.js";
import { notificarAlertaInventario } from "../lib/correo.js";
import * as servicio from "./alerta.service.js";

const DESPACHO_ID = "11111111-1111-4111-8111-111111111111";
const OPERARIO_ID = "44444444-4444-4444-8444-444444444444";

const usuario = {
  userId: "55555555-5555-4555-8555-555555555555",
  correo: "auditor@merkahorrosas.com",
  nombre: "Ana",
  operarioId: OPERARIO_ID,
  rol: "operario",
};

beforeEach(() => {
  vi.clearAllMocks();
  despachosRepo.porId.mockResolvedValue({
    id: DESPACHO_ID,
    numero_factura: "1520045",
    estado: "en_proceso",
    operario_id: OPERARIO_ID,
    modo: "auditoria",
  });
  despachosRepo.itemsDe.mockResolvedValue([]);
  alertasRepo.crear.mockImplementation(async (registro) => ({ id: "a1", ...registro }));
});

describe("crear", () => {
  it("notifica por correo sin la clave modo", async () => {
    await servicio.crear(
      { despacho_id: DESPACHO_ID, codigo_item: "44736", cantidad_faltante: 2, motivo: "sin_fisico" },
      usuario,
    );

    expect(notificarAlertaInventario).toHaveBeenCalledTimes(1);
    const payload = notificarAlertaInventario.mock.calls[0][0];
    expect(payload).not.toHaveProperty("modo");
    expect(payload).toMatchObject({
      numeroFactura: "1520045",
      codigoItem: "44736",
      cantidadFaltante: 2,
      motivo: "sin_fisico",
    });
  });

  it("rechaza reportar sobre el despacho de otro operario", async () => {
    await expect(
      servicio.crear(
        { despacho_id: DESPACHO_ID, codigo_item: "44736", cantidad_faltante: 2, motivo: "sin_fisico" },
        { ...usuario, operarioId: "otro" },
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(alertasRepo.crear).not.toHaveBeenCalled();
  });
});
