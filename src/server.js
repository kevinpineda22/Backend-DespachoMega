/**
 * server.js — Arranque local. En Vercel no se ejecuta: la entrada es api/index.js.
 */
import "dotenv/config";
import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";

app.listen(env.port, () => {
  logger.info("Backend Despacho Mega arriba", {
    puerto: env.port,
    entorno: env.nodeEnv,
  });
});
