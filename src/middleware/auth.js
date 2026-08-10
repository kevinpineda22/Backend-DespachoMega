/**
 * auth.js — Autenticacion y autorizacion reales.
 *
 * DECISION CONSCIENTE, DISTINTA A OTROS MODULOS
 * Traslados y ecommerce no validan quien llama: sus endpoints viven detras de
 * la sesion del frontend y confian en eso. Aca NO alcanza. Este modulo firma
 * quien despacho cada factura y quien reporto cada faltante; si el backend
 * aceptara el `operario_id` que le mande el cliente, esa firma no valdria nada
 * — cualquiera podria escribir historial a nombre de otro.
 *
 * Por eso la identidad SIEMPRE sale del JWT verificado contra Supabase Auth,
 * nunca del cuerpo del request.
 *
 * ARRANQUE EN FRIO
 * `requireAdmin` exige una fila con `rol = 'admin'` en `despacho_mega_operarios`.
 * El primer admin no lo puede crear la app: hay que insertarlo a mano una vez.
 * Ver docs/PENDIENTES.md.
 */
import { supabaseAdmin, verificarToken } from "../config/supabase.js";
import { noAutorizado, prohibido } from "../lib/errores.js";

const TABLA_OPERARIOS = "despacho_mega_operarios";

function extraerToken(req) {
  const cabecera = req.headers.authorization || "";
  if (!cabecera.toLowerCase().startsWith("bearer ")) return null;
  return cabecera.slice(7).trim() || null;
}

/**
 * Exige sesion valida y registro activo en el modulo.
 * Deja en `req.usuario` la identidad ya verificada.
 */
export async function requireAuth(req, _res, next) {
  try {
    const token = extraerToken(req);
    const user = await verificarToken(token);

    if (!user) throw noAutorizado("Sesion no valida o expirada.");

    const { data: operario, error } = await supabaseAdmin
      .from(TABLA_OPERARIOS)
      .select("id, user_id, correo, nombre, rol, modo_habilitado, sede, activo")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;

    if (!operario) {
      throw prohibido("El usuario no esta habilitado en Despacho Mega.");
    }

    if (!operario.activo) {
      throw prohibido("El usuario esta inactivo en Despacho Mega.");
    }

    req.usuario = {
      userId: user.id,
      correo: operario.correo,
      operarioId: operario.id,
      nombre: operario.nombre,
      rol: operario.rol,
      modoHabilitado: operario.modo_habilitado,
      sede: operario.sede,
    };

    next();
  } catch (error) {
    next(error);
  }
}

/** Exige rol admin dentro del modulo. Usar SIEMPRE despues de requireAuth. */
export function requireAdmin(req, _res, next) {
  if (req.usuario?.rol !== "admin") {
    return next(prohibido("Esta accion es exclusiva del administrador."));
  }
  next();
}

/**
 * Exige que el operario tenga habilitado el proceso que intenta ejecutar.
 * @param {'picking'|'auditoria'} modo
 */
export function requireModo(modo) {
  return (req, _res, next) => {
    const habilitado = req.usuario?.modoHabilitado;

    // El admin no queda encerrado por `modo_habilitado`: necesita poder entrar
    // a cualquier proceso para reproducir un problema que le reporten.
    if (req.usuario?.rol === "admin") return next();

    if (habilitado !== "ambos" && habilitado !== modo) {
      return next(prohibido(`El usuario no tiene habilitado el modo ${modo}.`));
    }
    next();
  };
}
