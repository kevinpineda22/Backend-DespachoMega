# Despacho Mega — Backend

Picking y auditoría de facturas de **Megamayoristas** contra Siesa, con
trazabilidad por usuario, alertas a inventario y analítica.

## Por dónde empezar

| Documento | Qué contiene |
| --------- | ------------ |
| `README.md` | Arranque, arquitectura, seguridad, despliegue |
| `docs/API.md` | Contrato de todos los endpoints |
| `docs/PENDIENTES.md` | **Lo más importante.** Cada hallazgo medido, con fecha, y lo que falta |
| `../Pagina-web_React/docs/DESPACHO-MEGA.md` | Visión funcional + frontend + cómo se dan los permisos |

El frontend vive en el repositorio `Pagina-web_React`, rutas
`/despacho-mega/operario` y `/despacho-mega/admin`.

## Reglas que no se deducen del código

**Compañías.** Cía 1 = Merkahorro, Cía 2 = **Megamayoristas** (este módulo).
`idCompania=7375` es el tenant de Connekta, no la compañía interna.

**Este backend SÍ valida el JWT**, a diferencia de los de Traslados y ecommerce.
La identidad sale del token, nunca del cuerpo: ningún endpoint acepta
`operario_id`. El módulo firma quién despachó qué, y esa firma tiene que valer
como evidencia.

**Prefijos obligatorios.** El proyecto de Supabase lo comparten muchos módulos.
Todo lo de este va con `despacho_mega_` (tablas, tipos, vistas, funciones,
políticas). En el frontend: CSS `dm-`, componentes `DM`, env `VITE_DESPACHO_MEGA_`.

**Catálogo propio.** NO usar `items_siesa` / `siesa_codigos_barras`: son de
Merkahorro y solo cubrían 36 de 66 ítems de Mega. Este módulo usa
`despacho_mega_items` / `despacho_mega_codigos_barras`, con la misma estructura
campo por campo para que un solo script sincronice ambas compañías.

**Conteo en unidades base.** `CANTIDAD` de Siesa viene en unidades base, pero
`PrecioUnitDet` va por paquete — no cuadra multiplicarlos. El `factor` de un
código (`P12` → 12) sale del código de unidad, **no** de ningún campo numérico
de Siesa. Detalle y verificación en `PENDIENTES.md` §1.

**No se despacha más de lo facturado.** Un escaneo que excede se rechaza entero
y queda registrado como `excede_cantidad`. Cambiar esto no es agregar un valor
al enum: la regla vive en `validar()`.

**La auditoría se abre contra el picking, no contra la factura.** Exige un
picking finalizado y verifica **lo alistado**, no lo facturado — si el picking
cerró con un faltante ya reportado, auditar contra la factura lo marcaría como
faltante otra vez. Por eso **no consulta Siesa**, lo que además permite auditar
despachos más viejos que la ventana de días de la consulta POS.

**Los escaneos rechazados se guardan.** Son evidencia de capacitación, rotulado
o factura mal armada. No borrarlos.

**RLS sin políticas de escritura, a propósito.** Toda mutación pasa por el
backend con `service_role`. Las políticas de SELECT existen porque Supabase
Realtime respeta RLS: sin ellas el monitor en vivo no recibe nada.

## Trampas de Siesa ya pagadas

- Una consulta **no publicada** devuelve `401`, no 404, con el mismo mensaje que
  unas credenciales malas. Ante un 401, revisar el nombre de la consulta primero.
- Las consultas **personalizadas** (`ejecutarconsulta`) **no aceptan parámetros**:
  `parametros=` responde 400. Solo las **estándar**
  (`ejecutarconsultaestandar`) lo soportan, con `parametros=f120_id_cia=N`.
- Siesa responde a veces con cuerpo vacío o JSON truncado y HTTP 200. Hay que
  mirar el cuerpo, no el status. `siesaClient.js` ya reintenta esos casos y solo
  esos.
- `UNIDAD_MEDIDA` llega con espacios de relleno (`"UND "`). `CONSEC_DOCTO` e
  `id_item` llegan como número, no string.

## Estructura

```
api/index.js     Entrada de Vercel        src/routes/index.js  Mapa de endpoints
src/server.js    Entrada local            src/controllers/     HTTP -> servicio
src/app.js       Ensamble de Express      src/services/        Reglas de negocio
src/config/      env validado, Supabase   src/repositories/    Único acceso a Supabase
src/lib/         Siesa, errores, logger   src/schemas/         Contratos Zod (Zod)
src/middleware/  auth, validate, errores  db/migrations/       SQL para Supabase
```

Regla de una vía: **controlador → servicio → repositorio**. Un controlador que
consulta Supabase, o un repositorio que decide una regla de negocio, es una
violación de la estructura, no un atajo.

## Comandos

```bash
npm run dev     # local en :3002
npm test        # vitest (todavía sin pruebas — PENDIENTES §7)
npm run lint
```

Las migraciones se corren **de a una y en orden** en el SQL Editor de Supabase.
Son idempotentes: si una falla a la mitad, se vuelve a correr sin borrar nada.
