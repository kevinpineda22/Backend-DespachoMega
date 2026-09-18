/**
 * despacho.service.test.js — Apertura unica (auditoria) y pase sin escanear.
 *
 * Todo lo que toca Supabase o Siesa esta mockeado: se prueban las reglas, no
 * la infraestructura. Los asserts miran lo que se le pide al repositorio
 * (`crearConItems`, `registrarEscaneo`, `actualizarItem`) porque eso es lo que
 * termina en la base y lo que las vistas van a contar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../repositories/despachos.repository.js", () => ({
  despachoVigente: vi.fn(),
  porId: vi.fn(),
  crearConItems: vi.fn(),
  actualizar: vi.fn(),
  itemsDe: vi.fn(),
  actualizarItem: vi.fn(),
  registrarEscaneo: vi.fn(),
  escaneosDe: vi.fn(),
  listar: vi.fn(),
  registrarAprobacion: vi.fn(),
  aprobacionesDe: vi.fn(),
}));

vi.mock("../repositories/alertas.repository.js", () => ({
  listar: vi.fn(),
  abiertasDe: vi.fn(),
}));

vi.mock("../repositories/eventos.repository.js", () => ({
  registrar: vi.fn(),
  historialPorDespacho: vi.fn(),
  EVENTO: {
    DESPACHO_ABIERTO: "despacho_abierto",
    DESPACHO_REANUDADO: "despacho_reanudado",
    ITEM_VALIDADO: "item_validado",
    ITEM_AJUSTADO: "item_ajustado",
    ESCANEO_RECHAZADO: "escaneo_rechazado",
    ITEM_PASE_REGISTRADO: "item_pase_registrado",
    DESPACHO_FINALIZADO: "despacho_finalizado",
    DESPACHO_CANCELADO: "despacho_cancelado",
    DESPACHO_APROBADO: "despacho_aprobado",
    DESPACHO_RECHAZADO: "despacho_rechazado",
  },
}));

vi.mock("../repositories/catalogo.repository.js", () => ({
  resolverCodigo: vi.fn(),
}));

vi.mock("./facturaSiesa.service.js", () => ({
  consultarFactura: vi.fn(),
}));

vi.mock("./inventarioSiesa.service.js", () => ({
  existenciasDeItems: vi.fn(),
}));

vi.mock("./despachador.service.js", () => ({
  exigirActivo: vi.fn(),
}));

import * as despachosRepo from "../repositories/despachos.repository.js";
import * as eventosRepo from "../repositories/eventos.repository.js";
import { consultarFactura } from "./facturaSiesa.service.js";
import { resolverCodigo } from "../repositories/catalogo.repository.js";
import * as despachadorService from "./despachador.service.js";
import * as servicio from "./despacho.service.js";

const DESPACHO_ID = "11111111-1111-4111-8111-111111111111";
const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const DESPACHADOR_ID = "33333333-3333-4333-8333-333333333333";
const OPERARIO_ID = "44444444-4444-4444-8444-444444444444";

const usuario = {
  userId: "55555555-5555-4555-8555-555555555555",
  correo: "auditor@merkahorrosas.com",
  operarioId: OPERARIO_ID,
  rol: "operario",
};

const despachadorEmbed = { id: DESPACHADOR_ID, nombre: "Carlos Perez", activo: true };

const despacho = (extra = {}) => ({
  id: DESPACHO_ID,
  numero_factura: "1520045",
  tipo_documento: "P05",
  estado: "en_proceso",
  operario_id: OPERARIO_ID,
  despachador_id: DESPACHADOR_ID,
  despachador: despachadorEmbed,
  total_items: 2,
  items_validados: 0,
  ...extra,
});

const item = (extra = {}) => ({
  id: ITEM_ID,
  despacho_id: DESPACHO_ID,
  linea: 1,
  codigo_item: "A100",
  descripcion: "Producto A",
  unidad: "UND",
  cantidad_solicitada: 10,
  cantidad_validada: 4,
  estado_item: "parcial",
  ...extra,
});

const otroItem = () =>
  item({
    id: "66666666-6666-4666-8666-666666666666",
    linea: 2,
    codigo_item: "B200",
    cantidad_solicitada: 3,
    cantidad_validada: 3,
    estado_item: "completo",
  });

const facturaSiesa = () => ({
  encabezado: {
    numero_factura: "1520045",
    tipo_documento: "P05",
    fecha_factura: "2026-09-15",
    cliente_nit: "900123456",
    cliente_nombre: "Cliente SAS",
    sede: "MEGA",
    bodega: "01",
  },
  items: [
    { linea: 1, codigo_item: "A100", descripcion: "Producto A", unidad: "UND", cantidad_solicitada: 10, precio_unitario: 100 },
    { linea: 2, codigo_item: "B200", descripcion: "Producto B", unidad: "UND", cantidad_solicitada: 3, precio_unitario: 50 },
  ],
  filasCrudas: [{ raw: true }],
});

beforeEach(() => {
  vi.resetAllMocks();
  eventosRepo.registrar.mockResolvedValue(undefined);
  despachosRepo.itemsDe.mockResolvedValue([item(), otroItem()]);
  despachosRepo.actualizar.mockImplementation(async (_id, cambios) => despacho(cambios));
  despachosRepo.actualizarItem.mockImplementation(async (_id, cambios) => item(cambios));
  despachosRepo.registrarEscaneo.mockImplementation(async (e) => ({ id: 1, ...e }));
});

// ---------------------------------------------------------------------------
// abrir
// ---------------------------------------------------------------------------

describe("abrir", () => {
  it("sin despachador_id en creacion lanza solicitudInvalida y no consulta Siesa", async () => {
    despachosRepo.despachoVigente.mockResolvedValue(null);

    await expect(
      servicio.abrir({ numeroFactura: "1520045", usuario }),
    ).rejects.toMatchObject({ status: 400 });

    expect(consultarFactura).not.toHaveBeenCalled();
    expect(despachosRepo.crearConItems).not.toHaveBeenCalled();
  });

  it("con despachador inexistente o inactivo es rechazado y no crea", async () => {
    despachosRepo.despachoVigente.mockResolvedValue(null);

    despachadorService.exigirActivo.mockRejectedValueOnce({ status: 404 });
    await expect(
      servicio.abrir({ numeroFactura: "1520045", despachadorId: DESPACHADOR_ID, usuario }),
    ).rejects.toMatchObject({ status: 404 });

    despachadorService.exigirActivo.mockRejectedValueOnce({ status: 400 });
    await expect(
      servicio.abrir({ numeroFactura: "1520045", despachadorId: DESPACHADOR_ID, usuario }),
    ).rejects.toMatchObject({ status: 400 });

    expect(consultarFactura).not.toHaveBeenCalled();
    expect(despachosRepo.crearConItems).not.toHaveBeenCalled();
  });

  it("con despachador valido lo persiste en crearConItems y viaja en la respuesta", async () => {
    despachosRepo.despachoVigente.mockResolvedValue(null);
    despachadorService.exigirActivo.mockResolvedValue(despachadorEmbed);
    consultarFactura.mockResolvedValue(facturaSiesa());
    despachosRepo.crearConItems.mockResolvedValue(despacho());

    const r = await servicio.abrir({
      numeroFactura: "1520045",
      despachadorId: DESPACHADOR_ID,
      usuario,
    });

    expect(despachadorService.exigirActivo).toHaveBeenCalledWith(DESPACHADOR_ID);
    expect(consultarFactura).toHaveBeenCalledWith("1520045", { tipoDocumento: undefined });

    const [registro, items] = despachosRepo.crearConItems.mock.calls[0];
    expect(registro).toMatchObject({
      numero_factura: "1520045",
      despachador_id: DESPACHADOR_ID,
      estado: "en_proceso",
      operario_id: OPERARIO_ID,
      total_items: 2,
    });
    expect(items).toHaveLength(2);

    expect(r.reanudado).toBe(false);
    expect(r.despacho.despachador).toEqual(despachadorEmbed);
    expect(r).not.toHaveProperty("picking");
    expect(r).not.toHaveProperty("sin_picking");

    expect(eventosRepo.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        evento: "despacho_abierto",
        payload: expect.objectContaining({ despachador_id: DESPACHADOR_ID }),
      }),
    );
  });

  it("no envia `modo` ni `despacho_origen_id` al repositorio", async () => {
    despachosRepo.despachoVigente.mockResolvedValue(null);
    despachadorService.exigirActivo.mockResolvedValue(despachadorEmbed);
    consultarFactura.mockResolvedValue(facturaSiesa());
    despachosRepo.crearConItems.mockResolvedValue(despacho());

    await servicio.abrir({ numeroFactura: "1520045", despachadorId: DESPACHADOR_ID, usuario });

    const [registro] = despachosRepo.crearConItems.mock.calls[0];
    expect(registro).not.toHaveProperty("modo");
    expect(registro).not.toHaveProperty("despacho_origen_id");
    expect(despachosRepo.despachoVigente).toHaveBeenCalledWith("1520045");
  });

  it("reanudar no exige despachador_id y devuelve el despachador guardado", async () => {
    despachosRepo.despachoVigente.mockResolvedValue(despacho());

    const r = await servicio.abrir({ numeroFactura: "1520045", usuario });

    expect(r.reanudado).toBe(true);
    expect(r.despacho.despachador).toEqual(despachadorEmbed);
    expect(r.items).toHaveLength(2);
    expect(despachadorService.exigirActivo).not.toHaveBeenCalled();
    expect(consultarFactura).not.toHaveBeenCalled();
    expect(despachosRepo.crearConItems).not.toHaveBeenCalled();
    expect(r).not.toHaveProperty("picking");
  });

  it("reanudar ignora un despachador_id distinto al guardado (no lo valida)", async () => {
    despachosRepo.despachoVigente.mockResolvedValue(despacho());

    const r = await servicio.abrir({
      numeroFactura: "1520045",
      despachadorId: "77777777-7777-4777-8777-777777777777",
      usuario,
    });

    expect(r.reanudado).toBe(true);
    expect(r.despacho.despachador_id).toBe(DESPACHADOR_ID);
    expect(despachadorService.exigirActivo).not.toHaveBeenCalled();
  });

  it("reanudar un despacho cerrado lanza conflicto", async () => {
    despachosRepo.despachoVigente.mockResolvedValue(despacho({ estado: "completado" }));

    await expect(servicio.abrir({ numeroFactura: "1520045", usuario })).rejects.toMatchObject({
      status: 409,
    });
  });
});

// ---------------------------------------------------------------------------
// pasarSinEscanear
// ---------------------------------------------------------------------------

describe("pasarSinEscanear", () => {
  beforeEach(() => {
    despachosRepo.porId.mockResolvedValue(despacho());
  });

  it("cantidad parcial deja la linea parcial y registra pasado_sin_escanear con metodo pase", async () => {
    const r = await servicio.pasarSinEscanear(
      DESPACHO_ID,
      { item_id: ITEM_ID, cantidad: 2 },
      usuario,
    );

    expect(despachosRepo.actualizarItem).toHaveBeenCalledWith(
      ITEM_ID,
      expect.objectContaining({ cantidad_validada: 6, estado_item: "parcial", validado_por: OPERARIO_ID }),
    );
    expect(despachosRepo.registrarEscaneo).toHaveBeenCalledWith(
      expect.objectContaining({
        despacho_id: DESPACHO_ID,
        item_id: ITEM_ID,
        operario_id: OPERARIO_ID,
        resultado: "pasado_sin_escanear",
        metodo: "pase",
        codigo_ingresado: "A100",
        cantidad: 2,
        motivo: null,
      }),
    );
    expect(r.resultado).toBe("pasado_sin_escanear");
    expect(r.item.estado_item).toBe("parcial");
    expect(r.motivo).toBeNull();
  });

  it("cantidad que completa la linea la deja completa y recalcula items_validados", async () => {
    const r = await servicio.pasarSinEscanear(
      DESPACHO_ID,
      { item_id: ITEM_ID, cantidad: 6 },
      usuario,
    );

    expect(despachosRepo.actualizarItem).toHaveBeenCalledWith(
      ITEM_ID,
      expect.objectContaining({ cantidad_validada: 10, estado_item: "completo" }),
    );
    // La otra linea ya estaba completa: ahora son 2 de 2.
    expect(despachosRepo.actualizar).toHaveBeenCalledWith(DESPACHO_ID, { items_validados: 2 });
    expect(r.item.estado_item).toBe("completo");
    expect(r.despacho.items_validados).toBe(2);
  });

  it("registra el evento item_pase_registrado con el motivo", async () => {
    await servicio.pasarSinEscanear(
      DESPACHO_ID,
      { item_id: ITEM_ID, cantidad: 1, motivo: "codigo danado" },
      usuario,
    );

    expect(eventosRepo.registrar).toHaveBeenCalledWith(
      expect.objectContaining({
        despachoId: DESPACHO_ID,
        evento: "item_pase_registrado",
        payload: expect.objectContaining({ codigoItem: "A100", cantidad: 1, motivo: "codigo danado" }),
      }),
    );
  });

  it("con motivo lo persiste; sin motivo queda null", async () => {
    await servicio.pasarSinEscanear(
      DESPACHO_ID,
      { item_id: ITEM_ID, cantidad: 1, motivo: "codigo danado" },
      usuario,
    );
    expect(despachosRepo.registrarEscaneo).toHaveBeenLastCalledWith(
      expect.objectContaining({ motivo: "codigo danado" }),
    );

    const r = await servicio.pasarSinEscanear(
      DESPACHO_ID,
      { item_id: ITEM_ID, cantidad: 1 },
      usuario,
    );
    expect(despachosRepo.registrarEscaneo).toHaveBeenLastCalledWith(
      expect.objectContaining({ motivo: null }),
    );
    expect(r.motivo).toBeNull();
  });

  it("con exceso rechaza entero con excede_cantidad y no altera cantidad_validada", async () => {
    // 10 facturadas, 4 validadas: faltan 6; se intenta pasar 7.
    const r = await servicio.pasarSinEscanear(
      DESPACHO_ID,
      { item_id: ITEM_ID, cantidad: 7 },
      usuario,
    );

    expect(r.resultado).toBe("excede_cantidad");
    expect(despachosRepo.actualizarItem).not.toHaveBeenCalled();
    expect(despachosRepo.actualizar).not.toHaveBeenCalled();
    expect(despachosRepo.registrarEscaneo).toHaveBeenCalledWith(
      expect.objectContaining({
        resultado: "excede_cantidad",
        metodo: "pase",
        codigo_ingresado: "A100",
        cantidad: 7,
      }),
    );
    expect(eventosRepo.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ evento: "escaneo_rechazado" }),
    );
    expect(r.item.cantidad_validada).toBe(4);
  });

  it("sobre una linea completa cae en excede_cantidad", async () => {
    despachosRepo.itemsDe.mockResolvedValue([
      item({ cantidad_validada: 10, estado_item: "completo" }),
    ]);

    const r = await servicio.pasarSinEscanear(
      DESPACHO_ID,
      { item_id: ITEM_ID, cantidad: 1 },
      usuario,
    );

    expect(r.resultado).toBe("excede_cantidad");
    expect(despachosRepo.actualizarItem).not.toHaveBeenCalled();
  });

  it("en despacho no en_proceso lanza conflicto", async () => {
    despachosRepo.porId.mockResolvedValue(despacho({ estado: "completado" }));

    await expect(
      servicio.pasarSinEscanear(DESPACHO_ID, { item_id: ITEM_ID, cantidad: 1 }, usuario),
    ).rejects.toMatchObject({ status: 409 });
    expect(despachosRepo.registrarEscaneo).not.toHaveBeenCalled();
  });

  it("de otro operario lanza prohibido; el admin si puede", async () => {
    despachosRepo.porId.mockResolvedValue(despacho({ operario_id: "otro" }));

    await expect(
      servicio.pasarSinEscanear(DESPACHO_ID, { item_id: ITEM_ID, cantidad: 1 }, usuario),
    ).rejects.toMatchObject({ status: 403 });

    const r = await servicio.pasarSinEscanear(
      DESPACHO_ID,
      { item_id: ITEM_ID, cantidad: 1 },
      { ...usuario, rol: "admin" },
    );
    expect(r.resultado).toBe("pasado_sin_escanear");
  });

  it("despacho o item inexistente lanza noEncontrado", async () => {
    despachosRepo.porId.mockResolvedValueOnce(null);
    await expect(
      servicio.pasarSinEscanear(DESPACHO_ID, { item_id: ITEM_ID, cantidad: 1 }, usuario),
    ).rejects.toMatchObject({ status: 404 });

    await expect(
      servicio.pasarSinEscanear(
        DESPACHO_ID,
        { item_id: "88888888-8888-4888-8888-888888888888", cantidad: 1 },
        usuario,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(despachosRepo.registrarEscaneo).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// validar con item_id (modo cine)
// ---------------------------------------------------------------------------

describe("validar con item_id", () => {
  // Dos lineas con el MISMO codigo_item: la 1 ya completa, la 2 con cupo.
  // Sin `item_id`, la regla "primera con cupo" elegiria la 2.
  const LINEA_1 = ITEM_ID;
  const LINEA_2 = "77777777-7777-4777-8777-777777777777";

  const duplicadas = () => [
    item({ id: LINEA_1, linea: 1, cantidad_solicitada: 10, cantidad_validada: 4, estado_item: "parcial" }),
    item({ id: LINEA_2, linea: 2, cantidad_solicitada: 5, cantidad_validada: 0, estado_item: "pendiente" }),
    otroItem(),
  ];

  beforeEach(() => {
    despachosRepo.porId.mockResolvedValue(despacho());
    despachosRepo.itemsDe.mockResolvedValue(duplicadas());
    resolverCodigo.mockImplementation(async (codigo) => ({
      codigoItem: codigo,
      factor: 1,
      unidad: "UND",
      origen: "item",
    }));
  });

  it("con item_id suma a esa linea aunque haya otra con el mismo codigo y cupo", async () => {
    const r = await servicio.validar(
      DESPACHO_ID,
      { codigo: "A100", metodo: "manual", cantidad: 2, item_id: LINEA_2 },
      usuario,
    );

    expect(r.resultado).toBe("aceptado");
    expect(despachosRepo.actualizarItem).toHaveBeenCalledTimes(1);
    expect(despachosRepo.actualizarItem).toHaveBeenCalledWith(
      LINEA_2,
      expect.objectContaining({ cantidad_validada: 2, estado_item: "parcial" }),
    );
    expect(despachosRepo.registrarEscaneo).toHaveBeenCalledWith(
      expect.objectContaining({ item_id: LINEA_2, resultado: "aceptado", cantidad: 2 }),
    );
  });

  it("con item_id de otro producto rechaza no_pertenece sin alterar cantidades", async () => {
    // La linea en pantalla es B200; el codigo escaneado resuelve a A100.
    const r = await servicio.validar(
      DESPACHO_ID,
      { codigo: "A100", metodo: "escaner", cantidad: 1, item_id: otroItem().id },
      usuario,
    );

    expect(r.resultado).toBe("no_pertenece");
    expect(r.mensaje).toMatch(/B200/);
    expect(despachosRepo.actualizarItem).not.toHaveBeenCalled();
    expect(despachosRepo.actualizar).not.toHaveBeenCalled();
    expect(despachosRepo.registrarEscaneo).toHaveBeenCalledWith(
      expect.objectContaining({
        item_id: otroItem().id,
        codigo_item_resuelto: "A100",
        resultado: "no_pertenece",
      }),
    );
    expect(eventosRepo.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ evento: "escaneo_rechazado" }),
    );
  });

  it("con item_id que no pertenece al despacho lanza noEncontrado", async () => {
    await expect(
      servicio.validar(
        DESPACHO_ID,
        { codigo: "A100", metodo: "escaner", cantidad: 1, item_id: "88888888-8888-4888-8888-888888888888" },
        usuario,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(despachosRepo.registrarEscaneo).not.toHaveBeenCalled();
  });

  it("con item_id sobre linea completa rechaza item_completo", async () => {
    despachosRepo.itemsDe.mockResolvedValue([
      item({ id: LINEA_1, cantidad_validada: 10, estado_item: "completo" }),
      item({ id: LINEA_2, linea: 2, cantidad_solicitada: 5, cantidad_validada: 0 }),
    ]);

    const r = await servicio.validar(
      DESPACHO_ID,
      { codigo: "A100", metodo: "escaner", cantidad: 1, item_id: LINEA_1 },
      usuario,
    );

    expect(r.resultado).toBe("item_completo");
    expect(despachosRepo.actualizarItem).not.toHaveBeenCalled();
  });

  it("sin item_id conserva el comportamiento actual: primera linea con cupo", async () => {
    const r = await servicio.validar(
      DESPACHO_ID,
      { codigo: "A100", metodo: "manual", cantidad: 2 },
      usuario,
    );

    expect(r.resultado).toBe("aceptado");
    expect(despachosRepo.actualizarItem).toHaveBeenCalledWith(
      LINEA_1,
      expect.objectContaining({ cantidad_validada: 6, estado_item: "parcial" }),
    );
  });
});
