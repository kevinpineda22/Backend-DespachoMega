/**
 * app.js — Ensamble de Express. Sin `listen`: eso lo hace `server.js` en local
 * y `api/index.js` en Vercel, que corre como funcion serverless.
 */
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { env, esProduccion } from "./config/env.js";
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
      return callback(new Error(`Origen no permitido: ${origin}`));
    },
    credentials: true,
  }),
);

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
