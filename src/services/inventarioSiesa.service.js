/**
 * inventarioSiesa.service.js — Existencias en vivo de un item en una bodega.
 *
 * DE DONDE SALE ESTE DISEÑO
 * Es el mismo mecanismo que usa el panel de despachador de Traslados
 * (`Backend-traslados/src/services/siesaStock.service.js`). No se reinventa: es
 * codigo probado contra el mismo Siesa. Las diferencias son dos y ninguna es de
 * forma:
 *
 *   1. COMPAÑIA 2. Traslados filtra `f120_id_cia === 1` (Merkahorro). Aca es
 *      Megamayoristas. La consulta devuelve las dos: verificado sobre el item
 *      40117, que trae filas de cia 1 y de cia 2 en la misma respuesta.
 *
 *   2. LA BODEGA NO LA ELIGE EL CLIENTE. En Traslados viaja como parametro. Aca
 *      sale del despacho, que la heredo de la factura de Siesa. Un operario no
 *      tiene por que poder preguntar por una bodega ajena.
 *
 * POR QUE ITEM POR ITEM Y NO LA BODEGA ENTERA
 * Se probo `parametros=f150_id=MG001` y `f120_id_cia=2|f150_id=MG001`: las dos
 * devuelven UNA fila. La consulta estandar solo acepta la clave por item, asi
 * que no hay forma de traerse la bodega completa de un saque. Cada item cuesta
 * ~310 ms, y por eso existen el pool y el cache de abajo.
 */
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

const CONSULTA = "API_v2_Inventarios_InvFecha";
const CIA_MEGA = 2;

// 60 s, igual que Traslados. Es "en vivo" de verdad para quien alista —nadie
// mueve 4.000 unidades en un minuto— sin martillar Siesa cuando cinco operarios
// abren la misma factura.
const TTL_MS = 60_000;

// 8 en paralelo. Mas alto no acelera: Siesa empieza a responder 429 y el
// reintento con espera termina tardando mas que haber ido mas despacio.
const CONCURRENCIA = 8;

// PRESUPUESTO TOTAL, MEDIDO CONTRA EL LIMITE DE VERCEL.
//
// En Vercel una funcion serverless se corta a los 10 s por defecto (no hay
// `maxDuration` en vercel.json). El timeout por item estaba en 20 s: si Siesa
// se colgaba con UN item, Vercel mataba la funcion antes y el operario recibia
// un error de gateway en vez de las tarjetas sin inventario. La degradacion
// elegante no servia de nada porque nunca llegaba a ejecutarse.
//
// Ahora: 6 s por item y 7 s de presupuesto total. Lo que no alcanzo a llegar
// vuelve como `null` y la tarjeta dice "sin consultar". Es mejor devolver la
// mitad del inventario a tiempo que el inventario completo despues de que la
// plataforma corto la respuesta.
const TIMEOUT_ITEM_MS = 6_000;
const PRESUPUESTO_MS = 7_000;

const cache = new Map();

/**
 * La consulta ESTANDAR vive en el host raiz (`/api/siesa/v3/...`), no bajo el
 * path de Connekta que trae `CONNEKTA_BASE_URL` (`.../api/connekta/v3`). Por eso
 * se toma solo el origin. Las credenciales son las mismas.
 */
function hostSiesa() {
  try {
    return new URL(env.siesa.baseUrl).origin;
  } catch {
    return String(env.siesa.baseUrl || "").replace(/\/$/, "");
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function consultarItem(codigo) {
  const url = new URL(hostSiesa() + "/api/siesa/v3/ejecutarconsultaestandar");
  url.searchParams.set("idCompania", env.siesa.idCompania);
  url.searchParams.set("descripcion", CONSULTA);
  url.searchParams.set("parametros", `f120_id=${codigo}`);
  url.searchParams.set("paginacion", "numPag=1|tamPag=100");

  for (let intento = 0; intento < 3; intento++) {
    try {
      const respuesta = await fetch(url, {
        headers: {
          conniKey: env.siesa.conniKey,
          conniToken: env.siesa.conniToken,
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(TIMEOUT_ITEM_MS),
      });

      // 400 con "No se encontraron registros" NO es un fallo: es un item sin
      // existencias en ningun lado. Se responde cero, no se reintenta.
      if (respuesta.status === 400) return [];
      if (respuesta.status === 429) {
        await esperar(1500 * (intento + 1));
        continue;
      }
      if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);

      const json = await respuesta.json();
      return json?.detalle?.Datos ?? json?.detalle?.Table ?? [];
    } catch (error) {
      if (intento === 2) throw error;
      await esperar(1000 * (intento + 1));
    }
  }
  return [];
}

/**
 * Existencias de UN item en UNA bodega de Megamayoristas.
 *
 * `disponible = existencia - pos`, igual que en Traslados. `pos` es lo que el
 * punto de venta ya comprometio: contarlo como disponible mandaria al operario
 * a buscar unidades que otro ya vendio.
 */
async function existenciasDeItem(codigo, bodega) {
  const clave = `${codigo}|${bodega}`;
  const guardado = cache.get(clave);
  if (guardado && Date.now() - guardado.ts < TTL_MS) return guardado.datos;

  const filas = await consultarItem(codigo);

  const propias = filas.filter(
    (f) =>
      Number(f.f120_id_cia) === CIA_MEGA &&
      String(f.f150_id ?? "").trim() === bodega,
  );

  let existencia = 0;
  let pos = 0;
  for (const f of propias) {
    existencia += Number(f.f400_cant_existencia_1 || 0);
    pos += Number(f.f400_cant_pos_1 || 0);
  }

  const datos = { existencia, pos, disponible: existencia - pos };
  cache.set(clave, { datos, ts: Date.now() });
  return datos;
}

/**
 * Existencias de VARIOS items, con pool de concurrencia.
 *
 * Un item que falla NO tumba el lote: vuelve con `error: true` y en cero. La
 * alternativa —fallar todo— dejaria al operario sin ninguna existencia porque
 * Siesa tropezo con un codigo. La auditoria tiene que poder seguir sin esto.
 */
export async function existenciasDeItems({ items, bodega }) {
  const codigos = [...new Set((items || []).map((i) => String(i).trim()).filter(Boolean))];
  const destino = String(bodega ?? "").trim();

  if (!destino || codigos.length === 0) return {};

  const salida = {};
  let cursor = 0;
  let sinTiempo = 0;
  const inicio = Date.now();
  const vencido = () => Date.now() - inicio > PRESUPUESTO_MS;

  const trabajador = async () => {
    while (cursor < codigos.length) {
      const codigo = codigos[cursor++];

      // Se corta ANTES de pedir, no despues: arrancar una consulta que no va a
      // alcanzar a volver solo gasta el presupuesto de las que si podrian.
      if (vencido()) {
        salida[codigo] = null;
        sinTiempo++;
        continue;
      }

      try {
        salida[codigo] = await existenciasDeItem(codigo, destino);
      } catch (error) {
        logger.warn("No se pudo consultar existencias", { codigo, bodega: destino, error: error.message });
        // `null` y no cero: un cero inventado manda al operario a reportar una
        // novedad de algo que probablemente si esta en bodega.
        salida[codigo] = null;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCIA, codigos.length) }, trabajador),
  );

  const resueltos = Object.values(salida).filter(Boolean).length;
  logger.info("Existencias consultadas", {
    items: codigos.length,
    resueltos,
    sin_tiempo: sinTiempo,
    bodega: destino,
    ms: Date.now() - inicio,
  });

  return salida;
}

/** Para tests y para forzar una lectura fresca. */
export function limpiarCacheInventario() {
  cache.clear();
}
