/**
 * supabase.js — Cliente de Supabase.
 *
 * `SUPABASE_SERVICE_KEY` (service_role) ignora RLS y puede crear usuarios. Si
 * esta clave se filtra, se filtra la base entera: vive solo en este backend y
 * en las variables de entorno de Vercel, nunca en el frontend.
 *
 * POR QUE NO HAY CLIENTE `anon`
 * Verificar un token no necesita la anon key. `auth.getUser(jwt)` manda el JWT
 * del usuario en `Authorization` y GoTrue lo valida contra su firma; la clave
 * del cliente solo viaja como `apikey`. Mantener una anon key aparte sumaba una
 * variable de entorno mas para no ganar nada.
 */
import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

export const supabaseAdmin = createClient(
  env.supabase.url,
  env.supabase.serviceKey,
  {
    // Sin sesion persistida ni refresco: cada request trae su propio token y el
    // cliente no debe arrastrar estado entre invocaciones serverless.
    auth: { autoRefreshToken: false, persistSession: false },
  },
);

/**
 * Resuelve el usuario dueño de un access token de Supabase.
 *
 * Devuelve `null` ante cualquier problema — token ausente, vencido, mal
 * firmado, o de un usuario borrado. Quien llama decide el 401; aca no se
 * distingue el motivo a proposito, porque decirle a un atacante si el token
 * "existe pero vencio" o "no existe" es informacion gratis.
 *
 * @param {string} accessToken JWT que envia el frontend en Authorization.
 * @returns {Promise<import('@supabase/supabase-js').User|null>}
 */
export async function verificarToken(accessToken) {
  if (!accessToken) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);

  // `id` explicito: la service_role key tambien es un JWT valido, pero no
  // pertenece a ningun usuario. Sin este chequeo, alguien que la tuviera
  // podria pasarla como token de sesion.
  if (error || !data?.user?.id) return null;

  return data.user;
}
