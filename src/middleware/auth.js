/**
 * auth.js — Autenticacion y autorizacion.
 *
 * DECISION CONSCIENTE, DISTINTA A OTROS MODULOS
 * Traslados y ecommerce no validan quien llama. Aca NO alcanza: este modulo
 * firma quien despacho cada factura y quien reporto cada faltante. Si el backend
 * aceptara el `operario_id` que le mande el cliente, esa firma no valdria como
 * evidencia. La identidad SIEMPRE sale del JWT verificado.
 *
 * UNA SOLA FUENTE DE VERDAD PARA EL ACCESO
 * Quien puede entrar lo decide **la ruta asignada en AdminUsuarios**
 * (`profiles.personal_routes` o `role_permissions`), igual que para el resto de
 * la intranet. Este modulo NO da de alta usuarios ni administra permisos de
 * entrada: si tuviera su propia lista, habria dos lugares donde habilitar a
 * alguien y tarde o temprano dirian cosas distintas.
 *
 * La fila en `despacho_mega_operarios` se crea SOLA la primera vez que la
 * persona entra, y el rol del modulo se deriva de la ruta que tiene:
 *
 *     /despacho-mega/admin     -> admin del modulo
 *     /despacho-mega/operario  -> operario
 *     ninguna de las dos       -> 403
 *
 * La fila existe porque los despachos, escaneos y alertas la referencian, y
 * porque guarda lo unico que este modulo si administra: `modo_habilitado`
 * (picking / auditoria / ambos) y `activo`.
 */
import { supabaseAdmin, verificarToken } from "../config/supabase.js";
import { rutasDelUsuario } from "../repositories/perfiles.repository.js";
import { noAutorizado, prohibido } from "../lib/errores.js";
import { logger } from "../lib/logger.js";

const TABLA_OPERARIOS = "despacho_mega_operarios";

export const RUTA_ADMIN = "/despacho-mega/admin";
export const RUTA_OPERARIO = "/despacho-mega/operario";

// Cache de rutas por usuario. Resolver el acceso cuesta dos consultas
// (`profiles` + `role_permissions`) y un operario con lector dispara decenas de
// requests por minuto: sin esto, cada escaneo pagaria ese peaje.
//
// 5 minutos es el techo de cuanto puede tardar en verse un cambio de permisos.
// Para un permiso que se toca una vez por empleado, esperar unos minutos es
// aceptable; hacer lento el escaneo no lo es.
const TTL_RUTAS_MS = 5 * 60 * 1000;
const cacheRutas = new Map();

async function rutasConCache(userId) {
  const ahora = Date.now();
  const guardado = cacheRutas.get(userId);
  if (guardado && ahora - guardado.ts < TTL_RUTAS_MS) return guardado.datos;

  const datos = await rutasDelUsuario(userId);
  cacheRutas.set(userId, { datos, ts: ahora });
  return datos;
}

/** Para el panel de administracion, que necesita ver el efecto al instante. */
export function limpiarCacheRutas(userId) {
  if (userId) cacheRutas.delete(userId);
  else cacheRutas.clear();
}

/**
 * Rol dentro del modulo segun las rutas asignadas.
 *
 * El `startsWith` replica a `RutaProtegida.jsx`: una ruta concedida cubre todo
 * lo que cuelga de ella, asi que `/despacho-mega` habilita las dos vistas.
 *
 * @returns {'admin'|'operario'|null}
 */
export function rolSegunRutas(rutas = []) {
  const cubre = (destino) => rutas.some((r) => destino.startsWith(r));
  if (cubre(RUTA_ADMIN)) return "admin";
  if (cubre(RUTA_OPERARIO)) return "operario";
  return null;
}

function extraerToken(req) {
  const cabecera = req.headers.authorization || "";
  if (!cabecera.toLowerCase().startsWith("bearer ")) return null;
  return cabecera.slice(7).trim() || null;
}

/**
 * Da de alta al usuario en el modulo, o corrige su rol si le cambiaron la ruta.
 *
 * @returns {Promise<object>} la fila de `despacho_mega_operarios`
 */
async function sincronizarOperario({ user, perfil, rolDerivado, existente }) {
  const correo = (user.email || "").toLowerCase();

  if (!existente) {
    const { data, error } = await supabaseAdmin
      .from(TABLA_OPERARIOS)
      .insert({
        user_id: user.id,
        correo,
        nombre: perfil.nombre || correo,
        rol: rolDerivado,
        // Alta permisiva a proposito: quien ya tiene la ruta puede trabajar
        // desde el primer minuto. Restringir a un solo proceso es una decision
        // fina que se toma despues, desde el panel, no una barrera de entrada.
        modo_habilitado: "ambos",
        activo: true,
      })
      .select("id, user_id, correo, nombre, rol, modo_habilitado, sede, activo")
      .single();

    if (error) throw error;

    logger.info("Operario dado de alta automaticamente", { correo, rol: rolDerivado });
    return data;
  }

  // La ruta manda: si en AdminUsuarios lo pasaron de operario a admin (o al
  // reves), el modulo se entera solo. Sin esto habria que acordarse de tocar
  // dos lugares, que es exactamente lo que este diseño evita.
  if (existente.rol !== rolDerivado) {
    const { data, error } = await supabaseAdmin
      .from(TABLA_OPERARIOS)
      .update({ rol: rolDerivado })
      .eq("id", existente.id)
      .select("id, user_id, correo, nombre, rol, modo_habilitado, sede, activo")
      .single();

    if (error) throw error;

    logger.info("Rol del modulo actualizado desde las rutas", {
      correo: existente.correo,
      antes: existente.rol,
      ahora: rolDerivado,
    });
    return data;
  }

  return existente;
}

/**
 * Exige sesion valida y acceso al modulo. Deja la identidad en `req.usuario`.
 */
export async function requireAuth(req, _res, next) {
  try {
    const token = extraerToken(req);
    const user = await verificarToken(token);

    if (!user) throw noAutorizado("Sesion no valida o expirada.");

    const perfil = await rutasConCache(user.id);
    const rolDerivado = rolSegunRutas(perfil.rutas);

    if (!rolDerivado) {
      throw prohibido(
        "Su usuario no tiene asignada ninguna ruta de Despacho Mega. " +
          "Pidale al administrador que se la habilite desde Administracion de Usuarios.",
      );
    }

    const { data: existente, error } = await supabaseAdmin
      .from(TABLA_OPERARIOS)
      .select("id, user_id, correo, nombre, rol, modo_habilitado, sede, activo")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;

    // La desactivacion explicita gana sobre la ruta: es la forma de sacar a
    // alguien del modulo sin tocarle los permisos del resto de la intranet.
    if (existente && !existente.activo) {
      throw prohibido("Su usuario esta desactivado en Despacho Mega.");
    }

    const operario = await sincronizarOperario({
      user,
      perfil,
      rolDerivado,
      existente,
    });

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
