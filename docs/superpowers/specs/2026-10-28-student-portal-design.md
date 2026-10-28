# Portal del alumno (cuentas y entregas)

Fecha: 28 de octubre de 2026. Primera de tres piezas que pidió Tallami para hacer todo desde la web: (1) cuentas de alumno y su página, (2) pagos en la web, (3) mensajes con él. Este documento es solo la pieza 1. Tallami eligió "todo desde la página" (no un canal de Discord por compra) y después pidió saltear las preguntas ("just start working on the site, make a plan if you need"): lo marcado **decisión del diseñador** no lo discutió.

## Para qué

Hoy Tallami vende por mensaje directo y carga las ventas a mano en su panel (`/admin`). Lo que entrega queda desparramado entre chats. Quiere que cada alumno tenga una cuenta en la web con todo lo que compró y todo lo que él le entregó, guardado para siempre, y que más adelante ahí mismo se pueda pagar y chatear.

## Lo que dijo Tallami

- Todo desde la página: usuarios que guardan sus cosas (y, en la pieza 3, chatean con él).
- Las entregas son "normalmente un video largo, de una hora" o "un PDF".
- Los videos los sube a **YouTube como "no listados"**; la web guarda el link (no aloja videos).
- Las llamadas no hacen falta: si quiere hablar en vivo, le pasa su Discord por el chat (pieza 3).

## Objetivos

1. Un alumno entra con su cuenta de **Discord o Google** y ve su página: lo que compró (servicio, fecha, estado, lo que pagó) y las entregas de cada compra.
2. Tallami, desde su panel, invita a un alumno al portal y le agrega entregas a cada venta: un link de YouTube o un PDF.
3. Nadie ve lo de otro alumno ni nada del panel (notas, facturas, pesos, cotizaciones).
4. El sitio público sigue estático y rápido; el portal está en los tres idiomas.

## No objetivos (piezas siguientes u otras)

- Pagar en la web (pieza 2: ahí la compra crea sola la cuenta y la venta).
- Mensajes con Tallami y avisos por email al alumno (pieza 3).
- Alojar videos en la web.
- Una cuenta con Discord y Google a la vez, editar el perfil, borrar la cuenta por su cuenta (lo hace Tallami a pedido desde el panel).

## Lo que sería un fracaso aunque funcione

- Que un alumno vea compras, entregas o datos de otro, o cualquier dato interno del panel.
- Que alguien entre como alumno sin pasar por Discord o Google (robar la sesión de otro, inventar una invitación, redirigir el ingreso a otro sitio).
- Que el portal toque la seguridad del panel (la sesión de alumno nunca sirve en `/admin` ni al revés).
- Que las páginas públicas dejen de ser estáticas.
- Que el portal guarde más datos de menores de los necesarios.

## Decisiones

### Cuentas e ingreso (decisión del diseñador)

- Ingreso con **OAuth 2.0** de Discord (scopes `identify email`) o Google (`openid email profile`), flujo *authorization code* con **PKCE y `state`** guardados en una cookie corta (10 minutos, `httpOnly`, `SameSite=Lax`, de un solo uso). Sin contraseñas. Implementación propia (o con la librería `arctic` si simplifica, a criterio del plan), siguiendo el patrón de sesiones en la base del panel; no Supabase Auth (el proyecto corre con PGlite local y tests sin red).
- Una cuenta = una identidad (proveedor + id del usuario en ese proveedor). Se guarda: proveedor, id, nombre para mostrar, email si el proveedor lo da y está verificado. Nada más (ni avatar, ni tokens del proveedor: se descartan después de leer el perfil).
- **Sesión del alumno:** token aleatorio en una cookie propia (`tallami_alumno`, `httpOnly`, `Secure` salvo http en localhost, `SameSite=Lax`, `path=/`), guardado en la base solo como hash; dura **30 días**; "Salir" la cierra en la base. Secreto propio (`PORTAL_SESSION_SECRET`) separado del panel. La cookie del panel (`path=/admin`) y la del alumno nunca se mezclan.
- Las rutas de ingreso (`/api/portal/auth/...`) solo vuelven a rutas del propio portal (nada de redirecciones abiertas).
- Ingreso de prueba: en tests y desarrollo, un proveedor OAuth falso local configurable por variable (ignorada en producción de Vercel, como `EXCHANGE_RATE_SOURCE` y `ADMIN_WEBAUTHN_ORIGIN`).

