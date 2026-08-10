/**
 * despachoMega.schema.js — Contratos de entrada de la API.
 *
 * Fijate en lo que NO esta: ningun esquema acepta `operario_id`, `usuario` ni
 * `correo`. La identidad la pone `requireAuth` desde el JWT. Aceptarla por el
 * cuerpo seria dejar que cualquiera firme historial a nombre de otro.
 */
import { z } from "zod";

const uuid = z.string().uuid("Identificador invalido.");

// Siesa maneja el consecutivo como texto (puede traer prefijo de tipo).
// Se limpia de espacios y se acota para que no entre basura al log ni a la URL.
export const numeroFactura = z
  .string()
  .trim()
  .min(1, "El numero de factura es obligatorio.")
  .max(40, "Numero de factura demasiado largo.");

export const modo = z.enum(["picking", "auditoria"]);

export const paramsId = z.object({ id: uuid });

// `tipo_documento` solo hace falta para desempatar: en Siesa conviven varias
// series (P02, P05, P08, PN5) con consecutivos independientes, asi que un
// numero puede, en principio, apuntar a mas de un documento. El backend pide
// este campo solo cuando detecta la colision.
export const tipoDocumento = z.string().trim().max(10);

export const abrirDespachoBody = z.object({
  numero_factura: numeroFactura,
  modo,
  tipo_documento: tipoDocumento.optional(),
});

export const validarItemBody = z.object({
  codigo: z.string().trim().min(1, "Debe ingresar o escanear un codigo."),
  metodo: z.enum(["escaner", "manual"]).default("escaner"),
  // El operario puede validar de a varias unidades (caja de 12) en vez de
  // escanear doce veces.
  cantidad: z.coerce.number().positive("La cantidad debe ser mayor a cero.").default(1),
});

export const finalizarDespachoBody = z.object({
  observaciones: z.string().trim().max(1000).optional(),
});

export const crearAlertaBody = z.object({
  despacho_id: uuid,
  item_id: uuid.optional(),
  codigo_item: z.string().trim().min(1),
  cantidad_faltante: z.coerce.number().positive(),
  motivo: z.enum([
    "sin_fisico",
    "averiado",
    "ubicacion_errada",
    "diferencia_cantidad",
    "otro",
  ]),
  comentario: z.string().trim().max(500).optional(),
});

export const estadoAlerta = z.enum([
  "abierta",
  "en_gestion",
  "resuelta",
  "descartada",
]);

export const motivoAlerta = z.enum([
  "sin_fisico",
  "averiado",
  "ubicacion_errada",
  "diferencia_cantidad",
  "otro",
]);

// La respuesta sigue siendo opcional en el contrato porque `en_gestion` no la
// necesita. Que sea obligatoria al CERRAR es una regla de negocio y vive en
// `alerta.service.js`: el esquema no puede saber si la alerta ya traia una
// respuesta escrita en un paso anterior.
export const actualizarAlertaBody = z.object({
  estado: estadoAlerta,
  respuesta: z.string().trim().max(500).optional(),
});

export const bandejaNovedadesQuery = z.object({
  estado: estadoAlerta.optional(),
  motivo: motivoAlerta.optional(),
  modo: modo.optional(),
  desde: z.string().date().optional(),
  hasta: z.string().date().optional(),
  limite: z.coerce.number().int().min(1).max(500).default(100),
});

export const aprobarBody = z.object({
  // Sin `item_id` la decision aplica al despacho completo.
  item_id: uuid.optional(),
  decision: z.enum(["aprobado", "rechazado"]),
  observacion: z.string().trim().max(500).optional(),
});

export const actualizarOperarioBody = z
  .object({
    nombre: z.string().trim().min(3).optional(),
    documento: z.string().trim().max(30).optional(),
    modo_habilitado: z.enum(["picking", "auditoria", "ambos"]).optional(),
    sede: z.string().trim().max(80).optional(),
    activo: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Debe enviar al menos un campo a actualizar.",
  });

export const rangoFechasQuery = z.object({
  desde: z.string().date().optional(),
  hasta: z.string().date().optional(),
  operario_id: uuid.optional(),
  modo: modo.optional(),
  limite: z.coerce.number().int().min(1).max(500).default(100),
});

export const listarAlertasQuery = z.object({
  estado: z.enum(["abierta", "en_gestion", "resuelta", "descartada"]).optional(),
  despacho_id: uuid.optional(),
  desde: z.string().date().optional(),
  hasta: z.string().date().optional(),
  limite: z.coerce.number().int().min(1).max(500).default(100),
});

// Un query string no tiene booleanos: todo llega como texto. `z.coerce.boolean()`
// NO sirve aca — sigue las reglas de JavaScript y convierte "false" en `true`,
// porque cualquier string no vacio es truthy. Un filtro que se activa cuando el
// frontend manda `false` es un bug silencioso, asi que se compara el texto.
const booleanoQuery = z
  .enum(["true", "false"])
  .transform((v) => v === "true")
  .optional();

export const etapaFactura = z.enum([
  "alistando",
  "alistada",
  "auditando",
  "auditada",
  "aprobada",
  "rechazada",
]);

export const paramsNumeroFactura = z.object({ numero: numeroFactura });

export const listarFacturasQuery = z.object({
  etapa: etapaFactura.optional(),
  operario_id: uuid.optional(),
  // Busca por numero de factura o por nombre de cliente: el supervisor a veces
  // recuerda al cliente y no el consecutivo.
  texto: z.string().trim().max(80).optional(),
  sede: z.string().trim().max(80).optional(),
  desde: z.string().date().optional(),
  hasta: z.string().date().optional(),
  con_novedades: booleanoQuery,
  con_diferencia: booleanoQuery,
  // Minutos sin movimiento para considerar una factura estancada. Sin valor por
  // defecto a proposito: el filtro se activa solo si el panel lo pide.
  estancadas_minutos: z.coerce.number().int().min(1).max(10080).optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const historialQuery = z.object({
  limite: z.coerce.number().int().min(1).max(500).default(200),
});

export const listarDespachosQuery = z.object({
  estado: z
    .enum([
      "en_proceso",
      "con_novedad",
      "completado",
      "aprobado",
      "rechazado",
      "cancelado",
    ])
    .optional(),
  modo: modo.optional(),
  operario_id: uuid.optional(),
  numero_factura: z.string().trim().max(40).optional(),
  desde: z.string().date().optional(),
  hasta: z.string().date().optional(),
  limite: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
