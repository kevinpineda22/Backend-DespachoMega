/**
 * correo.js — Notificacion por correo de las novedades de inventario.
 *
 * BEST-EFFORT, SIEMPRE
 * Ninguna funcion de este archivo lanza. El correo es un aviso secundario: el
 * canal principal es Supabase Realtime, que ya empuja la alerta al panel del
 * administrador en el momento. Si el SMTP de Office 365 esta caido, rechaza el
 * login o simplemente tarda, eso NO puede tumbar el reporte de un faltante que
 * el operario ya hizo — el dato ya esta guardado en la base.
 *
 * APAGADO POR DEFECTO
 * `correoHabilitado` exige host, usuario, password Y destinatario. Sin
 * `EMAIL_ALERTAS_INVENTARIO` no se manda nada aunque el resto este completo:
 * es un seguro para que nadie empiece a recibir correos por un despliegue que
 * no esperaba.
 */
import nodemailer from "nodemailer";
import { env, correoHabilitado } from "../config/env.js";
import { logger } from "./logger.js";

// El transporte se crea una sola vez y solo si hace falta. En serverless cada
// invocacion es un proceso nuevo, asi que no hay pool que reutilizar entre
// requests, pero si evita rearmarlo dentro de una misma invocacion.
let transporte = null;

function obtenerTransporte() {
  if (!correoHabilitado) return null;

  if (!transporte) {
    transporte = nodemailer.createTransport({
      host: env.correo.host,
      port: env.correo.port,
      secure: env.correo.secure,
      auth: { user: env.correo.usuario, pass: env.correo.password },
    });
  }

  return transporte;
}

const escapar = (valor) =>
  String(valor ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

/**
 * Avisa a inventario que falto un producto.
 *
 * @param {object} datos
 * @param {string} datos.numeroFactura
 * @param {string} datos.modo
 * @param {string} datos.codigoItem
 * @param {string} [datos.descripcion]
 * @param {number} datos.cantidadFaltante
 * @param {string} datos.motivo
 * @param {string} [datos.comentario]
 * @param {string} datos.reportadoPor
 * @returns {Promise<boolean>} `true` si se envio; `false` si esta apagado o fallo.
 */
export async function notificarAlertaInventario(datos) {
  const emisor = obtenerTransporte();

  if (!emisor) {
    logger.info("Correo de alertas apagado; la novedad viaja solo por Realtime", {
      codigoItem: datos.codigoItem,
    });
    return false;
  }

  const asunto = `[Despacho Mega] Faltante en factura ${datos.numeroFactura} — ${datos.codigoItem}`;

  const cuerpo = `
    <div style="font-family:Segoe UI,system-ui,sans-serif;color:#0f172a">
      <h2 style="color:#2e7d32;margin:0 0 12px">Novedad de inventario</h2>
      <table cellpadding="6" style="border-collapse:collapse;font-size:14px">
        <tr><td><strong>Factura</strong></td><td>${escapar(datos.numeroFactura)}</td></tr>
        <tr><td><strong>Proceso</strong></td><td>${escapar(datos.modo)}</td></tr>
        <tr><td><strong>Ítem</strong></td><td>${escapar(datos.codigoItem)}</td></tr>
        <tr><td><strong>Descripción</strong></td><td>${escapar(datos.descripcion)}</td></tr>
        <tr><td><strong>Cantidad faltante</strong></td><td>${escapar(datos.cantidadFaltante)}</td></tr>
        <tr><td><strong>Motivo</strong></td><td>${escapar(datos.motivo)}</td></tr>
        <tr><td><strong>Comentario</strong></td><td>${escapar(datos.comentario)}</td></tr>
        <tr><td><strong>Reportó</strong></td><td>${escapar(datos.reportadoPor)}</td></tr>
      </table>
      <p style="font-size:12px;color:#64748b;margin-top:16px">
        Mensaje automático del módulo Despacho Mega. La novedad ya quedó registrada
        y visible en el panel de administración.
      </p>
    </div>
  `;

  try {
    await emisor.sendMail({
      from: env.correo.usuario,
      to: env.correo.destinatarioAlertas,
      subject: asunto,
      html: cuerpo,
    });

    logger.info("Alerta de inventario notificada por correo", {
      codigoItem: datos.codigoItem,
      factura: datos.numeroFactura,
    });
    return true;
  } catch (error) {
    // Se loguea y se sigue. La alerta ya existe en la base.
    logger.warn("No se pudo enviar el correo de la alerta", {
      codigoItem: datos.codigoItem,
      error: error.message,
    });
    return false;
  }
}
