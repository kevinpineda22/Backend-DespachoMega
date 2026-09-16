/**
 * operario.service.test.js — Alta y listado de operarios del modulo.
 *
 * Desde la migracion 012 `modo_habilitado` solo puede valer 'auditoria' y la
 * columna tiene ese DEFAULT. El servicio no manda 'ambos' (ya no existe en el
 * enum: el insert fallaria) ni acepta el campo desde el cliente.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../repositories/operarios.repository.js", () => ({
  listar: vi.fn(),
  porId: vi.fn(),
  porUserId: vi.fn(),
  porCorreo: vi.fn(),
  crear: vi.fn(),
  actualizar: vi.fn(),
}));

vi.mock("../repositories/eventos.repository.js", () => ({
  registrar: vi.fn(),
  historialPorCorreo: vi.fn(),
  EVENTO: { OPERARIO_ACTUALIZADO: "operario_actualizado" },
}));

vi.mock("../repositories/perfiles.repository.js", () => ({
  perfilesConRutas: vi.fn(),
}));

vi.mock("../middleware/auth.js", () => ({
  rolSegunRutas: (rutas = []) =>
    rutas.includes("/despacho-mega/admin")
      ? "admin"
      : rutas.includes("/despacho-mega/operario")
        ? "operario"
        : null,
}));

import * as operariosRepo from "../repositories/operarios.repository.js";
import { perfilesConRutas } from "../repositories/perfiles.repository.js";
import * as servicio from "./operario.service.js";

const USER_ID = "55555555-5555-4555-8555-555555555555";
const admin = { userId: "admin-1", correo: "admin@merkahorrosas.com", rol: "admin" };

const perfil = {
  user_id: USER_ID,
  correo: "Nuevo@merkahorrosas.com",
  nombre: "Nuevo Operario",
  rutas: ["/despacho-mega/operario"],
};

beforeEach(() => {
  vi.clearAllMocks();
  perfilesConRutas.mockResolvedValue([perfil]);
  operariosRepo.listar.mockResolvedValue([]);
  operariosRepo.porUserId.mockResolvedValue(null);
  operariosRepo.crear.mockImplementation(async (registro) => ({ id: "op-1", ...registro }));
});

describe("listar", () => {
  it("anuncia a los pendientes con modo_habilitado 'auditoria', nunca 'ambos'", async () => {
    const r = await servicio.listar();

    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ pendiente_ingreso: true, modo_habilitado: "auditoria" });
  });
});

describe("provisionar", () => {
  it("no envia modo_habilitado al crear: lo cubre el DEFAULT de la base", async () => {
    await servicio.provisionar(USER_ID, { sede: "MEGA" }, admin);

    expect(operariosRepo.crear).toHaveBeenCalledTimes(1);
    const registro = operariosRepo.crear.mock.calls[0][0];
    expect(registro).not.toHaveProperty("modo_habilitado");
    expect(registro).toMatchObject({
      user_id: USER_ID,
      correo: "nuevo@merkahorrosas.com",
      rol: "operario",
      sede: "MEGA",
      activo: true,
    });
  });

  it("ignora un modo_habilitado que venga del cliente", async () => {
    await servicio.provisionar(USER_ID, { modo_habilitado: "ambos" }, admin);

    expect(operariosRepo.crear.mock.calls[0][0]).not.toHaveProperty("modo_habilitado");
  });
});
