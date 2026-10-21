# Seguridad del ingreso al panel de admin

Fecha: 21 de octubre de 2026. Pedido de Tallami: "quiero tener la máxima seguridad posible cuando la página esté online". Aprobó en el chat la propuesta: una llave de acceso (passkey) como segundo paso del ingreso, un aviso por email en cada ingreso, sesiones más cortas y un botón para cerrar todas las sesiones. Lo marcado como **decisión del diseñador** lo propuso el diseñador y Tallami lo aceptó en bloque ("me parece todo perfecto"), sin discutir cada punto.

## Para qué

El panel (`/admin`, ya construido: ver `2026-10-13-admin-dashboard-design.md`) muestra los ingresos de Tallami y los datos de sus alumnos, muchos de ellos menores. Hoy se entra con una sola contraseña y la sesión dura 12 horas. Cuando la web esté online, una contraseña robada (mail falso, otra web filtrada, alguien mirando) alcanzaría para entrar. Este trabajo hace que haga falta, además, un dispositivo físico de Tallami.

## Cómo lo usa Tallami (dicho por él)

- Entra desde tres dispositivos: **esta PC** (Windows de escritorio, puede no tener Bluetooth), **su celular** y **una notebook**.
- Abre el panel "un rato cada tanto para ir viendo cómo va todo" y, a fin de mes, una sesión más larga para facturar el total del mes.
- Viaja a torneos (Globals, Esports World Cup): tiene que poder entrar desde afuera de Argentina con sus dispositivos.

## Objetivos

1. Con la contraseña sola no se entra: hace falta además confirmar con una llave de acceso de uno de sus dispositivos (huella, cara o PIN del dispositivo).
2. Sumar y quitar dispositivos sin ayuda técnica, también una PC sin Bluetooth.
3. Recuperar el acceso si pierde todos sus dispositivos, sin abrir una puerta trasera para nadie más.
4. Enterarse en el momento de cualquier ingreso o cambio de seguridad (email).
5. Sesiones que se cierran solas cuando no las usa, y un botón para cerrar todas.

## No objetivos

- No reemplaza la contraseña: quedan los dos factores (contraseña + llave).
- Sigue habiendo un solo usuario, sin roles.
- No cambia nada del sitio público: `/es`, `/pt` y `/en` siguen estáticas y sin código del panel.
- No bloquea por país ni por IP (Tallami viaja).
- No protege contra quien controle sus cuentas de Vercel, Supabase, GitHub o su email: eso se resuelve con el segundo factor de esas cuentas, que el README le indica activar (ver "Guía").
- No usa SMS ni apps de códigos (TOTP): se pueden robar con un mail falso; la llave de acceso no.

## Lo que sería un fracaso aunque funcione

- **Quedar afuera para siempre:** perder los dispositivos (o cambiar el dominio de la web) y no tener cómo volver a entrar.
- **Volver a "solo contraseña":** que, con al menos una llave registrada, exista algún camino para entrar o para registrar una llave nueva con la contraseña sola. Quien robe la contraseña no debe poder sumar su propia llave.
- **Que el email rompa el ingreso:** si Resend falla o no está configurado, el ingreso funciona igual.
- **Que la PC de escritorio quede afuera** por no tener Bluetooth.
- **Que el sitio público cambie** o deje de ser estático.
- **Que sea molesto:** volver a entrar tiene que llevar unos segundos (contraseña + huella), no pasos de más.

## Decisiones

### Ingreso en dos pasos

1. `/admin/login`: contraseña, igual que hoy, con el mismo límite de intentos (5 fallidos por conexión cada 15 minutos, IPv6 por /64).
2. Contraseña correcta → **ingreso a medio camino**: un registro en la base de corta vida (5 minutos, un solo uso) atado a una cookie propia; no da acceso a ninguna página ni acción del panel. Lleva a `/admin/login/llave`.
3. `/admin/login/llave`: el navegador pide la llave (WebAuthn, `userVerification: "required"`). Llave válida y registrada → se crea la sesión completa y se manda el aviso por email.
4. **Primera vez (no hay ninguna llave registrada):** después de la contraseña, en lugar del paso 3 el panel obliga a registrar una llave en ese dispositivo antes de mostrar nada (`/admin/login/primera-llave`). Esa ventana (contraseña sola, sin llaves) solo existe hasta registrar la primera; se avisa por email.
5. Una llave fallida o cancelada cuenta como intento fallido para el límite de intentos.

Entrar desde un dispositivo sin su propia llave usando el celular (código QR + Bluetooth) lo resuelven el navegador y el sistema operativo: el panel solo tiene que permitir llaves de otros dispositivos (`hybrid`) al pedirla.

### Llaves de acceso

