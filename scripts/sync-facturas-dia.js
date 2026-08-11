/**
 * sync-facturas-dia.js — Captura diaria de lo facturado en Siesa.
 *
 * ESTE SCRIPT ES EL MECANISMO, EL BOTON DEL PANEL ES EL COMPLEMENTO
 * Las tablas POS de Siesa (`t9820_pdv_d_doctos`) conservan ~4 dias: son staging
 * del punto de venta y los documentos salen de ahi al contabilizarse. Medido el
 * 10/8/2026: la consulta declara un WHERE de 30 dias y devuelve 4, porque no
 * existe nada mas viejo (docs/PENDIENTES.md §1-ter).
 *
 * Lo que no se capture dentro de esa ventana NO SE PUEDE RECUPERAR. Por eso esto
 * corre solo, todos los dias, aunque nadie abra el panel.
 *
 * Guarda la ventana ENTERA y no solo el dia de hoy: cuesta la misma descarga y
 * hace que una corrida se repare a si misma: si el cron fallo ayer, la de hoy
 * recupera ayer. Limitarlo a hoy convertiria cada falla en un agujero definitivo.
 *
 * USO
 *   node --env-file=.env scripts/sync-facturas-dia.js
 *   node --env-file=.env scripts/sync-facturas-dia.js 2026-08-09   # un dia
 *
 * Sale con codigo 1 si falla, para que el cron lo reporte como fallido en vez
 * de quedarse en verde sin haber guardado nada.
 */
import { sincronizar } from "../src/services/cobertura.service.js";
import { logger } from "../src/lib/logger.js";

const fecha = process.argv[2];

if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
  console.error(`Fecha invalida: "${fecha}". Formato esperado: YYYY-MM-DD.`);
  process.exit(1);
}

try {
  const r = await sincronizar({ fecha });

  console.log("Sincronizacion completa");
  console.log(`  documentos en la ventana : ${r.documentos_en_ventana}`);
  console.log(`  guardados                : ${r.guardados}`);
  console.log(`  dias disponibles en Siesa: ${r.dias_disponibles.join(", ")}`);
  console.log(`  por dia                  : ${JSON.stringify(r.por_dia)}`);

  // Una ventana vacia no lanza excepcion, pero es una señal: o no se facturo
  // nada, o la consulta dejo de devolver datos. Se avisa sin fallar, porque un
  // domingo sin ventas es legitimo.
  if (r.documentos_en_ventana === 0) {
    console.warn(
      "AVISO: la ventana de Siesa vino vacia. Si no es un dia sin ventas, " +
        "revisar la consulta merkahorro_Despacho_Factura_dev en Connekta.",
    );
  }

  process.exit(0);
} catch (error) {
  logger.error("Fallo la sincronizacion de facturas del dia", {
    error: error.message,
  });
  console.error("FALLO la sincronizacion:", error.message);
  process.exit(1);
}
