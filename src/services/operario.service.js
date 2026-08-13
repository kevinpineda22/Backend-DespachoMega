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
import { perfilesConRutas } from "../repositories/perfiles.repository.js";
import { rolSegunRutas } from "../middleware/auth.js";
import { noEncontrado, solicitudInvalida } from "../lib/errores.js";

/**
 * Lista a TODOS los que pueden entrar al modulo, hayan entrado o no.
 *
 * POR QUE NO ALCANZA CON LEER `despacho_mega_operarios`
 * Esa tabla se llena en el primer ingreso. Mientras tanto, alguien con la ruta
 * recien asignada no aparecia en ningun lado, y el admin no podia dejarle
 * configurado "Solo auditoria" antes de que empezara a trabajar: tenia que
 * esperar a que la persona entrara —con los dos procesos habilitados— para
 * recien ahi restringirla. Preparar despues de que la persona ya trabajo es
 * exactamente al reves de como se usa esto.
 *
 * La solucion NO es que AdminUsuarios escriba en esta tabla: eso serian dos
 * lugares donde se habilita a alguien. Es que el listado se ARME desde las
 * rutas, que ya son la fuente de verdad, y se enriquezca con la fila del
 * modulo cuando existe.
 *
 * Los pendientes vienen con `id: null` y `pendiente_ingreso: true`, y con los
 * valores que VAN a recibir al entrar, no con blancos: lo que el panel muestra
 * es lo que va a pasar.
 */
export async function listar({ soloActivos } = {}) {
  const [registrados, perfiles] = await Promise.all([
    operariosRepo.listar({ soloActivos }),
    perfilesConRutas(),
  ]);

  const porUsuario = new Map(registrados.map((o) => [o.user_id, o]));

  const pendientes = perfiles
    .filter((p) => !porUsuario.has(p.user_id))
    .map((p) => ({ perfil: p, rol: rolSegunRutas(p.rutas) }))
    .filter(({ rol }) => rol !== null)
    .map(({ perfil, rol }) => ({
      id: null,
      user_id: perfil.user_id,
      correo: (perfil.correo || "").toLowerCase(),
      nombre: perfil.nombre || perfil.correo,
      documento: null,
      rol,
      // Los mismos valores del alta automatica en `sincronizarOperario`.
      modo_habilitado: "ambos",
      sede: null,
      activo: true,
      creado_por: null,
      created_at: null,
      updated_at: null,
      pendiente_ingreso: true,
    }));

  return [...registrados.map((o) => ({ ...o, pendiente_ingreso: false })), ...pendientes].sort(
    (a, b) => (a.nombre || "").localeCompare(b.nombre || ""),
  );
}

/**
 * Configura a alguien que todavia no ha entrado al modulo.
 *
 * Crea la fila AHORA con los ajustes pedidos, en vez de esperar al primer
 * ingreso. El rol NO se toma del cliente: se deriva de la ruta, igual que en
 * `requireAuth`. Si el panel pudiera mandarlo, habria una via para volverse
 * admin del modulo sin tener la ruta.
 */
export async function provisionar(userId, cambios, usuario) {
  const yaExiste = await operariosRepo.porUserId(userId);
  if (yaExiste) {
    // Entro entre que el admin cargo la lista y toco el desplegable.
    return actualizar(yaExiste.id, cambios, usuario);
  }

  const perfiles = await perfilesConRutas();
  const perfil = perfiles.find((p) => p.user_id === userId);
  if (!perfil) throw noEncontrado("El usuario no existe en la intranet.");

  const rol = rolSegunRutas(perfil.rutas);
  if (!rol) {
    throw solicitudInvalida(
      "Ese usuario no tiene asignada ninguna ruta de Despacho Mega. " +
        "Asignesela primero en Administracion de Usuarios.",
    );
  }

  const operario = await operariosRepo.crear({
    user_id: perfil.user_id,
    correo: (perfil.correo || "").toLowerCase(),
    nombre: perfil.nombre || perfil.correo,
    rol,
    modo_habilitado: cambios.modo_habilitado ?? "ambos",
    activo: cambios.activo ?? true,
    sede: cambios.sede ?? null,
    creado_por: usuario.correo,
  });

  await eventosRepo.registrar({
    actorUserId: usuario.userId,
    actorCorreo: usuario.correo,
    evento: EVENTO.OPERARIO_ACTUALIZADO,
    payload: {
      operario_id: operario.id,
      cambios,
      provisionado_antes_del_primer_ingreso: true,
    },
  });

  return { ...operario, pendiente_ingreso: false };
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

/**
 * Que hizo una persona, de corrido.
 *
 * La bitacora se indexa por `actor_correo` y no por `operario_id`, porque
 * registra al ACTOR —que puede ser un admin actuando sobre el despacho de otro—
 * y no al dueño del despacho. Por eso hay que resolver el correo primero.
 */
export async function actividad(id, { limite } = {}) {
  const operario = await operariosRepo.porId(id);
  if (!operario) throw noEncontrado("Operario no encontrado.");

  const eventos = await eventosRepo.historialPorCorreo(operario.correo, limite);

  return { operario, eventos };
}