### Vínculo con el panel (decisión del diseñador)

- El portal muestra las ventas de un **alumno del panel** (`customers`). Una cuenta se vincula a un alumno con una **invitación**: en la ficha del alumno (`/admin/alumnos/[id]`), "Invitar al portal" genera un link de un solo uso que vence a los **14 días** (guardado como hash). Tallami se lo manda por donde hable con él. El alumno lo abre, entra con Discord o Google y queda vinculado.
- Un alumno del panel tiene como mucho una cuenta y una cuenta como mucho un alumno. Tallami puede ver en la ficha si está vinculado (con qué proveedor y nombre), generar otra invitación (anula la anterior) y **desvincular** (cierra las sesiones de esa cuenta). "Borrar cuenta del portal" borra la cuenta y sus sesiones (las ventas y entregas siguen en el panel).
- Una cuenta sin vincular ve un mensaje: "Tu cuenta todavía no está vinculada. Pedile a Tallami tu invitación." (pieza 2 vinculará sola al comprar).

### Página del alumno (decisión del diseñador)

- Ruta `/[locale]/portal` (`/es/portal`, `/pt/portal`, `/en/portal`), dinámica (lee la sesión); el resto del sitio sigue estático. Un enlace discreto "Portal de alumnos" en el pie del sitio.
- Muestra por compra: servicio (nombre traducido), fecha de cobro (o "pendiente de pago"), estado traducido (pendiente, pagada, entregada; las canceladas y reembolsadas también, marcadas), lo que pagó en la moneda de la venta, y sus entregas. **Nunca** notas, factura, pesos, dólares calculados, cotizaciones, medio de pago interno ni datos de otros.
- Entregas: título, fecha y:
  - **YouTube:** reproductor embebido con `youtube-nocookie.com` (sin cookies de YouTube hasta tocar play) y un link "Abrir en YouTube".
  - **PDF:** botón "Ver PDF" que lo abre desde una ruta del portal que verifica sesión y dueño.
  - **Link:** botón "Abrir" (pestaña nueva, `rel="noopener noreferrer"`) con el dominio visible.
- Estado vacío claro por compra ("Tallami todavía no subió entregas para esta compra") y para la cuenta sin compras.
- Cómoda en el celular; misma marca del sitio; accesible (axe sin violaciones serias ni críticas).

### Entregas desde el panel (decisión del diseñador)

- En la ficha de una venta (`/admin/ventas/[id]`), sección **Entregas**, con un título cada una; listar y borrar:
  - **YouTube:** se valida que sea `youtube.com/watch?v=…`, `youtu.be/…`, `youtube.com/live/…` o `youtube.com/shorts/…` y se guarda el id del video.
  - **PDF:** máximo **4 MB** (Vercel corta los pedidos de más de 4,5 MB; verificar en su documentación), se verifica que empiece con `%PDF-`.
  - **Link:** cualquier `https://` (por ejemplo un PDF grande en Google Drive) — para lo que pase de 4 MB o no sea video de YouTube. **Decisión del diseñador**, por el límite de Vercel.
- Los PDF se guardan en la **base** (una tabla aparte con los bytes) detrás de una interfaz de almacenamiento, para poder pasarlos a un almacenamiento de archivos más adelante sin tocar el resto. El README avisa el límite de la base gratuita de Supabase.
- El PDF se sirve con `Content-Type: application/pdf`, `Content-Disposition: inline`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, solo al alumno dueño (y a Tallami desde el panel).

### Base de datos

- Tablas nuevas con RLS (como todas): cuentas, identidades si hace falta separarlas, sesiones del portal, invitaciones, entregas y archivos. Migración generada con drizzle-kit.

### Configuración y guía

- Variables: `PORTAL_SESSION_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Sin las de un proveedor, ese botón no aparece; sin ninguna, el portal dice "todavía no disponible". Las URLs de vuelta salen de `NEXT_PUBLIC_SITE_URL`.
- README: cómo crear la app de Discord y el cliente de Google (pantalla de consentimiento, URL de vuelta), qué variables cargar en Vercel, y cómo invitar a un alumno y cargar entregas.

## Queda a criterio de quien lo construya

- Nombres de archivos, tablas y componentes; si usar `arctic` o `fetch` directo para OAuth.
- Diseño visual del portal dentro de la marca del sitio.
- Cómo se describe cada estado en los tres idiomas.
