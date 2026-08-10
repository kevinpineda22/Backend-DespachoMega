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

export const actualizarAlertaBody = z.object({
  estado: z.enum(["abierta", "en_gestion", "resuelta", "descartada"]),
  respuesta: z.string().trim().max(500).optional(),
});

export const aprobarBody = z.object({
  // Sin `item_id` la decision aplica al despacho completo.
  item_id: uuid.optional(),
  decision: z.enum(["aprobado", "rechazado"]),
  observacion: z.string().trim().max(500).optional(),
});

export const crearOperarioBody = z.object({
  correo: z.string().trim().toLowerCase().email("Correo invalido."),
  nombre: z.string().trim().min(3, "El nombre es obligatorio."),
  documento: z.string().trim().max(30).optional(),
  password: z
    .string()
    .min(10, "La contraseña temporal debe tener al menos 10 caracteres."),
  rol: z.enum(["operario", "admin"]).default("operario"),
  modo_habilitado: z.enum(["picking", "auditoria", "ambos"]).default("ambos"),
  sede: z.string().trim().max(80).optional(),
});

export const actualizarOperarioBody = z
  .object({
    nombre: z.string().trim().min(3).optional(),
    documento: z.string().trim().max(30).optional(),
    rol: z.enum(["operario", "admin"]).optional(),
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
