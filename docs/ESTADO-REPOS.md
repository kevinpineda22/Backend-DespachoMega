# Estado cruzado de los dos repositorios — Despacho Mega

Medido el **11 de agosto de 2026** leyendo el código de los dos repos, no la
documentación previa. Este documento existe porque el módulo vive en **dos
repositorios que se despliegan por separado** y hoy no están en la misma versión:
el frontend ya usa endpoints que el backend todavía no publicó.

Los pendientes de fondo siguen en `PENDIENTES.md` (backend) y
`PENDIENTES-OPERARIO.md` (lo que el operario le pide al backend). Acá va lo que
ninguno de los dos puede decir por sí solo: **quién va adelante de quién**.

---

## 1. Lo primero: el backend tiene trabajo sin commitear que el front ya usa

**Riesgo activo.** Si alguien despliega el frontend de `origin` contra el backend
de `origin` hoy, el operario recibe **404 en tres funciones que la UI ya
muestra**.

| Capacidad | Frontend | Backend | Dónde vive el backend |
| --------- | -------- | ------- | --------------------- |
| Resolver un código de barras al modal de cantidad | Commiteado y en `origin` | **Sin commitear** | working tree local |
| Devolver una línea a pendientes (botón *Devolver*) | Commiteado y en `origin` | **Sin commitear** | working tree local |
| Banner "Verificando el alistado" al recargar auditoría | Commiteado y en `origin` | **Sin commitear** | working tree local |

Los 7 archivos sin commitear en `Backend-DespachoMega` (`git status`):

```
M  docs/API.md                             +41
A  docs/PENDIENTES-OPERARIO.md            +125
M  src/controllers/despachos.controller.js +21
M  src/repositories/eventos.repository.js   +1
M  src/routes/index.js                     +18
M  src/schemas/despachoMega.schema.js      +16
M  src/services/despacho.service.js       +182
```

Qué agregan, exactamente:

- `GET /despachos/:id/resolver?codigo=` — traduce barra o `codigo_item` a la
  línea, **sin mutar**. Consumido en `DespachoMegaOperario.jsx:314`.
- `POST /despachos/:id/items/:itemId/ajustar` — fija el total **absoluto** de una
  línea; `0` la devuelve a pendientes. Consumido en `useDMDespacho.js:106`.
- `GET /despachos/:id` ahora devuelve `picking` (contexto del picking de origen,
  `null` si no es auditoría). Consumido en `useDMDespacho.js:47` y `:172`.
- Evento nuevo `item_ajustado` en `eventos.repository.js`.

### Qué hacer

- [ ] Commitear y pushear el backend **antes** de que el front llegue a producción.
- [ ] Desplegar backend primero, frontend después. En ese orden: el front tolera
      un backend adelantado, no al revés.
- [ ] Verificar en el deploy: escanear una barra abre el modal, *Devolver* deja la
      línea en pendientes, recargar una auditoría muestra el banner.

---

## 2. Estado de las ramas

| Repo | Rama local | Contra `origin` | Árbol de trabajo |
| ---- | ---------- | --------------- | ---------------- |
| `Backend-DespachoMega` | `master` | Al día (0 adelante, 0 atrás) | **Sucio — 7 archivos** |
| `Pagina-web_React` | `Johan` | Al día | Limpio |
| `Pagina-web_React` | `master` | **127 commits atrás** | — |

**El trabajo del frontend vive en la rama `Johan`, no en `master`.** El `master`
local está en `3a926469` ("traslados funcional"), de antes del módulo. Quien
clone y se pare en `master` no ve nada de Despacho Mega. Los últimos commits
relevantes están en `Johan`: `7568de6f panel de picking mega (#916)`,
`a725010d avance en todo el panel admin`.

---

## 3. Superficie de API: qué expone el backend y qué consume el front

Referencia rápida para no reimplementar lo que ya existe.

