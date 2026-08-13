/**
 * perfiles.repository.js — Rutas que tiene asignadas un usuario de la intranet.
 *
 * TABLAS AJENAS, SOLO LECTURA
 * `profiles` y `role_permissions` son el sistema de permisos de toda la
 * intranet. Este modulo las LEE para saber si alguien puede entrar, y nunca las
 * escribe: el alta de usuarios y la asignacion de rutas viven en AdminUsuarios,
 * que es el unico lugar donde deben vivir.
 *
 * LA PRECEDENCIA IMPORTA Y NO ES OBVIA
 * Se replica exactamente la logica de `pages/admin/Login.jsx`: si el perfil
 * tiene `personal_routes` con contenido, esas REEMPLAZAN a las del rol —no se
 * suman. Divergir de esa regla haria que el backend y el frontend discrepen
 * sobre quien puede entrar, que es la peor clase de bug de permisos: silencioso
 * y dificil de reproducir.
 */
import { supabaseAdmin } from "../config/supabase.js";

/**
 * @param {string} userId
 * @returns {Promise<{ nombre: string|null, role: string|null, rutas: string[] }>}
 */
export async function rutasDelUsuario(userId) {
  const { data: perfil, error } = await supabaseAdmin
    .from("profiles")
    .select("nombre, role, personal_routes")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!perfil) return { nombre: null, role: null, rutas: [] };

  const normalizar = (lista) =>
    (Array.isArray(lista) ? lista : [])
      .map((r) => (typeof r === "string" ? r : r?.path))
      .filter(Boolean);

  // Rutas personales: reemplazan, no complementan.
  const personales = normalizar(perfil.personal_routes);
  if (personales.length > 0) {
    return { nombre: perfil.nombre, role: perfil.role, rutas: personales };
  }

  if (!perfil.role) return { nombre: perfil.nombre, role: null, rutas: [] };

  let { data: config, error: errorRol } = await supabaseAdmin
    .from("role_permissions")
    .select("permissions")
    .eq("role", perfil.role)
    .maybeSingle();

  if (errorRol) throw errorRol;

  // Mismo respaldo que el login: admin_clientes hereda de admin_proveedores.
  if (!config?.permissions && perfil.role === "admin_clientes") {
    const { data: respaldo } = await supabaseAdmin
      .from("role_permissions")
      .select("permissions")
      .eq("role", "admin_proveedores")
      .maybeSingle();
    config = respaldo;
  }

  return {
    nombre: perfil.nombre,
    role: perfil.role,
    rutas: normalizar(config?.permissions),
  };
}

/**
 * Todos los perfiles de la intranet con sus rutas efectivas resueltas.
 *
 * Es la consulta INVERSA de `rutasDelUsuario`: aquella pregunta "que puede
 * hacer esta persona", esta pregunta "quienes pueden entrar". La necesita el
 * panel de Operarios para mostrar tambien a quien todavia no ha ingresado.
 *
 * DOS CONSULTAS, NO UNA POR PERSONA. Resolver la precedencia usuario por
 * usuario serian N+1 consultas contra `role_permissions`; aca se traen los
 * roles una sola vez y se resuelve en memoria.
 *
 * Se aplica la MISMA precedencia que `rutasDelUsuario`: si hay
 * `personal_routes`, reemplazan a las del rol. Divergir aca haria que el panel
 * muestre a alguien que despues recibe un 403, o al reves.
 *
 * @returns {Promise<Array<{user_id, nombre, correo, role, rutas: string[]}>>}
 */
export async function perfilesConRutas() {
  const [{ data: perfiles, error }, { data: roles, error: errorRoles }] =
    await Promise.all([
      supabaseAdmin.from("profiles").select("user_id, nombre, correo, role, personal_routes"),
      supabaseAdmin.from("role_permissions").select("role, permissions"),
    ]);

  if (error) throw error;
  if (errorRoles) throw errorRoles;

  const normalizar = (lista) =>
    (Array.isArray(lista) ? lista : [])
      .map((r) => (typeof r === "string" ? r : r?.path))
      .filter(Boolean);

  const porRol = new Map((roles || []).map((r) => [r.role, normalizar(r.permissions)]));

  // Mismo respaldo que el login: admin_clientes hereda de admin_proveedores.
  const rutasDeRol = (rol) =>
    porRol.get(rol) ??
    (rol === "admin_clientes" ? porRol.get("admin_proveedores") : null) ??
    [];

  return (perfiles || [])
    .filter((p) => p.user_id)
    .map((p) => {
      const personales = normalizar(p.personal_routes);
      return {
        user_id: p.user_id,
        nombre: p.nombre,
        correo: p.correo,
        role: p.role,
        rutas: personales.length > 0 ? personales : rutasDeRol(p.role),
      };
    });
}
