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
