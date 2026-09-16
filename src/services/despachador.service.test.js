/**
 * despachador.service.test.js — Catalogo de despachadores.
 *
 * Repositorio mockeado: lo que se prueba es la regla de negocio (recorte,
 * vacio, duplicado -> 409, baja logica sin DELETE, exigirActivo) y no Supabase.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../repositories/despachadores.repository.js", () => ({
  listar: vi.fn(),
  porId: vi.fn(),
  crear: vi.fn(),
  actualizar: vi.fn(),
}));

import * as repo from "../repositories/despachadores.repository.js";
import * as servicio from "./despachador.service.js";

const ID = "5f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

const despachador = (extra = {}) => ({
  id: ID,
  nombre: "Carlos Perez",
  activo: true,
  created_at: "2026-09-15T10:00:00Z",
  updated_at: null,
  ...extra,
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("crear", () => {
  it("recorta el nombre y lo persiste con activo=true", async () => {
    repo.crear.mockResolvedValue(despachador());

    const r = await servicio.crear({ nombre: "  Carlos Perez " });

    expect(repo.crear).toHaveBeenCalledWith({ nombre: "Carlos Perez", activo: true });
    expect(r.nombre).toBe("Carlos Perez");
  });

  it("con nombre vacio o solo espacios lanza solicitudInvalida (400)", async () => {
    await expect(servicio.crear({ nombre: "   " })).rejects.toMatchObject({ status: 400 });
    await expect(servicio.crear({ nombre: "" })).rejects.toMatchObject({ status: 400 });
    await expect(servicio.crear({})).rejects.toMatchObject({ status: 400 });
    expect(repo.crear).not.toHaveBeenCalled();
  });

  it("con nombre duplicado (23505 del repo) lanza conflicto (409)", async () => {
    repo.crear.mockRejectedValue({ code: "23505", message: "duplicate key" });

    await expect(servicio.crear({ nombre: "carlos perez" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("cualquier otro error del repo sube tal cual", async () => {
    const otro = new Error("boom");
    repo.crear.mockRejectedValue(otro);

    await expect(servicio.crear({ nombre: "Ana" })).rejects.toBe(otro);
  });
});

describe("actualizar", () => {
  it("con activo=false desactiva sin borrar (nunca hay delete)", async () => {
    repo.porId.mockResolvedValue(despachador());
    repo.actualizar.mockResolvedValue(despachador({ activo: false }));

    const r = await servicio.actualizar(ID, { activo: false });

    expect(repo.actualizar).toHaveBeenCalledWith(ID, { activo: false });
    expect(r.activo).toBe(false);
    expect(Object.keys(repo)).not.toContain("eliminar");
  });

  it("recorta el nombre y traduce el duplicado a 409", async () => {
    repo.porId.mockResolvedValue(despachador());
    repo.actualizar.mockResolvedValue(despachador({ nombre: "Ana" }));

    await servicio.actualizar(ID, { nombre: " Ana " });
    expect(repo.actualizar).toHaveBeenCalledWith(ID, { nombre: "Ana" });

    repo.actualizar.mockRejectedValue({ code: "23505" });
    await expect(servicio.actualizar(ID, { nombre: "Ana" })).rejects.toMatchObject({
      status: 409,
    });
  });

  it("inexistente lanza noEncontrado (404)", async () => {
    repo.porId.mockResolvedValue(null);

    await expect(servicio.actualizar(ID, { activo: false })).rejects.toMatchObject({
      status: 404,
    });
    expect(repo.actualizar).not.toHaveBeenCalled();
  });
});

describe("listar", () => {
  it("por defecto pide solo activos; todos=true pide todos", async () => {
    repo.listar.mockResolvedValue([]);

    await servicio.listar();
    expect(repo.listar).toHaveBeenLastCalledWith({ soloActivos: true });

    await servicio.listar({ todos: true });
    expect(repo.listar).toHaveBeenLastCalledWith({ soloActivos: false });

    await servicio.listar({ todos: false });
    expect(repo.listar).toHaveBeenLastCalledWith({ soloActivos: true });
  });
});

describe("exigirActivo", () => {
  it("lanza noEncontrado si no existe", async () => {
    repo.porId.mockResolvedValue(null);

    await expect(servicio.exigirActivo(ID)).rejects.toMatchObject({ status: 404 });
  });

  it("lanza solicitudInvalida si esta inactivo", async () => {
    repo.porId.mockResolvedValue(despachador({ activo: false }));

    await expect(servicio.exigirActivo(ID)).rejects.toMatchObject({ status: 400 });
  });

  it("devuelve el despachador si esta activo", async () => {
    repo.porId.mockResolvedValue(despachador());

    await expect(servicio.exigirActivo(ID)).resolves.toMatchObject({ id: ID, activo: true });
  });
});