- WebAuthn con la librería **SimpleWebAuthn** (`@simplewebauthn/server` y `@simplewebauthn/browser`, versión estable actual; consultar su documentación, no la memoria). **Decisión del diseñador.**
- `rpID` y origen esperado fijos desde la configuración (el dominio de `NEXT_PUBLIC_SITE_URL` en producción; `localhost` en desarrollo y tests), nunca tomados del encabezado `Host` del pedido.
- `userVerification: "required"`, `attestation: "none"`, `residentKey: "preferred"`. Se guardan: id de la credencial (único), clave pública, contador, transportes, un nombre que Tallami elige ("Celular", "PC", "Notebook"; uno por defecto según el dispositivo), fecha de alta y de último uso.
- Los desafíos (challenges) se guardan del lado del servidor, de un solo uso y por 5 minutos.
- **Las llaves quedan atadas al dominio.** Si la web pasa de `*.vercel.app` a un dominio propio, las llaves anteriores dejan de servir y se usa la recuperación. El README lo explica y recomienda registrarlas con el dominio definitivo.

### Qué necesita cada dispositivo

- Una llave se crea y se usa con el desbloqueo del propio dispositivo. En el celular y la notebook, la huella, la cara o el PIN de siempre.
- En **la PC de escritorio** (Windows 10), el **PIN de Windows Hello**, que Windows ofrece sin hardware especial. El README explica cómo activarlo antes de registrar la llave.
- Si algún dispositivo no pudiera crear llaves, la alternativa es una **llave de seguridad USB** (FIDO2). Por eso el panel no restringe el tipo de autenticador (sin `authenticatorAttachment`).

### Sumar un dispositivo

Solo desde una sesión iniciada con llave (nunca con la contraseña sola):

- **Este dispositivo:** en Configuración → Seguridad, "Agregar una llave en este dispositivo".
- **Otro dispositivo sin llave, con Bluetooth:** se entra con contraseña + la llave del celular por código QR, y después se agrega la llave local desde Configuración.
- **Otro dispositivo sin Bluetooth (la PC de escritorio):** en un dispositivo con sesión, Configuración → "Código para otro dispositivo" genera un código de un solo uso, legible (por ejemplo 10 caracteres sin letras confusas), que vence a los 10 minutos y se guarda como hash. En el dispositivo nuevo: contraseña → "Tengo un código" → código → registra la llave ahí. Los códigos fallidos cuentan para el límite de intentos. **Decisión del diseñador.**

### Sesiones

- Pasan a guardarse en la base (tabla de sesiones: id aleatorio, alta, último uso, vencimiento, cierre, llave usada, descripción corta del dispositivo y navegador). Es lo que permite cerrarlas y listarlas.
- Se cierran solas a los **30 minutos sin uso** y como máximo a las **8 horas** del ingreso. **Decisión del diseñador** (uso "un rato cada tanto"; volver a entrar lleva segundos). "Uso" es cualquier pedido al servidor que pase por `requireAdmin()`: cargar o navegar una página del panel y cada acción. No hay "latido" que mantenga viva una pestaña quieta.
- **Nunca se pierde lo que estaba escribiendo** (**decisión del diseñador**, por el cierre de mes): Tallami marca ventas en Facturación, va a ARCA a hacer la factura y vuelve a cargar el número; ese ida y vuelta puede pasar los 30 minutos. Los formularios del panel (venta, alumno, marcar facturas, configuración) guardan lo que se va escribiendo en el almacenamiento de la pestaña del navegador (`sessionStorage`, se borra al cerrarla) y, si al enviar la sesión ya venció, después de volver a entrar el formulario aparece con lo escrito y el aviso "Tu sesión se cerró por inactividad: recuperamos lo que habías escrito, revisalo y guardá". Lo guardado se borra al guardar con éxito, al cerrar sesión y al cerrar todas las sesiones. Nunca se guardan contraseñas ni códigos.
- La cookie sigue firmada (JWT con el claim de la contraseña de hoy) y ahora lleva el id de la sesión. El `proxy` sigue haciendo solo la verificación criptográfica, sin consultar la base; `requireAdmin()` verifica además en la base que la sesión exista, no esté cerrada ni vencida, y no lleve más de 30 minutos sin uso, y actualiza el último uso (como mucho una escritura por minuto).
- **Confirmación reciente:** agregar, renombrar o borrar una llave, generar un código y cerrar todas las sesiones piden confirmar con la llave de nuevo si la última confirmación tiene más de 5 minutos.
- No se puede borrar la última llave (dejaría el panel en "solo contraseña"): para cambiarla, primero se agrega otra.
- "Cerrar sesión" cierra la sesión actual en la base. "Cerrar todas las sesiones" las cierra todas, incluida la actual.
- Configuración → Seguridad lista las sesiones abiertas (dispositivo, inicio, último uso).
- Cambiar la contraseña sigue cerrando todas las sesiones (claim de la contraseña).
- Los registros de sesiones, ingresos a medio camino, desafíos y códigos se borran solos pasado su uso (sesiones a los 30 días).
- Todas las tablas nuevas con RLS activada, como las existentes.

### Avisos por email

