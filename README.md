# Backend Despacho Mega

API del módulo **Despacho Mega**: picking y auditoría de facturas de Siesa, con
trazabilidad por usuario y panel de analítica.

Frontend: `Pagina-web_React`, rutas `/despacho-mega/operario` y
`/despacho-mega/admin`. La documentación funcional completa está en
`Pagina-web_React/docs/DESPACHO-MEGA.md`.

---

## Arranque

```bash
npm install
```

Copiar `env.example` a `.env` y completarlo. Luego:

```bash
npm run dev
```

Levanta en `http://localhost:3002`. Verificar con:

```bash
curl http://localhost:3002/api/health
```

### Base de datos

Ejecutar en el SQL Editor de Supabase, **en este orden**:

1. `db/migrations/001_despacho_mega_schema.sql`
2. `db/migrations/002_despacho_mega_views.sql`
3. `db/migrations/003_despacho_mega_rls.sql`
4. `db/migrations/004_despacho_mega_catalogo.sql`
5. `db/migrations/005_despacho_mega_auditoria_origen.sql`
6. `db/migrations/006_despacho_mega_vista_facturas.sql`
7. `db/migrations/007_despacho_mega_novedades_analitica.sql`
8. `db/migrations/008_despacho_mega_cobertura_dia.sql`

### Captura diaria (obligatoria)

El control de cobertura se apoya en un snapshot propio porque **las tablas POS
de Siesa solo conservan ~4 días** (ver `docs/PENDIENTES.md §1-ter`). Lo que no se
capture dentro de esa ventana se pierde y no se puede recuperar.

```bash
npm run sync:facturas             # toda la ventana
npm run sync:facturas 2026-08-09  # un día puntual
```

En producción lo corre `.github/workflows/sync-facturas-dia.yml`, todos los días
a las 23:30 UTC (18:30 en Bogotá). **Si ese workflow deja de correr, el síntoma
no es un error: son días que aparecen vacíos en el panel.** Requiere los mismos
secretos que la sincronización del catálogo, incluida la service role key.

### Primer administrador

El endpoint que crea despachadores exige ser admin, y admin es una fila en
`despacho_mega_operarios`. El primero hay que insertarlo a mano — es un huevo y
gallina que no se resuelve solo:

```sql
INSERT INTO public.despacho_mega_operarios (user_id, correo, nombre, rol, modo_habilitado)
SELECT id, email, 'Nombre del admin', 'admin', 'ambos'
FROM auth.users
WHERE email = 'correo.del.admin@merkahorrosas.com';
```

---

## Arquitectura

```
api/index.js          Entrada de Vercel (reexporta la app de Express)
src/
  server.js           Entrada local (listen)
  app.js              Ensamble: helmet, cors, rate limit, rutas, errores
  config/             env validado y clientes de Supabase
  lib/                Cliente de Siesa, errores HTTP, logger
  middleware/         auth (JWT), validate (Zod), errorHandler
  routes/index.js     Mapa completo de endpoints
  controllers/        HTTP -> servicio. Sin lógica de negocio.
  services/           Reglas del negocio
  repositories/       Único lugar que habla con Supabase
  schemas/            Contratos de entrada (Zod)
db/migrations/        SQL a ejecutar en Supabase
```

La regla es de una vía: **controlador → servicio → repositorio**. Un controlador
que consulta Supabase directo, o un repositorio que decide una regla de negocio,
es una violación de la estructura, no un atajo.

---

## Seguridad

Este backend **sí valida quién llama**, a diferencia de los backends de Traslados
y ecommerce.

- Cada request (salvo `/api/health`) exige `Authorization: Bearer <jwt>` de
  Supabase Auth.
- La identidad sale del token, **nunca** del cuerpo del request. Ningún endpoint
  acepta `operario_id` como parámetro.
- El usuario además debe existir y estar activo en `despacho_mega_operarios`.
- Los endpoints de operarios, analítica y aprobaciones exigen `rol = 'admin'`.

La razón: el módulo firma quién despachó cada factura y quién reportó cada
faltante. Si esa firma la pusiera el cliente, no valdría como evidencia.

`SUPABASE_SERVICE_KEY` da acceso total a la base ignorando RLS. Vive solo acá y
en las variables de entorno de Vercel. Nunca en el frontend.

No hace falta anon key: `auth.getUser(jwt)` valida el token contra la firma de
GoTrue, y `verificarToken` además exige que el token tenga un usuario real — así
la propia `service_role` key, que también es un JWT válido, no sirve como sesión.

---

## Convención de nombres

Todo objeto de base de datos lleva el prefijo `despacho_mega_`. El proyecto de
Supabase lo comparten varios módulos (ecommerce, traslados, inventario, siesa\_\*)
y una tabla `operarios` sin prefijo se cruzaría con otra existente.

Tablas ajenas que este módulo **solo lee** y nunca escribe:

| Tabla                  | Dueño                          | Uso acá                        |
| ---------------------- | ------------------------------ | ------------------------------ |
| `auth.users`           | Supabase Auth                  | Identidad                      |
| `siesa_codigos_barras` | Scripts de sync del frontend   | Código de barras → ítem        |
| `items_siesa`          | Scripts de sync del frontend   | Descripción de respaldo        |

---

## Despliegue

Vercel, igual que los demás backends de la intranet. `vercel.json` reescribe
todo el tráfico a `api/index.js`.

Variables de entorno a cargar en el proyecto de Vercel: las mismas de
`env.example`, con `NODE_ENV=production` y `CORS_ORIGINS` apuntando a
`https://merkahorro.com`.

Después de desplegar, poner la URL resultante en el `.env` del frontend como
`VITE_DESPACHO_MEGA_API_URL=https://<proyecto>.vercel.app/api`.

El CSP del frontend (`public/.htaccess`) ya permite `https://*.vercel.app`, así
que no hace falta tocarlo.

---

## Pendientes

Ver [docs/PENDIENTES.md](docs/PENDIENTES.md). El bloqueante para poder probar de
punta a punta es la consulta de facturas en Siesa.
