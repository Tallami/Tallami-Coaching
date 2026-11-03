# Pagos en la web con Mercado Pago

Fecha: 3 de noviembre de 2026. Segunda de las tres piezas que pidió Tallami para hacer todo desde la web: (1) cuentas de alumno y su página, hecha; (2) pagos en la web, este documento; (3) mensajes con él. Lo marcado **decisión del diseñador** no lo discutió Tallami y puede cambiarlo; lo demás lo dijo él.

La investigación legal que sostiene varias decisiones está en el doc "Tallami: legal terms and FAQ research" (https://claude.ai/artifact/76qjGsq1LQj6sJmFQRsYzK). Es investigación, no asesoramiento: un abogado tiene que revisarla antes de cobrar de verdad.

## Para qué

Hoy Tallami vende por mensaje directo y carga cada venta a mano en su panel. Quiere que el alumno toque un servicio, pague y listo: la venta aparece sola en el panel, con pesos y dólares, y la compra en la página del alumno. Además, para cobrarle a consumidores en Argentina la web tiene que cumplir reglas que hoy no cumple: precios en pesos, botón de arrepentimiento, canal de contacto, términos y privacidad.

## Lo que dijo Tallami

**El flujo**, aprobado tal cual:

1. El alumno toca un servicio y entra con Discord o Google si no entró.
2. Pantalla de confirmación: servicio, precio en dólares, lo que paga en pesos, casilla "soy adulto / paga un adulto".
3. Paga en Mercado Pago (la web nunca ve datos de tarjeta) y vuelve al portal.
4. Cuando Mercado Pago confirma: venta en el panel con pesos y dólares, compra en la página del alumno, email a Tallami.
5. Los reembolsos se hacen en Mercado Pago y la venta queda marcada reembolsada en el panel.
6. Temporada Pro no se paga por adelantado: "Aplicar" abre un formulario corto que cae en el panel. Tallami habla con ellos y, si encajan, genera un link de pago por USD 2.500 o el monto acordado.

**Proveedores:** Mercado Pago primero y solo él. Para Pix, Takenos más adelante (Tallami habla primero con ellos). PayPal y cripto, después. Hasta entonces, quien está en Brasil o México ve "escribime".

**Precios:** el precio de referencia es en dólares; los pesos los fija él con un valor "pesos por dólar" en el panel. Sin ese valor, el botón de pago queda apagado.

**Servicios** (`src/content/services.ts`): VOD review de 3 partidas USD 30, VOD review de torneo completo USD 60, VOD review en vivo USD 45, Plan de juego USD 120, Temporada Pro USD 2.500 por equipo.

**VOD offline:** el alumno le pasa códigos de replay y él los ve en el juego. El plazo corre desde que llegan los códigos: 72 horas para 3 partidas, 96 para el torneo completo.

**Reglas aceptadas:** edad mínima 13. Reembolso completo dentro de los 10 días salvo servicio ya entregado, en todos los países. Cada servicio cuenta como usado así: VOD de 3 partidas, torneo completo y plan, cuando la entrega está en el portal; VOD en vivo, cuando empieza la sesión; Temporada Pro, según el acuerdo de cada equipo. Sesión en vivo: se cambia gratis con 24 horas de aviso; más de 15 minutos tarde cuenta como usada; si falta Tallami, el alumno elige otra fecha o reembolso completo. Las compras sin usar vencen a los 150 días (Mercado Pago solo reembolsa hasta 180).

**No se muestra en la web:** CUIT, email ni dirección. El nombre no está excluido. Horario publicado de contacto: lunes a viernes, de 10 a 18, hora de Argentina.

## Objetivos

1. Un alumno en Argentina compra cualquiera de los cuatro servicios desde la web, sin que Tallami toque nada hasta tener que entregar.
2. Tallami ve cada venta en su panel, con pesos y dólares, y recibe un email.
3. Temporada Pro funciona por aplicación y link de pago.
4. La web cumple lo que la investigación marca como requisito para cobrar: pesos visibles, los dos botones, contacto con horario, términos, reembolsos y privacidad, en los tres idiomas.
5. Sumar Takenos, PayPal o cripto más adelante no obliga a rehacer nada de lo anterior.

## No objetivos

- Takenos, PayPal, cripto.
- Mensajes con Tallami (pieza 3).
- Reembolsar desde el panel: se hace en Mercado Pago.
- Facturar: Tallami factura a fin de mes como hoy, y el panel sigue mostrando lo pendiente de facturar.
- Suscripciones, cupones, cuotas, descuentos.
- El QR de Data Fiscal de ARCA y la línea "precio sin impuestos nacionales": dependen de lo que diga el contador. Se suman después si corresponde.
- Roles de Discord, agenda con Cal.com: quedaron afuera cuando Tallami eligió hacer todo desde la página. El párrafo "Pagos" del CLAUDE.md todavía los nombra y hay que corregirlo.

## Lo que sería un fracaso aunque funcione

- Cobrar un monto distinto del que se mostró en la pantalla de confirmación.
- Que un pago aprobado no llegue al panel, o que llegue dos veces.
- Que alguien marque un pedido como pagado falsificando un aviso, o cambiando el precio desde el navegador.
- Que un dato de tarjeta pase por la web.
- Que un alumno vea un pedido, una compra o códigos de replay de otro.
- Que la portada deje de ser estática y rápida.
- Que aparezca en la web un CUIT, un email o una dirección de Tallami.
- Que algún texto diga "sin reembolsos" o algo parecido: el derecho de arrepentimiento no se puede renunciar.
- Que un formulario público guarde de menores más datos de los necesarios o se llene de spam.

## Decisiones

### Pesos por dólar y precios en la web

- El panel (Configuración) suma el campo **Pesos por dólar**, en la tabla `settings`, con la fecha en que se guardó.
- **El precio en pesos se calcula** como dólares × valor, redondeado al peso entero, con la aritmética exacta de `src/lib/money.ts`. **Decisión del diseñador:** sin redondeos "lindos"; si Tallami quiere números redondos, ajusta el valor.
- **La portada muestra los dos precios, con el mismo tamaño:** "USD 30" y "ARS 45.000". La Resolución 4/2025 pide pesos, con dólares además; mostrarlos en los tres idiomas evita depender de adivinar el país. **Decisión del diseñador.** Sin valor cargado, solo dólares.
- **La portada sigue estática:** el valor se lee con caché y guardarlo en el panel la invalida (`cacheTag` y su invalidación; a verificar en la documentación de Next 16). Si no hay base en el momento de armar la página, se muestra como sin valor, sin romper. La pantalla de confirmación y el cobro leen siempre el valor directo de la base: lo que manda es esa pantalla.

### Cuándo se puede pagar

Se puede pagar si están las credenciales de Mercado Pago, el valor de pesos por dólar y un remitente de email de un dominio verificado (ver "Emails"). Si falta algo, los botones de servicio siguen llevando a la pantalla de confirmación, que dice que todavía no se puede pagar desde la web y ofrece el formulario de contacto. Así la portada no depende de ese estado.

### Del botón al pago

- Los botones de cada servicio (`bookingHref`) llevan a `/{idioma}/comprar/{servicio}`, con direcciones fijas en los tres idiomas: `vod-3-partidas`, `vod-torneo`, `vod-en-vivo`, `plan-de-juego`. Siguen avisando el clic anónimo de hoy. "Reservar" del encabezado sigue llevando a `#services`. **Decisión del diseñador.**
- **Pantalla de confirmación** (dinámica, sin indexar): servicio, qué incluye, dólares, pesos, casilla obligatoria de adulto, enlaces a términos, reembolsos y privacidad, y una línea para quien no está en Argentina que lleva al formulario de contacto.
- **Sin sesión**, la pantalla muestra lo mismo y ofrece entrar con Discord o Google. El ingreso existente (`src/portal/oauth/`) aprende a volver a esa pantalla: el destino viaja en la cookie del ingreso y solo puede ser una de estas pantallas, nunca una dirección libre.
- **Al pagar**, el servidor toma servicio, precio y valor de sus propias fuentes (nada del navegador salvo qué servicio y la casilla), crea el pedido, le pide a Mercado Pago un pago de Checkout Pro y redirige a la dirección que devuelve.
- En Mercado Pago: `items` con el monto en pesos y moneda `ARS`, `external_reference` con el id del pedido, `back_urls` hacia el portal, `auto_return: approved`, `statement_descriptor` reconocible y `payer.email` si se conoce.
- **Una sola cuota y sin pagos en efectivo con cupón (Rapipago, Pago Fácil).** La Resolución 4/2025 pide mostrar reglas de precio financiado, y un cupón puede quedar días pendiente con el valor del dólar ya vencido. **Decisión del diseñador**, fácil de abrir más adelante.
- **El pago de Mercado Pago vence a la hora** (`expires`, `expiration_date_to`), para que un pesos por dólar viejo no se cobre días después. **Decisión del diseñador.**

### Pedidos y proveedores

- **Una tabla de pedidos**, como pide el CLAUDE.md: proveedor, cuenta del portal, copia de nombre y email del comprador (por si la cuenta se borra), servicio, dólares, valor usado, pesos, estado, id del pago en el proveedor (único por proveedor), cuándo confirmó ser adulto, idioma, venta creada, y vencimiento.
- **Interfaz de proveedor** con lo mínimo que usa el resto: crear un pago y devolver la dirección a la que mandar al comprador, validar un aviso, y consultar un pago devolviendo un resultado normalizado (pedido, estado, monto, moneda, id, fecha). Nada fuera de `src/payments/` conoce a Mercado Pago, salvo la ruta del aviso.
- **Decisión del diseñador:** hablar con la API por `fetch` directo o con el SDK `mercadopago` queda a criterio de quien construye, pero la dirección base tiene que poder apuntar a un servidor falso en tests, igual que el OAuth falso del portal, ignorada en producción de Vercel.

### Aviso de Mercado Pago

- `POST /api/payments/mercadopago`, fuera del `proxy`. Valida `x-signature` (HMAC-SHA256 de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` con la clave secreta, comparando en tiempo constante): si no da, 401.
- **Nunca le cree al cuerpo del aviso:** consulta el pago en la API con el token privado. Comprueba que `external_reference` sea un pedido existente y que monto y moneda coincidan con el pedido. Si no coinciden, no crea venta y avisa a Tallami por email.
- El aviso se configura en "Tus integraciones" con los eventos de pagos y contracargos, para que llegue firmado. A verificar en la documentación vigente de Mercado Pago antes de construir.
- Responde rápido y con 200 a lo ya procesado. Los emails salen después de la respuesta (`after`).
- **Respaldo por si el aviso no llega:** cuando el alumno vuelve al portal con un pedido sin confirmar, la página consulta ese pago una vez y lo procesa con la misma función que el aviso. **Decisión del diseñador.**

### Qué pasa cuando se aprueba

En una sola transacción, con el pedido bloqueado para que dos avisos a la vez hagan una sola venta:

1. Si la cuenta no tiene alumno del panel, se crea (nombre, email, `discord` con el usuario de Discord si entró con Discord, país `AR` porque pagó en pesos con una cuenta argentina; Tallami lo puede corregir) y se vincula. Si ya tiene, se usa ese. **Decisión del diseñador.** Si la cuenta se borró, se crea el alumno con la copia del pedido.
2. Se crea la venta: moneda ARS, monto pagado, `arsPerUnit` 1, `arsPerUsd` el valor del pedido, `rateSource` `manual`, dólares los del pedido, `paymentMethod` `mercadopago`, estado `paid`, `paidOn` el día de aprobación en Argentina, `source` `mercadopago`, factura pendiente.
3. El pedido queda aprobado y apunta a la venta.

Después: email a Tallami (quién, qué, pesos, dólares, link a la venta) y email de confirmación al comprador si hay email (servicio, monto, nombre en el resumen de la tarjeta, link al portal, recordatorio de los 10 días). Los emails nunca hacen fallar el cobro, como los avisos de `src/admin/alerts/`. **El email al comprador es decisión del diseñador:** Mercado Pago lo recomienda para bajar contracargos.

### Cómo llega Tallami a quien compró

Hasta la pieza 3 no hay chat, y Tallami tiene que poder escribirle a quien compró. **Decisión del diseñador:**

- El ingreso con Discord guarda también el **usuario** de Discord (hoy solo el nombre para mostrar, con el que no se encuentra a nadie), en la cuenta y en el campo `discord` del alumno. Discord lo da siempre, y Google siempre da email: todo comprador tiene al menos una de las dos formas de contacto, sin pedirle nada más en la pantalla de confirmación.
- **Pendientes del panel suma "Por coordinar":** ventas cobradas de VOD en vivo y Temporada Pro sin fecha. Hoy "Sesiones" solo lista las que tienen fecha, y una venta recién pagada no aparecería en ningún lado.
- El plan de juego va en "Entregas por hacer", como hoy, sin fecha.

### Si quien compra ya estaba en el panel

Un alumno cargado a mano que compra antes de usar su invitación queda como alumno nuevo. **Decisión del diseñador:** no se busca coincidencia por email, porque abriría el historial de un alumno a quien tenga ese email en otra cuenta, y no se construye una herramienta para fusionar alumnos. La guía del README explica cómo arreglarlo a mano: pasar la venta al alumno original desde su formulario, desvincular y borrar el duplicado, e invitar a la cuenta.

### Otros estados del pago

- **Reembolsado:** la venta pasa a `refunded`. Si Tallami ya la había marcado, no cambia nada.
- **Reembolso parcial:** la venta sigue cobrada, se anota en sus notas y se avisa por email.
- **Contracargo o mediación (`in_mediation`, `charged_back`):** email a Tallami con el link a la venta. `charged_back` pasa la venta a `refunded`. **Decisión del diseñador.**
- **Rechazado, cancelado, vencido:** no hay venta. El alumno lo ve al volver y puede intentar de nuevo con un pedido nuevo.

### Códigos de replay

Tallami dijo que el plazo corre desde que llegan los códigos, y el chat todavía no existe. **Decisión del diseñador:**

- En el portal, cada compra de VOD de 3 partidas o de torneo completo muestra un campo "Códigos de replay" mientras no se cargaron.
- Al mandarlos se guarda el texto y la hora, `dueAt` queda en esa hora más 72 o 96 horas, y Tallami recibe un email. La compra ya aparece con fecha en "Entregas por hacer" del panel. Sin códigos, ahí mismo dice que faltan.
- El alumno ve hasta cuándo es la entrega. Puede corregir los códigos hasta que haya una entrega; corregirlos no mueve el plazo.
- A los 150 días sin códigos ni entrega, el campo se cierra y dice que la compra venció y que puede escribirle a Tallami. La venta no cambia sola: Tallami decide.
- Los códigos los ve solo el alumno dueño y Tallami. El panel los muestra en la ficha de la venta, fáciles de copiar.

### Página del alumno al volver

`/{idioma}/portal?compra=<id>`: el aviso solo aparece si el pedido es de esa cuenta. Dice que el pago se confirmó, que se está esperando la confirmación, o que no se pudo y puede intentar de nuevo. Sigue las reglas de `src/portal/page-state.ts`: un dato de la dirección nunca hace aparecer un aviso falso.

### Temporada Pro

- `/{idioma}/temporada-pro`: formulario corto, sin necesidad de entrar. Nombre, Discord para que él escriba, integrantes del equipo (nombres en el juego), mejores resultados, mensaje opcional, y casilla de que acepta la política de privacidad. **Decisión del diseñador:** los campos, y no pedir cuenta para aplicar.
- Con trampa para bots (`honeypot`) y límite por conexión, como `/api/interest`.
- En el panel, **Aplicaciones**: lista y ficha con estado (nueva, en charla, aceptada, rechazada) y email a Tallami por cada una nueva.
- En la ficha, **Generar link de pago**: monto en dólares, 2.500 por defecto y editable. El link es privado, de un solo uso, vence a los 14 días y se guarda como hash, igual que las invitaciones (`src/portal/invites.ts`). Tallami se lo manda por donde hable.
- El link abre la misma pantalla de confirmación, con ese monto y los pesos del momento. Al aprobarse el pago, la venta es `proSeason` del alumno que pagó.
- **Una aplicación puede tener varios links.** **Decisión del diseñador:** si el equipo paga en partes o cada integrante paga lo suyo, Tallami genera un link por pago, con el monto que acordaron; cada pago es una venta de quien pagó. La ficha muestra los links, cuáles se pagaron y el total cobrado. El estado de la aplicación lo cambia Tallami: el sitio no sabe cuánto acordaron en total.

### Lo legal en la web

**Páginas nuevas en los tres idiomas**, estáticas, con enlace en el pie: `/terminos`, `/reembolsos`, `/privacidad`. El texto se redacta a partir del esquema del doc legal y queda como borrador para el abogado.

- Identificación: el nombre de Tomás Allami ("Tallami"), sin CUIT, email ni dirección, hasta que el abogado diga cuál es el mínimo.
- Privacidad: lo que la web guarda de verdad, tablas del doc más lo que suma este diseño (pedidos, códigos, aplicaciones, pedidos de contacto).

**Formularios públicos**, sin entrar con cuenta, con trampa para bots y límite por conexión:

- **Botón de arrepentimiento** (`/arrepentimiento`) y **botón de baja** (`/baja`), con esos nombres exactos en el pie, visibles en todas las páginas. Piden nombre, email y qué compró (opcional, número de pedido). Al mandarlo se genera un código, el solicitante recibe por email una respuesta con ese código y Tallami un aviso. La Disposición 954/2025 pide esa respuesta en 24 horas, y sale automática.
- **Contacto** (`/contacto`): nombre, email, mensaje. Muestra el horario publicado. Llega a Tallami por email y al panel. Él contesta desde su correo, así que su dirección solo la ve quien le escribió.

**En el panel, Pedidos del sitio:** lista de arrepentimiento, baja y contacto con estado (nuevo, atendido) y borrar. **Decisión del diseñador.**

**Textos a cambiar en los tres idiomas:** las preguntas frecuentes (borrador del doc, redactando "te escribo para coordinar" en vez de nombrar el chat hasta que exista), `Services.payments` y los pasos de "Cómo funciona", que hoy prometen Pix, PayPal, cripto, link de agenda y rol de Discord.

### Emails

Hoy Resend solo le escribe a Tallami, y sin dominio verificado el remitente de prueba de Resend no le llega a nadie más. Los emails al público son una obligación (la respuesta con código) y no pueden fallar en silencio. **Decisión del diseñador:**

- Remitente propio para el público, en una variable aparte, de un dominio verificado en Resend: **sin él no se puede pagar** (ver "Cuándo se puede pagar"). No es el correo personal de Tallami, y a ese remitente no hace falta poder contestarle.
- El formulario de arrepentimiento y el de baja también muestran el código en pantalla.
- El panel muestra, en cada pedido del sitio, si el email salió. Si no salió, Tallami lo ve y puede contestar a mano.

### Cuánto se guarda

**Decisión del diseñador**, para que la política de privacidad diga algo cierto, y el abogado puede cambiarla:

- **Pedidos que no llegaron a pagarse:** se borran a los 90 días, con su copia de nombre y email, en la misma limpieza de pasada del portal.
- **Pedidos pagados y ventas:** se conservan. Tienen que sobrevivir a los contracargos (hasta 6 meses) y a lo que pida el contador.
- **Aplicaciones de Temporada Pro y pedidos del sitio:** Tallami los puede borrar desde el panel; lo que no borre se elimina a los 24 meses.

### Base de datos

Migración 0008, con RLS en todas las tablas: pedidos, aplicaciones de Temporada Pro, links de pago y pedidos del sitio. `sales` suma los códigos y su hora, y `portal_accounts` el usuario de Discord. El valor de pesos por dólar va en `settings`.

### Configuración y guía

- Variables: `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET` y el remitente para el público. La dirección de destino de los avisos es la de los avisos del panel.
- README, sección "Pagos": crear la aplicación en Mercado Pago, credenciales de prueba y de producción, configurar el aviso, verificar el dominio en Resend, cargar pesos por dólar, probar con usuarios de prueba, arreglar un alumno duplicado, y qué falta antes de cobrar de verdad (abogado, contador, cuenta).

### Pruebas

CLAUDE.md pide probar cada flujo de compra de punta a punta. Un servidor falso de Mercado Pago, como el OAuth falso, permite probar sin red: comprar cada servicio, aviso firmado, venta en el panel, compra en el portal, reembolso, firma inválida, monto que no coincide, aviso repetido, volver sin que llegara el aviso, códigos de replay, link de Temporada Pro usado dos veces, varios links en una aplicación, venta en "Por coordinar", email que no sale y formularios. Un alumno nunca ve lo de otro. Accesibilidad con axe en las pantallas nuevas.

La prueba con usuarios de prueba de Mercado Pago de verdad necesita la cuenta de Tallami y es parte de la guía.

## Queda a criterio de quien lo construya

- Nombres de archivos, tablas y componentes, y si usar el SDK o `fetch`.
- Diseño visual de las pantallas nuevas, dentro de la marca del sitio, y cómo se ven los dos precios en la portada, siempre con el mismo tamaño.
- Cómo se generan los códigos de los pedidos del sitio y cómo se guardan los textos legales (mensajes o archivos por idioma).
- La redacción de los textos en los tres idiomas, sin inventar datos ni resultados.
