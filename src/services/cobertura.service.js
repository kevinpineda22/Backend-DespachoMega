/**
 * cobertura.service.js — Control de cobertura diaria.
 *
 * LA PREGUNTA: al cerrar el dia, ¿todas las facturas que emitio Megamayoristas
 * pasaron por el modulo? Lo que el modulo conoce es solo lo que alguien tecleo;
 * lo que nunca se tecleo es invisible, y es justo lo que hay que encontrar.
 *
 * POR QUE ESTO ES UN CRON Y NO ALGO QUE PASA AL ABRIR EL PANEL
 * Las tablas POS de Siesa conservan ~4 dias. Medido el 10/8/2026: la consulta
 * declara un WHERE de 30 dias y devuelve 4, porque no existe nada mas viejo.
 * Lo que no se capture dentro de esa ventana se pierde y no hay forma de
 * recuperarlo. Un panel que sincroniza cuando alguien lo abre pierde todos los
 * dias que nadie lo abrio, y son justamente los dias que hay que auditar.
 */
import * as coberturaRepo from "../repositories/cobertura.repository.js";
import { documentosDeLaVentana } from "./facturaSiesa.service.js";
import { noEncontrado, solicitudInvalida } from "../lib/errores.js";
import { logger } from "../lib/logger.js";

/**
 * Fecha de HOY en Bogota, no en UTC.
 *
 * A las 19:00 de Bogota ya son las 00:00 UTC del dia siguiente. Con `new Date()`
 * pelado, todo lo facturado despues de las 7 de la tarde se archivaria bajo la
 * fecha equivocada — y el cierre del dia se hace justamente a esa hora.
 */
export function hoyEnBogota() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// El control cubre TODO lo facturado
// ---------------------------------------------------------------------------
//
// DECISION DEL NEGOCIO (10/8/2026): la consulta de Connekta se republico sin el
// filtro `f9820_id_cliente_pdv <> '222222222222'` a proposito. Se quiere ver
// todo lo que se factura, no solo lo que sale a un cliente con NIT registrado.
//
// Aca NO se filtra nada, y los datos dicen que esta bien: de los 1.066
// documentos de mostrador medidos en 4 dias, 157 tienen 10 o mas lineas y 37
// pasan del millon de pesos, con un maximo de 48 lineas y $3.669.801.
// "Consumidor final" NO es sinonimo de compra chica: hay pedidos grandes
// facturados asi, y son justamente los que hay que verificar.
//
// Lo que sí hace falta es poder SEPARARLOS al mirar. De eso se encarga
// `es_mostrador` en la vista (migracion 009): no descuenta nada del conteo, solo
// deja ver el mismo dia desde los dos angulos. Si algun dia el negocio decide
// que el mostrador no aplica, el filtro ya esta y no hay que tocar SQL.

/**
 * Trae la ventana de Siesa y la guarda.
 *
 * GUARDA LA VENTANA ENTERA, no solo hoy. Cuesta lo mismo —una sola descarga— y
 * hace que el sistema se repare solo: si el cron no corrio ayer, la corrida de
 * hoy recupera ayer, siempre que siga dentro de los ~4 dias que Siesa conserva.
 * Limitarlo a hoy convertiria cada falla del cron en un agujero permanente.
 *
 * @param {{ fecha?: string }} [opciones] Restringe a un dia (YYYY-MM-DD).
 */
export async function sincronizar({ fecha } = {}) {
  const inicio = Date.now();
  const documentos = await documentosDeLaVentana();

  const objetivo = fecha
    ? documentos.filter((d) => d.fecha_factura === fecha)
    : documentos;

  const guardados = await coberturaRepo.guardarSnapshot(objetivo);

  const porDia = objetivo.reduce((c, d) => {
    c[d.fecha_factura] = (c[d.fecha_factura] || 0) + 1;
    return c;
  }, {});

  const mostrador = objetivo.filter((d) => d.cliente_nit === "222222222222").length;

  logger.info("Snapshot de facturas sincronizado", {
    documentosEnVentana: documentos.length,
    guardados: guardados.length,
    // Se registra la proporcion de mostrador en cada corrida: es el numero que
    // avisa si la consulta de Connekta volvio a cambiar de alcance sin que
    // nadie se entere.
    mostrador,
    dias: Object.keys(porDia).sort(),
    ms: Date.now() - inicio,
  });

  return {
    documentos_en_ventana: documentos.length,
    guardados: guardados.length,
    mostrador,
    por_dia: porDia,
    // Que dias cubre Siesa AHORA. Si el panel pide un dia anterior al mas viejo
    // de esta lista, ya no hay forma de sincronizarlo: solo sirve lo que se haya
    // capturado en su momento.
    dias_disponibles: [...new Set(documentos.map((d) => d.fecha_factura))].sort(),
    sincronizada_at: new Date().toISOString(),
  };
}

