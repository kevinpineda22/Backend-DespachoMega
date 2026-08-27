/**
 * catalogo.service.js — Disparo manual de la sincronizacion de catalogo.
 *
 * EL PROBLEMA QUE RESUELVE
 * Cuando en Siesa crean un producto nuevo y lo empiezan a vender el mismo dia,
 * `despacho_mega_items` y `despacho_mega_codigos_barras` todavia no lo tienen:
 * el cron corre de madrugada. El operario escanea y el modulo no lo reconoce.
 *
 * POR QUE ESTO Y NO UNA CONSULTA PUNTUAL
 * Lo puntual seria mejor —resolver ESE codigo contra Siesa en 300 ms— pero las
 * consultas estandar no lo permiten: se probaron `f131_id` (codigo de barras),
 * `f120_referencia`, `f120_ts` y `f120_rowid` como filtros de
 * `API_v2_ItemsBarras` y Siesa los rechaza todos. Solo acepta `f120_id_cia`.
 * Sin una consulta personalizada nueva, la unica via es re-sincronizar todo.
 *
 * LO QUE ESO IMPLICA, Y HAY QUE DECIRLO EN LA UI
 * La corrida completa tarda unos 9 minutos y baja ~13.000 items y ~20.000
 * codigos. No es instantaneo y el operario no puede esperar frente al cliente:
 * el flujo real es "el admin lo dispara, el operario reintenta en un rato".
 */
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { conflicto, solicitudInvalida } from "../lib/errores.js";

const API = "https://api.github.com";

function exigirConfiguracion() {
  if (!env.github.token) {
    throw solicitudInvalida(
      "La sincronizacion manual no esta configurada: falta GITHUB_TOKEN en el backend.",
    );
  }
}

async function pedirGitHub(ruta, opciones = {}) {
  const respuesta = await fetch(`${API}${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${env.github.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opciones.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (respuesta.status === 401 || respuesta.status === 403) {
    // El mensaje nombra el permiso exacto: un 403 de GitHub a secas manda a
    // revisar el token entero en vez del scope que falta.
    throw conflicto(
      "GitHub rechazo el token. Verifique que sea de granularidad fina, " +
        "con acceso al repositorio y permiso 'Actions: read and write'.",
    );
  }
  if (respuesta.status === 404) {
    throw conflicto(
      `GitHub no encuentra el workflow ${env.github.workflow} en ${env.github.repo}. ` +
        "Un token sin acceso a ese repositorio tambien da 404.",
    );
  }

  if (respuesta.status === 204) return null;
  if (!respuesta.ok) throw conflicto(`GitHub respondio ${respuesta.status}.`);
  return respuesta.json();
}

const RUTA_RUNS = () =>
  `/repos/${env.github.repo}/actions/workflows/${env.github.workflow}/runs?per_page=1`;

/** Ultima corrida del workflow, con la forma que consume el panel. */
export async function estadoSincronizacion() {
  if (!env.github.token) {
    return { configurado: false, corriendo: false, ultima: null };
  }

  const datos = await pedirGitHub(RUTA_RUNS());
  const run = datos?.workflow_runs?.[0] ?? null;

  return {
    configurado: true,
    // `queued` cuenta como corriendo: entre el dispatch y el arranque real
    // pasan segundos, y sin esto el boton se habilitaria en esa ventana.
    corriendo: run ? ["in_progress", "queued", "requested", "waiting"].includes(run.status) : false,
    ultima: run
      ? {
          estado: run.status,
          resultado: run.conclusion,
          iniciada: run.run_started_at,
          actualizada: run.updated_at,
          url: run.html_url,
          disparada_por: run.actor?.login ?? null,
          manual: run.event === "workflow_dispatch",
        }
      : null,
  };
}

/**
 * Dispara el workflow.
 *
 * SE NIEGA SI YA HAY UNA CORRIENDO. No es una cortesia: son 9 minutos y ~33.000
 * registros contra Siesa. Dos corridas simultaneas se pisan el upsert y
 * duplican la carga para el mismo resultado. GitHub las encolaria igual.
 */
export async function sincronizarCatalogo(usuario) {
  exigirConfiguracion();

  const estado = await estadoSincronizacion();
  if (estado.corriendo) {
    throw conflicto(
      "Ya hay una sincronizacion en curso. Espere a que termine; tarda unos 9 minutos.",
      { url: estado.ultima?.url ?? null },
    );
  }

  await pedirGitHub(
    `/repos/${env.github.repo}/actions/workflows/${env.github.workflow}/dispatches`,
    { method: "POST", body: JSON.stringify({ ref: env.github.ref }) },
  );

  // Queda en el log del backend con nombre y apellido: este boton cuesta 9
  // minutos de Siesa y conviene saber quien lo aprieta y cuantas veces.
  logger.info("Sincronizacion de catalogo disparada a mano", {
    actor: usuario?.correo,
    repo: env.github.repo,
    workflow: env.github.workflow,
  });

  // GitHub responde 204 sin cuerpo y tarda en registrar la corrida, asi que no
  // se devuelve el run: el panel lo consulta aparte y ahi aparece.
  return {
    disparada: true,
    mensaje:
      "Sincronizacion iniciada. Tarda unos 9 minutos; el producto nuevo se " +
      "podra escanear cuando termine.",
  };
}