| Endpoint del backend | ¿Lo usa el front? | Dónde |
| -------------------- | ----------------- | ----- |
| `GET /yo` | Sí | `dmApi.yo` |
| `GET /facturas/:numero` | Sí | `dmApi.previsualizarFactura` |
| `POST /despachos` · `GET /despachos` · `GET /despachos/:id` | Sí | `dmApi` |
| `POST /despachos/:id/validar` | Sí | `dmApi.validarItem` |
| `GET /despachos/:id/resolver` | Sí | **backend sin commitear** (§1) |
| `POST /despachos/:id/items/:itemId/ajustar` | Sí | **backend sin commitear** (§1) |
| `POST /despachos/:id/finalizar` | Sí | `dmApi.finalizarDespacho` |
| `POST /despachos/:id/cancelar` | **No expuesto en UI** | decisión de negocio, §5 |
| `POST /despachos/:id/aprobar` | Sí | `DMTabDespachos`, `DMFacturaDetalle` |
| `GET /despachos/:id/eventos` | **Cliente listo, UI no lo llama** | `dmApi.eventosDespacho` |
| `GET /panel/facturas` · `/panel/facturas/:numero` | Sí | `DMTabFacturas` |
| `GET /panel/cobertura` | Sí | `DMTabCobertura` |
| `POST /panel/cobertura/sincronizar` | Sí | `dmApi.sincronizarCobertura` |
| `PATCH /panel/cobertura/:id/exclusion` | Sí | `dmApi.excluirFactura` |
| `POST /alertas` · `GET /alertas` · `PATCH /alertas/:id` | Sí | operario + `DMTabNovedades` |
| `GET /panel/novedades` | Sí | `DMTabNovedades` |
| `GET /operarios` · `PATCH /operarios/:id` · `/actividad` | Sí | `DMTabOperarios` |
| `GET /analitica/tablero` | Sí | `DMTabAnalitica` |
| `/analitica/{resumen,por-operario,productos-top,picos-trabajo,novedades,calidad-escaneo}` | No — `tablero` los agrega | — |

Los seis endpoints granulares de analítica **no son un pendiente**: `tablero`
devuelve todo junto en un viaje y el panel se arma con eso. Existen sueltos por
si algún día hace falta pedir una sola tarjeta.

---

## 4. ~~Control de cobertura sin frontend~~ — RESUELTO (11 ago 2026)

`DMTabCobertura.jsx` (commit `fc8bed9c`) cerró el hueco. El panel pasó a **cinco
secciones** y `dmApi` tiene los tres métodos: `coberturaDia`,
`sincronizarCobertura` (con timeout de 90 s, que hace falta: la sincronización
baja el día entero de Siesa) y `excluirFactura`.

<details><summary>Por qué era el pendiente más grande</summary>

El backend tenía el control **entero** —tres endpoints, migraciones
`008_despacho_mega_cobertura_dia.sql` y `009_despacho_mega_cobertura_mostrador.sql`,
`cobertura.service.js → aplicaAlControl()`, `scripts/sync-facturas-dia.js` y su
workflow— y no se podía ver nada.

El snapshot diario existe **porque las tablas POS de Siesa conservan ~4 días**
(`PENDIENTES.md` §1-ter): se capturaba información que se pierde si no se
captura, y nadie la miraba. La pregunta que responde —"de todo lo que Siesa
facturó hoy, ¿qué pasó por el módulo?"— es la única que detecta una factura que
**nunca se despachó**. Las otras cuatro pestañas solo ven lo que sí entró.

</details>

---

## 5. Pendientes que necesitan una decisión, no código

Estos no los desbloquea programar. Van primero porque bloquean a los demás.

| # | Decisión | Quién decide | Qué se hace después |
| - | -------- | ------------ | ------------------- |
| 1-ter | Facturas de más de ~4 días no se pueden abrir. ¿El negocio audita con más rezago? | Negocio | Si sí: pedir a Siesa una segunda consulta sobre `t350_co_docto` y encadenarla como respaldo en `consultarFactura()` |
| §2 op. | ¿El operario puede cancelar su propio despacho, o solo el admin? | Admin | `dmApi.cancelarDespacho` ya está listo; es agregar el botón o dejarlo solo en el panel |
| §9 | ¿Inventario necesita enterarse sin abrir el panel? | Inventario | Cargar `EMAIL_ALERTAS_INVENTARIO` (el correo ya está implementado y apagado) |

---

## 6. Pendientes de backend

Detalle completo en `PENDIENTES.md`. Resumen ordenado por prioridad:

| # | Pendiente | Prioridad |
| - | --------- | --------- |
| 1-ter | Histórico: la ventana de Siesa no se amplía, hace falta otra fuente | Alta — **decisión** |
| 1-quater | Restaurar el `WHERE` de consumidor final en Connekta; verificar `f9820_id_cliente_pdv` vs `f9740_nit` | Alta |
| 3 | Forzar cambio de contraseña en el primer ingreso — y que **`/yo` devuelva la bandera** | Alta |
| 4 | Concurrencia en `validar()`: escritura condicional en `actualizarItem` | Media |
| 9 | Cron que avise novedades viejas (hoy el semáforo solo se ve entrando al panel) | Media |
| 7 | Tests: hay 2 (`comparativo`, `agregacion`). Faltan `normalizarFactura`, `extraerFilas`, la máquina de estados de `validar()` | Baja |
| 8 | Techo de 5.000 filas por vista. Si se alcanza, agregar por semana/mes en SQL — no subir el número | Baja |