/**
 * Tablero de cobertura: el semaforo por dia mas el detalle del rango.
 *
 * Sin rango, el dia de hoy — que es como se usa el 90% de las veces: alguien
 * abre el panel a las 6 de la tarde para ver que falta.
 */
export async function tablero(filtros) {
  const desde = filtros.desde || hoyEnBogota();
  const hasta = filtros.hasta || desde;
  const args = { ...filtros, desde, hasta };

  const [{ facturas, total }, resumen] = await Promise.all([
    coberturaRepo.listar(args),
    coberturaRepo.resumenPorDia({ desde, hasta }),
  ]);

  return {
    rango: { desde, hasta },
    facturas,
    total,
    resumen_por_dia: resumen,
    totales: totalizar(resumen),
  };
}

const CAMPOS_RESUMEN = [
  "facturadas",
  "excluidas",
  "aplican",
  "sin_tocar",
  "alistando",
  "con_picking",
  "con_auditoria",
  "valor_sin_tocar",
  "mostrador",
  "con_cliente",
  "mostrador_aplican",
  "mostrador_con_picking",
  "con_cliente_aplican",
  "con_cliente_con_picking",
  "notas_credito",
];

/** Suma los dias del rango. Todo COUNT(*), asi que sumar es correcto. */
function totalizar(resumen) {
  const t = Object.fromEntries(CAMPOS_RESUMEN.map((c) => [c, 0]));

  for (const dia of resumen) {
    for (const campo of CAMPOS_RESUMEN) t[campo] += Number(dia[campo] || 0);
  }

  // `aplican` en cero devuelve null y no 100%: un dia sin facturas no es un dia
  // perfecto, es un dia sin datos, y pintarlo en verde seria decir que todo
  // salio bien cuando no salio nada.
  const pct = (hechas, total) => (total ? (hechas / total) * 100 : null);

  return {
    ...t,
    cobertura_pct: pct(t.con_picking, t.aplican),
    // Los dos angulos por separado. Mezclarlos esconde el caso interesante: que
    // el mostrador arrastre el porcentaje al piso y tape que las facturas con
    // cliente identificado si se estan alistando.
    cobertura_identificado_pct: pct(t.con_cliente_con_picking, t.con_cliente_aplican),
    cobertura_mostrador_pct: pct(t.mostrador_con_picking, t.mostrador_aplican),
  };
}

/**
 * Marca o desmarca un documento como excluido del control.
 *
 * EXIGE MOTIVO AL EXCLUIR, por la misma razon que cerrar una novedad: excluir
 * es sacar una factura del conteo, y sin explicacion escrita nadie puede
 * auditar despues por que ese dia dio 100%.
 */
export async function excluir(id, { excluida, motivo }, usuario) {
  const factura = await coberturaRepo.porId(id);
  if (!factura) throw noEncontrado("Factura no encontrada en el control del dia.");

  if (excluida && !motivo?.trim()) {
    throw solicitudInvalida(
      "Para excluir una factura del control hay que escribir por que. " +
        "Sin motivo, nadie puede auditar despues por que ese dia dio 100%.",
    );
  }

  return coberturaRepo.actualizarExclusion(id, {
    excluida,
    motivo_exclusion: excluida ? motivo.trim() : null,
    excluida_por: excluida ? usuario.userId : null,
    excluida_at: excluida ? new Date().toISOString() : null,
  });
}
