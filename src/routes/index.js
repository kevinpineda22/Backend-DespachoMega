/**
 * routes/index.js — Mapa completo de la API.
 *
 * Un solo archivo con todas las rutas: el modulo es chico y tenerlas juntas
 * hace evidente de un vistazo que endpoint pide `requireAdmin` y cual no.
 * Ese es exactamente el tipo de error que no se quiere descubrir en produccion.
 */
import { Router } from "express";

import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";

import * as despachos from "../controllers/despachos.controller.js";
import * as facturas from "../controllers/facturas.controller.js";
import * as alertas from "../controllers/alertas.controller.js";
import * as operarios from "../controllers/operarios.controller.js";
import * as analitica from "../controllers/analitica.controller.js";

import { z } from "zod";
import {
  abrirDespachoBody,
  actualizarAlertaBody,
  actualizarOperarioBody,
  aprobarBody,
  bandejaNovedadesQuery,
  crearAlertaBody,
  finalizarDespachoBody,
  historialQuery,
  listarAlertasQuery,
  listarDespachosQuery,
  listarFacturasQuery,
  numeroFactura,
  paramsId,
  paramsNumeroFactura,
  rangoFechasQuery,
  tipoDocumento,
  validarItemBody,
} from "../schemas/despachoMega.schema.js";

const router = Router();

// ---------------------------------------------------------------------------
// Salud — publica. La usa el monitoreo de Vercel y el frontend para avisar
// "backend caido" antes de que el operario teclee una factura.
// ---------------------------------------------------------------------------
router.get("/health", (_req, res) => {
  res.json({ ok: true, servicio: "despacho-mega", ts: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// De aca en adelante, todo exige sesion valida y registro activo en el modulo.
// ---------------------------------------------------------------------------
router.use(requireAuth);

router.get("/yo", operarios.yo);

// --- Facturas -------------------------------------------------------------
router.get(
  "/facturas/:numero",
  validate({
    params: z.object({ numero: numeroFactura }),
    // El `t` de cache-busting que agrega el cliente no se declara: Zod
    // descarta las claves desconocidas en vez de rechazarlas.
    query: z.object({ tipo_documento: tipoDocumento.optional() }),
  }),
  despachos.previsualizarFactura,
);

// --- Despachos ------------------------------------------------------------
router.post(
  "/despachos",
  validate({ body: abrirDespachoBody }),
  despachos.abrir,
);

router.get(
  "/despachos",
  validate({ query: listarDespachosQuery }),
  despachos.listar,
);

router.get("/despachos/:id", validate({ params: paramsId }), despachos.obtener);

router.post(
  "/despachos/:id/validar",
  validate({ params: paramsId, body: validarItemBody }),
  despachos.validar,
);

router.post(
  "/despachos/:id/finalizar",
  validate({ params: paramsId, body: finalizarDespachoBody }),
  despachos.finalizar,
);

router.post(
  "/despachos/:id/cancelar",
  validate({ params: paramsId }),
  despachos.cancelar,
);

router.post(
  "/despachos/:id/aprobar",
  requireAdmin,
  validate({ params: paramsId, body: aprobarBody }),
  despachos.aprobar,
);

// Bitacora del despacho. Sin `requireAdmin`: el servicio aplica la misma regla
// que el resto —un operario ve lo suyo, el admin ve todo— y duplicarla aca
// abriria la puerta a que un dia digan cosas distintas.
router.get(
  "/despachos/:id/eventos",
  validate({ params: paramsId }),
  despachos.eventos,
);

// --- Panel de facturas (solo admin) ---------------------------------------
//
// OJO: `/facturas/:numero` (mas arriba) consulta la factura en SIESA. Esto
// consulta lo que paso con ella EN EL MODULO — de ahi el prefijo `/panel`, que
// evita que dos preguntas distintas compartan la misma ruta.
router.get(
  "/panel/facturas",
  requireAdmin,
  validate({ query: listarFacturasQuery }),
  facturas.listar,
);

router.get(
  "/panel/facturas/:numero",
  requireAdmin,
  validate({ params: paramsNumeroFactura }),
  facturas.detalle,
);

// --- Alertas de inventario ------------------------------------------------
router.post("/alertas", validate({ body: crearAlertaBody }), alertas.crear);
router.get("/alertas", validate({ query: listarAlertasQuery }), alertas.listar);

// Bandeja del admin: la misma informacion pero con antiguedad, etapa de
// deteccion y quien la atendio. Va aparte de `GET /alertas` porque esa la usa
// tambien el operario, y cargarla con todo eso seria peso que no necesita.
router.get(
  "/panel/novedades",
  requireAdmin,
  validate({ query: bandejaNovedadesQuery }),
  alertas.bandeja,
);

router.patch(
  "/alertas/:id",
  requireAdmin,
  validate({ params: paramsId, body: actualizarAlertaBody }),
  alertas.actualizar,
);

// --- Operarios (solo admin) -----------------------------------------------
//
// No hay POST: el alta de usuarios vive en AdminUsuarios, y quien tiene la ruta
// asignada queda registrado solo al entrar. Ver `middleware/auth.js`.
router.get("/operarios", requireAdmin, operarios.listar);

router.patch(
  "/operarios/:id",
  requireAdmin,
  validate({ params: paramsId, body: actualizarOperarioBody }),
  operarios.actualizar,
);

// "¿Que hizo Fulano hoy?" respondido de corrido, sin cruzar cinco tablas.
router.get(
  "/operarios/:id/actividad",
  requireAdmin,
  validate({ params: paramsId, query: historialQuery }),
  operarios.actividad,
);

// --- Analitica (solo admin) -----------------------------------------------
router.get(
  "/analitica/tablero",
  requireAdmin,
  validate({ query: rangoFechasQuery }),
  analitica.tablero,
);
router.get("/analitica/resumen", requireAdmin, validate({ query: rangoFechasQuery }), analitica.resumen);
router.get("/analitica/por-operario", requireAdmin, validate({ query: rangoFechasQuery }), analitica.porOperario);
router.get("/analitica/productos-top", requireAdmin, validate({ query: rangoFechasQuery }), analitica.productosTop);
router.get("/analitica/picos-trabajo", requireAdmin, validate({ query: rangoFechasQuery }), analitica.picosTrabajo);
router.get("/analitica/novedades", requireAdmin, validate({ query: rangoFechasQuery }), analitica.novedades);
router.get("/analitica/calidad-escaneo", requireAdmin, validate({ query: rangoFechasQuery }), analitica.calidadEscaneo);

export default router;