> **El §3 tiene una mitad de frontend.** El punto de enganche ya está: el
> `useEffect` que resuelve el perfil con `dmApi.yo()`. Falta que `/yo` exponga
> `debe_cambiar_password`. Sin eso el front no tiene qué leer.

---

## 7. Pendientes de frontend

| Pendiente | Prioridad | Nota |
| --------- | --------- | ---- |
| Historial propio del operario | Baja | Si se expone, el `operario_id` **se deriva del JWT en el servidor**, no del query (`listar()` hoy pasa los filtros tal cual) |
| Bitácora del despacho en la UI | Baja | `dmApi.eventosDespacho` está escrito y nadie lo llama |
| Modo offline | Baja | Patrón ya resuelto en Traslados: `useAuditoriaOffline.js`, `useRecoleccionOffline.js` |
| Tests del módulo | Baja | `vitest` configurado en el repo; `src/pages/DespachoMega/` tiene **0 archivos de test** |

### Ya hecho — la doc vieja decía que no

`docs/DESPACHO-MEGA.md` §8 quedó desactualizado. Verificado en código el 11/8/2026:

- **Gráficas de analítica**: hechas. `DMTabAnalitica.jsx` importa `recharts`.
- **Escáner por cámara**: hecho. Reusa `DesarrolloSurtido_API/EscanerBarras`.
- **Migraciones**: son **9**, no 4.
- **Tests de backend**: hay 2, no cero.

---

## 8. Versiones

Verificado en los `package.json` de ambos repos.

| | Backend | Frontend |
| - | ------- | -------- |
| Versión | `0.1.0` | — |
| Node | `>=20` | — |
| `@supabase/supabase-js` | `^2.89.0` | `^2.89.0` — **iguales, mantenerlo así** |
| Framework | express `^4.21.2` | react `^19.2.3` / vite `^7.3.0` |
| Validación | zod `^3.24.1` | — |
| HTTP | — | axios `^1.15.2` |
| Gráficas / escáner | — | recharts `^3.8.1`, html5-qrcode `^2.3.8` |
| Tests | vitest `^3.0.0` | vitest (repo) |

`@supabase/supabase-js` coincide en los dos lados. No es casualidad y conviene
que siga así: el token que firma el frontend lo verifica el backend, y una
diferencia de major en esa librería es exactamente el tipo de cosa que rompe
sesiones sin dar un error legible.

**Zod está en 3, no en 4.** Los esquemas usan `z.coerce`, que en Zod 4 cambia de
comportamiento. Si alguien actualiza, se revisan `ajustarItemBody` y el resto de
`despachoMega.schema.js` **antes** de dar por buena la migración.

---

## 9. Cómo repartir el trabajo entre los dos

Las piezas no se pisan: tocan archivos distintos y no hay conflicto de merge
previsto.

**Quien lleva el backend**

1. Commitear y pushear los 7 archivos de §1. Esto es lo primero, bloquea al otro.
2. §1-quater — restaurar el `WHERE` en Connekta.
3. §3 — que `/yo` devuelva `debe_cambiar_password`.
4. §4 — concurrencia en `validar()`.

**Quien lleva el frontend**

1. `DMTabCobertura` (§4). Es la pieza grande y no depende de nada del backend:
   los tres endpoints ya existen y responden.
2. El redirect de primer login, en cuanto `/yo` traiga la bandera.
3. La bitácora con `eventosDespacho`, que ya está escrita en el cliente.

---

## 10. Checklist antes de cada despliegue

- [ ] `git status` limpio en **los dos** repos.
- [ ] El backend se despliega **antes** que el frontend cuando hay endpoints nuevos.
- [ ] Las migraciones nuevas se corrieron en Supabase, **de a una y en orden**.
- [ ] `@supabase/supabase-js` sigue en la misma versión en los dos lados.
- [ ] El frontend se mergeó a `master` (hoy el trabajo vive en `Johan`).
- [ ] Este documento se actualizó si cambió el contrato entre los dos repos.
