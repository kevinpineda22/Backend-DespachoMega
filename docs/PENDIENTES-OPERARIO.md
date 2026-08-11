# Pendientes de backend surgidos del frontend del operario

Tareas de **backend** que el rediseño del frontend del operario dejó sobre la
mesa. Están acá y no en `PENDIENTES.md` para no mezclarlas con los pendientes
propios del backend: estas nacen del lado del operario y las consume el front.

El operario se rediseñó portando la piel y la UX del picker del ecommerce
(escáner de cámara, tarjetas, teclado en pantalla ON/OFF, toasts + haptics,
tabs, FAB de cierre, hero de marca, modal de cantidad, persistencia de sesión)
sobre este backend, **sin cambiar el contrato**. Re-verificadas contra el
backend al 10 ago 2026 (tras el avance del panel admin): siguen todas vigentes.

Convención: **[A]** alto, **[M]** medio, **[B-]** bajo.

---

## 1. [A] Cambio de contraseña en el primer ingreso — punto de enganche del front

Refuerza el `PENDIENTES.md §3`. El nuevo operario NO tiene ninguna vía de
autoservicio para cambiar su clave: entra con la temporal y ahí queda. Cuando se
implemente §3 (bandera `user_metadata.debe_cambiar_password` al crear el
usuario), el frontend del operario ya tiene el lugar natural para el redirect —
el `useEffect` que resuelve el perfil con `dmApi.yo()`. Falta que **`/yo`
devuelva la bandera** en su payload para que el front la lea; hoy no la expone
(verificado en `API.md` y en el código: no hay ningún manejo de primer login).

## 2. [M] Política de cancelar/reabrir un despacho desde el operario

`POST /despachos/:id/cancelar` ya existe y libera el número de factura. El
frontend del operario **a propósito no lo expone todavía**: si un operario abrió
la factura equivocada, hoy no puede deshacerlo solo. Es una **decisión de
negocio de admin**: ¿se le permite al operario cancelar su propio despacho en
curso, o eso lo hace el admin desde su panel? Según se decida, se agrega el botón
(el cliente `dmApi.cancelarDespacho` ya está listo) o se deja solo en el admin.

## 3. [B-] Historial propio del operario

El operario no puede ver sus despachos pasados. `GET /despachos` existe pero
`despacho.service.js → listar()` pasa los filtros tal cual, sin forzar el
`operario_id` del token. **Si se decide exponer "mis despachos" al operario, el
scoping tiene que ir del lado del servidor** (derivar `operario_id` del JWT, no
confiar en el query), coherente con la regla del módulo de que la identidad sale
del token. Mientras no se exponga, no hay riesgo.

## 4. CSP y cámara — sin acción, solo para que conste

El operario ahora usa el escáner de cámara (`html5-qrcode`, reutilizado del
ecommerce que ya está en producción). Usa `getUserMedia` (no hace red) y el
worker/wasm del decodificador, que la CSP actual ya permite porque el ecommerce
lo embarca. **No hay que tocar la CSP.** Solo requiere **HTTPS** (la cámara no
arranca en `http://` que no sea localhost), que en producción ya se cumple.

## 5. ~~Devolver una línea a pendientes~~ — RESUELTO (10 ago 2026)

Implementado: `POST /despachos/:id/items/:itemId/ajustar` con `{ cantidad }` (el
NUEVO total absoluto; 0 = devolver a pendientes). Service `ajustar()`, controller
`ajustar`, evento `item_ajustado`. El frontend ya tiene el botón **Devolver** en
las tarjetas completas y `dmApi.ajustarItem`. Ver `API.md`.

<details><summary>Contexto original</summary>

Hoy el operario puede sumar (`/validar`) pero **no hay
forma de bajar la cantidad de una línea ni de devolver un producto de la
"canasta" (completos) a pendientes**. Es un pedido concreto del operario: se
equivocó, escaneó de más, o quiere recontar.

Las únicas mutaciones son `validar` (suma), `finalizar`, `cancelar` (todo el
despacho) y `aprobar` (admin). Ninguna toca una línea hacia abajo.

**Propuesta de endpoint** (queda para el backend):

```
POST /despachos/:id/items/:itemId/ajustar
body: { cantidad: number }   // el NUEVO total absoluto de la línea (0 = devolver a pendientes)
```

- Valida ownership igual que `validar` (operario dueño o admin).
- Solo si el despacho está `en_proceso`.
- Setea `cantidad_validada = cantidad` (con tope en `cantidad_solicitada`),
  recalcula `estado_item` (`pendiente`/`parcial`/`completo`) y `items_validados`.
- Registra en `despacho_mega_escaneos` un movimiento de ajuste (o un evento en
  `despacho_mega_eventos`) para no perder la trazabilidad — bajar una cantidad es
  tan auditable como subirla.

El frontend ya tiene el lugar natural: un botón "Devolver" en la tarjeta de la
pestaña **Completos**, y `dmApi` sumaría un `ajustarItem(id, itemId, cantidad)`.

</details>

## 6. ~~Resolver un código sin mutar~~ — RESUELTO (10 ago 2026)

Implementado: `GET /despachos/:id/resolver?codigo=` → `{ pertenece, resultado,
codigo_item, item_id, factor, unidad }`. Service `resolver()`, controller
`resolver`. El frontend ahora resuelve el código (barra o ítem) y **abre el modal
de cantidad al escanear**, no solo al teclear el código del ítem. Ver `API.md`.

<details><summary>Contexto original</summary>

El operario nota una inconsistencia razonable: **tecleando el `codigo_item` se
abre el modal de cantidad** (el front lo matchea contra las líneas que ya tiene),
pero **escaneando/ingresando un código de BARRAS asociado, solo suma 1** y no
abre el modal.

La causa: el mapeo `código de barras → codigo_item` vive en el catálogo del
backend (`resolverCodigo` en `catalogo.repository.js`), y el front **no tiene los
EANs** de cada línea (la factura de Siesa trae `codigo_item`, no la lista de
barras). Así que el front no puede saber a qué producto abrir el modal.

**Propuesta de endpoint** (queda para el backend):

```
GET /despachos/:id/resolver?codigo=<barcode|codigo_item>
→ { codigo_item, descripcion, factor, unidad, pertenece: boolean }
```

Reusa `resolverCodigo` + el chequeo de si ese `codigo_item` está en la factura,
**sin escribir nada**. Con eso, el front resuelve el barcode a la línea y abre el
modal de cantidad como con el código de ítem, aplicando el `factor` en la suma.

Mientras no exista: el escaneo de barras suma de a 1 (correcto para escanear
unidad por unidad), y para cantidades el operario usa el botón **Contar** de la
tarjeta, que funciona con cualquier producto. En cuanto exista el endpoint,
unifico el comportamiento.

</details>
