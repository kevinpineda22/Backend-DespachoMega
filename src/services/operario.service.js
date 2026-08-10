/**
 * operario.service.js — Alta y mantenimiento de despachadores.
 *
 * QUE SIGNIFICA "CREAR UN DESPACHADOR"
 * Dos cosas a la vez, y por eso vive en el backend y no en el frontend:
 *
 *   1. Un usuario en Supabase Auth, para que pueda iniciar sesion. Crearlo
 *      requiere `service_role`, una clave que NO puede estar en el bundle del
 *      navegador (cualquiera la leeria y tendria la base entera).
 *   2. Una fila en `despacho_mega_operarios`, que define su rol y su proceso.
 *
 * SIN TRANSACCION
 * Auth y la tabla son dos sistemas: no hay un COMMIT que los cubra. Si el
 * segundo paso falla, se borra el usuario recien creado para no dejar cuentas
 * huerfanas que puedan loguearse sin estar habilitadas en ningun modulo.
 */
import { supabaseAdmin } from "../config/supabase.js";
import * as operariosRepo from "../repositories/operarios.repository.js";
import * as eventosRepo from "../repositories/eventos.repository.js";
import { EVENTO } from "../repositories/eventos.repository.js";
import { conflicto, noEncontrado } from "../lib/errores.js";
import { logger } from "../lib/logger.js";

export async function listar({ soloActivos } = {}) {
  return operariosRepo.listar({ soloActivos });
}

export async function crear(datos, usuario) {
  const existente = await operariosRepo.porCorreo(datos.correo);
  if (existente) {
    throw conflicto(`El correo ${datos.correo} ya esta registrado en Despacho Mega.`);
  }

  const { data: creado, error } = await supabaseAdmin.auth.admin.createUser({
    email: datos.correo,
    password: datos.password,
    email_confirm: true, // Es personal interno: no hay buzon que confirmar.
    user_metadata: { nombre: datos.nombre, modulo: "despacho_mega" },
  });

  if (error) {
    // Puede existir en Auth por otro modulo de la intranet. En ese caso no se
    // crea: se habilita el usuario que ya esta.
    if (/already|exists|registered/i.test(error.message)) {
      throw conflicto(
        `El correo ${datos.correo} ya tiene cuenta en la intranet. ` +
          "Habilitelo desde la opcion de vincular usuario existente.",
      );
    }
    throw error;
  }

  try {
    const operario = await operariosRepo.crear({
      user_id: creado.user.id,
      correo: datos.correo,
      nombre: datos.nombre,
      documento: datos.documento ?? null,
      rol: datos.rol,
      modo_habilitado: datos.modo_habilitado,
      sede: datos.sede ?? null,
      activo: true,
      creado_por: usuario.userId,
    });

    await eventosRepo.registrar({
      actorUserId: usuario.userId,
      actorCorreo: usuario.correo,
      evento: EVENTO.OPERARIO_CREADO,
      payload: { correo: datos.correo, rol: datos.rol, modo: datos.modo_habilitado },
    });

    return operario;
  } catch (errorTabla) {
    await supabaseAdmin.auth.admin.deleteUser(creado.user.id).catch((e) => {
      logger.error("Usuario huerfano en Auth: no se pudo revertir", {
        userId: creado.user.id,
        correo: datos.correo,
        error: e.message,
      });
    });
    throw errorTabla;
  }
}

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
