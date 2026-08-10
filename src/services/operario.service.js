/**
 * operario.service.js — Ajuste fino de quien ya tiene acceso.
 *
 * ESTE MODULO NO CREA USUARIOS, Y ES DELIBERADO
 * El alta de personas y la asignacion de rutas viven en **AdminUsuarios**. Si
 * Despacho Mega tuviera su propio formulario de creacion habria dos lugares
 * donde habilitar a alguien, y tarde o temprano dirian cosas distintas: alguien
 * con cuenta pero sin ruta, o con ruta pero sin cuenta en el modulo.
 *
 * Quien tiene la ruta asignada queda dado de alta solo la primera vez que
 * entra (ver `middleware/auth.js`), con `modo_habilitado = 'ambos'`.
 *
 * Lo que si administra este servicio es lo unico que el sistema de rutas no
 * puede expresar:
 *
 *   modo_habilitado -> si esa persona hace picking, auditoria o ambos
 *   activo          -> sacarla del modulo sin tocarle el resto de la intranet
 *
 * El `rol` NO se edita aca: se deriva de la ruta en cada request. Ponerlo a
 * mano duraria hasta el proximo ingreso.
 */
import * as operariosRepo from "../repositories/operarios.repository.js";
import * as eventosRepo from "../repositories/eventos.repository.js";
import { EVENTO } from "../repositories/eventos.repository.js";
import { noEncontrado } from "../lib/errores.js";

export async function listar({ soloActivos } = {}) {
  return operariosRepo.listar({ soloActivos });
}

/**
 * @param {string} id
 * @param {{ modo_habilitado?: string, activo?: boolean, sede?: string, documento?: string }} cambios
 */
export async function actualizar(id, cambios, usuario) {
  const existente = await operariosRepo.porId(id);
  if (!existente) throw noEncontrado("Operario no encontrado.");

  const operario = await operariosRepo.actualizar(id, cambios);

  await eventosRepo.registrar({
    actorUserId: usuario.userId,
    actorCorreo: usuario.correo,
    evento: EVENTO.OPERARIO_ACTUALIZADO,
    payload: { operario_id: id, cambios },
  });

  return operario;
}