- Con **Resend** (ya previsto en el proyecto). Variables: `RESEND_API_KEY` y `ADMIN_ALERT_EMAIL`. Mientras no haya dominio propio se manda desde la dirección de prueba de Resend, que solo entrega al email de la cuenta de Resend: alcanza, porque el destinatario es Tallami (verificar en la documentación de Resend y explicarlo en el README).
- Se avisa: cada ingreso, primera llave registrada, llave agregada o borrada, código generado, todas las sesiones cerradas, y bloqueo por intentos fallidos (una vez por bloqueo, no por intento).
- Cada aviso dice qué pasó, fecha y hora de Argentina, dispositivo y navegador, y país (del encabezado de Vercel, si existe), con la frase "Si no fuiste vos: entrá y cerrá todas las sesiones, y cambiá la contraseña". Nunca incluye contraseñas, códigos ni enlaces para entrar.
- Se manda después de responder al navegador (sin demorar el ingreso); si falla se registra en los logs y nada más. Sin las variables, no se manda nada y Configuración → Seguridad dice "Avisos por email: sin configurar".

### Recuperación

- Si pierde todos los dispositivos, o cambia el dominio: `npm run admin:reset-passkeys`, corrido desde su compu con la `DATABASE_URL` de producción (la misma forma segura de cargarla que el README ya explica para `db:migrate`). Borra todas las llaves y cierra todas las sesiones; pide escribir una frase de confirmación; manda aviso por email si está configurado. El siguiente ingreso con contraseña vuelve al paso "primera llave". **Decisión del diseñador:** solo puede hacerlo quien tiene las credenciales de la base, que es solo Tallami.
- Localmente (PGlite) funciona igual, sin `DATABASE_URL`.

### Pantallas

- Login paso 2 (pedir la llave), con la opción "Tengo un código" y un texto corto de qué hacer si no tiene ningún dispositivo.
- Primera llave (registro obligatorio).
- Configuración → **Seguridad**: llaves (nombre, alta, último uso; renombrar, borrar), "Agregar una llave en este dispositivo", "Código para otro dispositivo", sesiones abiertas, "Cerrar todas las sesiones", estado de los avisos por email.
- Todo en español, con el estilo del panel, cómodo en el celular y con la misma calidad de accesibilidad que el resto (axe, teclado, foco visible).

### Guía (README, sección "Panel de admin")

- Cómo activar el PIN de Windows Hello en la PC, cómo registrar las llaves en los tres dispositivos, cómo usar el código, qué hacer si pierde uno o todos, y la nota del dominio.
- Configurar Resend (cuenta, clave, variables en Vercel).
- **Seguridad de las cuentas:** activar el segundo factor (idealmente llave de acceso) en GitHub, Vercel, Supabase y el email que las recupera; marcar las variables secretas como sensibles en Vercel. En Supabase, apagar el acceso por la API de datos si el proyecto no la usa (la web se conecta directo a la base), además de exigir conexión cifrada. Con enlaces a la documentación oficial, sin nombrar botones que no se pudieron verificar.

### Tests

- Los tests e2e usan el autenticador virtual de Chrome (WebAuthn de DevTools, disponible desde Playwright) para registrar y usar llaves; el ayudante de login de los tests existentes pasa a hacer los dos pasos.
- Cubrir como mínimo: contraseña sola no entra; con llaves registradas no se puede registrar otra sin sesión con llave o código; código de un solo uso y vencido; última llave no se borra; sesión vencida por inactividad y por máximo; cerrar todas; confirmación reciente; el email no rompe el ingreso cuando falla; el análisis de guardas cubre las acciones y rutas nuevas (las de login quedan exceptuadas como hoy, cada una con sus propias verificaciones).

### Notas para quien construya (de la revisión del documento)

- El `proxy` tiene que dejar pasar las páginas nuevas de `/admin/login/*` sin sesión, con las mismas reglas estrictas que hoy tiene `/admin/login`. Ninguna otra ruta del panel pasa sin sesión.
- Registrar la primera llave vuelve a comprobar "no hay ninguna llave" de forma atómica en el momento de guardarla, no solo al crear el ingreso a medio camino: así dos registros simultáneos no pueden sumar dos "primeras" llaves.
- `rpID` y el origen esperado admiten un valor de prueba por variable de entorno para los servidores de tests (puertos 3100 y 3101), ignorado en producción de Vercel como `EXCHANGE_RATE_SOURCE`.
- Los e2e que cambian estado global de seguridad (primera llave, borrar la última, cerrar todas, recuperación) corren en su propio servidor y base, en serie. Los demás e2e del panel entran con una llave registrada por adelantado, y el ayudante que hoy firma cookies de prueba pasa a crear también la fila de la sesión.

## Queda a criterio de quien lo construya

- Forma exacta de las tablas, nombres de archivos y componentes dentro de `src/admin/auth/` y `src/app/admin/`.
- Cómo se describe el dispositivo a partir del `user-agent` (algo corto y legible).
- Diseño de los emails (texto simple con un HTML mínimo).
- Si el "ingreso a medio camino" y los desafíos comparten tabla.
