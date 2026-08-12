/**
 * app.js — Ensamble de Express. Sin `listen`: eso lo hace `server.js` en local
 * y `api/index.js` en Vercel, que corre como funcion serverless.
 */
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { env, esProduccion } from "./config/env.js";
import { logger } from "./lib/logger.js";
import rutas from "./routes/index.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";

const app = express();

// Detras del proxy de Vercel. Sin esto, el rate limit ve la IP del proxy y
// termina limitando a TODOS los operarios como si fueran uno solo.
app.set("trust proxy", 1);

app.use(helmet());

app.use(
  cors({
    origin(origin, callback) {
      // Sin `origin` son llamadas server-to-server o curl: no hay nada que
      // proteger con CORS ahi (la barrera real es el JWT).
      if (!origin) return callback(null, true);
      if (env.corsOrigins.length === 0) return callback(null, true);
      if (env.corsOrigins.includes(origin)) return callback(null, true);

      // UN ORIGEN RECHAZADO NO ES UN ERROR DEL SERVIDOR.
      // Aca iba `callback(new Error(...))`, y un Error dentro de este callback
      // sale como 500: "Internal Server Error" mandando a revisar logs, cuando
      // la causa es una lista de configuracion a la que le falta un dominio.
      //
      // Se responde `false`: el navegador bloquea igual por falta de cabecera
      // —que es lo correcto— y el middleware de abajo deja el motivo escrito
      // con el origen exacto que hay que agregar a CORS_ORIGINS.
      logger.warn("Origen bloqueado por CORS", {
        origen: origin,
        permitidos: env.corsOrigins,
      });
      return callback(null, false);
    },
    credentials: true,
  }),
);

/**
 * Explica el bloqueo en el CUERPO de la respuesta.
 *
 * Sin esto el navegador solo dice "blocked by CORS policy" y el backend
 * responde 200 sin cabeceras: nadie sabe cual es la lista ni que falta. Con
 * esto, un `curl` desde el origen equivocado devuelve el diagnostico completo.
 */
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const bloqueado =
    origin &&
    env.corsOrigins.length > 0 &&
    !env.corsOrigins.includes(origin);

  if (!bloqueado) return next();

  return res.status(403).json({
    ok: false,
    error:
      `El origen ${origin} no esta autorizado. Agreguelo a la variable ` +
      "CORS_ORIGINS del backend (separada por comas) y vuelva a desplegar.",
    origenes_permitidos: env.corsOrigins,
  });
});

app.use(express.json({ limit: "1mb" }));

// El limite alto es a proposito: un operario con lector escanea rapido y en
// rafagas. Poner 60/min lo bloquearia en medio de una factura grande.
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: esProduccion ? 300 : 1000,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { ok: false, error: "Demasiadas peticiones. Espere un momento." },
  }),
);

app.use("/api", rutas);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
