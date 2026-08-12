/**
 * env.js — Carga y validacion de variables de entorno.
 *
 * Los NOMBRES siguen la convencion de los demas backends de la intranet
 * (`SUPABASE_SERVICE_KEY`, `CONNEKTA_*`, `CONNI_*`, `SMTP_*`) para que quien
 * administre Vercel no tenga que recordar un juego distinto por proyecto.
 * Adentro se agrupan por dominio, que es otra cosa: el nombre plano es el
 * contrato con la infraestructura, el objeto es comodidad del codigo.
 *
 * Falla al arrancar si falta algo critico. Es a proposito: un backend que
 * levanta sin `SUPABASE_SERVICE_KEY` no da error hasta que un operario esta
 * parado frente a la estanteria esperando que cargue la factura.
 */

const requeridas = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_KEY",
  "CONNI_KEY",
  "CONNI_TOKEN",
];

const faltantes = requeridas.filter((nombre) => !process.env[nombre]?.trim());

if (faltantes.length > 0) {
  throw new Error(
    `Faltan variables de entorno obligatorias: ${faltantes.join(", ")}. ` +
      "Ver env.example.",
  );
}

const texto = (valor, porDefecto = "") => (valor ?? porDefecto).trim();

const numero = (valor, porDefecto) => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
};

export const env = {
  nodeEnv: texto(process.env.NODE_ENV, "development"),
  port: numero(process.env.PORT, 3002),

  supabase: {
    url: texto(process.env.SUPABASE_URL),
    serviceKey: texto(process.env.SUPABASE_SERVICE_KEY),
  },

  // Connekta es la pasarela; Siesa es el sistema del otro lado. Las variables
  // se llaman CONNEKTA_/CONNI_ como en el resto de la intranet, pero adentro se
  // agrupa como `siesa` porque es lo que el negocio nombra.
  siesa: {
    baseUrl: texto(
      process.env.CONNEKTA_BASE_URL,
      "https://servicios.siesacloud.com/api/connekta/v3",
    ),
    idCompania: texto(process.env.CONNEKTA_ID_COMPANIA, "7375"),
    conniKey: texto(process.env.CONNI_KEY),
    conniToken: texto(process.env.CONNI_TOKEN),
    consultaFactura: texto(
      process.env.CONNEKTA_CONSULTA_FACTURA,
      "merkahorro_Despacho_Factura",
    ),
    timeoutMs: numero(process.env.CONNEKTA_TIMEOUT_MS, 25000),
    maxRetries: numero(process.env.CONNEKTA_MAX_RETRIES, 3),
  },

  /**
   * Items que Siesa factura pero que NADIE escanea: no son producto fisico.
   *
   * 44736 "DESPACHO PRODUCTOS" es un concepto administrativo interno. Mientras
   * entraba al despacho, ocupaba una linea que no se podia validar y el picking
   * nunca llegaba al 100%: al 12/8/2026 habia 10 pickings abiertos trabados por
   * eso, todos con cantidad_validada = 0.
   *
   * Va por variable de entorno y no fijo en el codigo porque el catalogo de
   * conceptos administrativos lo maneja el area contable, no desarrollo: cuando
   * aparezca el siguiente, se agrega al `.env` y listo.
   */
  itemsExcluidos: new Set(
    texto(process.env.DESPACHO_ITEMS_EXCLUIDOS, "44736")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
  ),

  /**
   * Correo. TODO opcional: si falta cualquier pieza, el envio queda apagado y
   * el modulo sigue funcionando (las alertas llegan igual por Realtime).
   *
   * `destinatarioAlertas` vacio = apagado, aunque el SMTP este completo. Es un
   * seguro deliberado: sin destinatario explicito no se manda nada, para que
   * nadie empiece a recibir correos por un despliegue que no esperaba.
   */
  correo: {
    host: texto(process.env.SMTP_HOST),
    port: numero(process.env.SMTP_PORT, 587),
    secure: texto(process.env.SMTP_SECURE, "false") === "true",
    usuario: texto(process.env.EMAIL_USER),
    password: texto(process.env.EMAIL_PASS),
    destinatarioAlertas: texto(process.env.EMAIL_ALERTAS_INVENTARIO),
  },

  // Origenes permitidos. Vacio => se permite todo (solo util en desarrollo).
  corsOrigins: texto(process.env.CORS_ORIGINS)
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
};

export const esProduccion = env.nodeEnv === "production";

/** El envio de correo solo se habilita con TODAS las piezas presentes. */
export const correoHabilitado = Boolean(
  env.correo.host &&
    env.correo.usuario &&
    env.correo.password &&
    env.correo.destinatarioAlertas,
);
