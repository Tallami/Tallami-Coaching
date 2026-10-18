# Tallami Coaching

Web oficial de coaching de Fortnite competitivo de Tallami. Next.js (App Router) con idiomas `/es`, `/pt` y `/en`.

## Requisitos

- Node 22.12 o superior (Next.js pide 20.9, pero Vitest 5 pide 22.12)
- npm

## Empezar

```bash
npm install
npm run dev
```

La web queda en http://localhost:3000 (redirige a `/es`, `/pt` o `/en` según el idioma del navegador).

## Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run build` | Build de producción |
| `npm run start` | Sirve el build de producción |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript sin emitir archivos (corré antes `npm run build` o `npx next typegen`) |
| `npm run test` | Tests unitarios (Vitest) |
| `npm run test:e2e` | Tests end to end (Playwright), en dos tandas: la web en el puerto 3100 (hace el build) y las pantallas del panel que se prueban con datos de ejemplo (resumen, Servicios, Facturación y la calidad de todo el panel: accesibilidad, scroll y teclado) en el 3101 (reutiliza ese build). `test:e2e:main` y `test:e2e:demo` corren cada una por separado (la segunda siempre arma el build antes) |
| `npm run db:generate` | Genera en `drizzle/` la migración SQL de los cambios hechos en `src/db/schema.ts` (la migración se sube al repo) |
| `npm run db:migrate` | Aplica las migraciones de `drizzle/` a la base de `DATABASE_URL` (Supabase); sin esa variable avisa en español y no hace nada. La base local (PGlite) se migra sola al abrirse. Todas las tablas llevan RLS activada y sin políticas (la Data API de Supabase no ve nada; la app se conecta como dueño de las tablas): toda tabla nueva termina en `.enableRLS()` en `src/db/schema.ts` y un test lo exige |
| `npm run db:seed:demo` | Carga en la base local (PGlite) 25 alumnos, unas 120 ventas y unos 750 clics en "Reservar" ficticios de los últimos 14 meses, para ver el resumen y Servicios con números. Se niega a correr si hay `DATABASE_URL`; se puede repetir (refresca las fechas). Con `npm run db:seed:demo -- --clear` los borra, y nada más |
| `npm run admin:password` | Genera el hash de la contraseña del panel (`ADMIN_PASSWORD_HASH`) y un secreto para las sesiones (`ADMIN_SESSION_SECRET`). Ver "Panel de admin" |
| `npm run players:photo -- <usuario>` | Baja la foto de perfil de X de un jugador a `src/assets/players/` |
| `npm run tweets:record -- <id> [<id> …]` | Guarda la respuesta de X de uno o más tweets en `src/content/tweet-snapshots/` y rehace su índice (necesita internet) |
| `npm run tweets:index` | Rehace `src/content/tweet-snapshots/index.ts` con los archivos que hay en esa carpeta (sin internet) |

El ícono de la web es el monograma de `src/app/icon.svg`. `apple-icon.png` y `favicon.ico` salen de ese SVG con `node scripts/build-icons.mjs`: se corre solo si cambia el SVG, y los resultados se suben al repo.

La primera vez, Playwright necesita el navegador: `npx playwright install chromium`.

## Textos

Los mensajes viven en `messages/es.json`, `messages/pt.json` y `messages/en.json`. Los tres archivos tienen que tener exactamente las mismas claves (lo verifica `npm run test`).

## Contenido

### Sumar un tweet a "Reviews"

Son tweets reales de los jugadores que etiquetan a @tallami1. Para sumar uno:

1. Pegá su ID (el número al final del link, `x.com/<usuario>/status/<ID>`) en la lista de `src/content/tweets.ts`. El orden no importa: el muro va del tweet más nuevo al más viejo.
2. Corré `npm run tweets:record -- <ID>`. Guarda la respuesta de X en `src/content/tweet-snapshots/<ID>.json` y rehace el índice de esa carpeta (`index.ts`, generado: no se edita a mano); subí esos archivos junto con el cambio.
3. Corré `npm run test` y `npm run test:e2e`. El autor del tweet tiene que estar en la lista de jugadores y el texto tiene que etiquetar a @tallami1; si no, un test lo avisa.

Para sacar uno: borrá su ID de la lista y su archivo de `src/content/tweet-snapshots/`, y corré `npm run tweets:index`.

Al construir la página, la web baja el texto, la imagen y el autor de cada tweet desde X y los refresca una vez por día. Cada tweet tiene una copia guardada en el repo (`src/content/tweet-snapshots/`), que se usa solo si X falla:

| X responde | Qué se muestra |
| --- | --- |
| El tweet | El dato en vivo |
| Que ya no existe (borrado o privado) | Nada: la tarjeta desaparece, aunque haya copia |
| Con error (red, tiempo agotado, error del servidor, límite de pedidos) | La copia guardada; si no hay copia, nada |

El log del build dice qué camino tomó cada tweet. Si ninguno se puede mostrar, no hay sección ni link "Reviews" en el menú.

`TWEETS_SOURCE=snapshots` es una variable de entorno que cambia X por las copias guardadas: la web usa solo `src/content/tweet-snapshots/` y no llama a X. Así lo hace el build de `npm run test:e2e`, y por eso esos tests no dependen de internet. En producción no se define. `npm run tweets:record` guarda en otra carpeta si se define `TWEET_SNAPSHOTS_DIR` (lo usan sus tests).

### Sumar un jugador a "Trabajé con"

1. Corré `npm run players:photo -- <usuario>`: baja su foto a `src/assets/players/<usuario en minúsculas>.jpg`.
2. En `src/content/players.ts`, importá la foto y agregá una línea a la lista con el nombre de jugador (sin tag de equipo), el usuario de X y la foto. Escribila en una sola línea, como las demás.
3. Corré `npm run test` y `npm run test:e2e`.

La foto es opcional: sin foto, la franja muestra la inicial sobre un círculo azul. Las tarjetas de "Reviews" usan esa misma foto (se busca al autor del tweet por su usuario de X) y, sin foto, las iniciales del autor: nunca el avatar de X.

## Panel de admin

El panel privado de Tallami vive en `/admin` (solo en español, fuera de los idiomas del sitio). Entra una sola persona, con una contraseña. No está enlazado desde el sitio público, lleva `noindex` y `robots.txt` lo bloquea.

### Dejarlo listo

1. Corré `npm run admin:password`: pide la contraseña (12 caracteres o más, sin mostrarla) e imprime dos variables, `ADMIN_PASSWORD_HASH` y `ADMIN_SESSION_SECRET`, en dos formatos.
2. Local: copiá las líneas de `.env.local` a un archivo `.env.local`. El hash lleva `$` y Next.js los expande como variables, por eso el script los imprime escritos `\$`: copiá esas líneas, no las de Vercel.
3. En Vercel (Project Settings → Environment Variables): pegá los valores de la sección "En Vercel", tal cual. Agregá también `DATABASE_URL` (Supabase, pooler de transacciones); en Vercel el panel no usa la base local. Volvé a desplegar.
4. Abrí `/admin`. Si falta algo, te lleva a `/admin/setup`, que dice qué variable falta (solo el nombre, nunca el valor).

Localmente entrá por `http://localhost:3000/admin`, no por la IP de tu red: la cookie de sesión lleva `Secure` en cualquier dirección que no sea `localhost`, y el navegador no la guarda sobre http.

### Usarlo en tu compu

Una vez que hiciste lo de "Dejarlo listo" (la contraseña y el secreto en `.env.local`):

1. Corré `npm run dev` y abrí `http://localhost:3000/admin`.
2. Entrá con tu contraseña.

No hace falta ninguna cuenta ni internet: el panel guarda todo en una base de datos que corre dentro de tu propia compu.

- **La base.** Se llama PGlite (es Postgres, pero adentro de Node) y vive en la carpeta `.data/pglite` del proyecto. La crea sola la primera vez que abrís el panel. Esa carpeta no se sube a GitHub: lo que cargues acá queda solo en esta compu. Para hacer una copia, cerrá el panel y copiá la carpeta.
- **Empezar de cero.** Cerrá `npm run dev`, borrá la carpeta `.data/pglite` y volvé a abrirlo: la base vuelve a crearse vacía.
- **Verlo con datos.** `npm run db:seed:demo` carga alumnos, ventas y clics ficticios ("Alumno de prueba 1", "Alumno de prueba 2"…) para que el resumen y los gráficos tengan números. Cerrá `npm run dev` antes de correrlo: la base local no admite dos programas a la vez. Se puede repetir las veces que quieras.
- **Sacar los datos de ejemplo.** `npm run db:seed:demo -- --clear` borra los alumnos, las ventas y los clics de ejemplo y nada más: lo que cargaste a mano, el monotributo y los clics reales quedan como están. Si cargaste una venta tuya a un alumno de ejemplo, ese alumno no se borra y el comando te avisa cuál es.

Estos dos comandos se niegan a correr si hay una `DATABASE_URL` definida: los datos de ejemplo nunca van a la base de Supabase.

### El día a día

| Pantalla | Qué ves |
| --- | --- |
| Resumen | Cuánto cobraste en el período que elijas contra el anterior, por mes, por servicio, por medio de pago y por país, lo que tenés pendiente (entregas, sesiones, ventas sin facturar) y cuánto del tope del monotributo llevás usado |
| Ventas | Todas las ventas, con filtros y búsqueda por alumno; desde acá cargás y editás ventas y exportás el CSV |
| Servicios | Cada servicio con sus ventas, ingresos, tendencia, clics en "Reservar" y conversión |
| Alumnos | Cada alumno con lo que compró y su historial; desde acá los cargás y los editás |
| Facturación | Lo cobrado que todavía no facturaste, lo cobrado y facturado mes a mes, el monotributo y el CSV para el contador |
| Configuración | La categoría del monotributo y su tope |

**Cargar una venta.** En "Ventas" tocá "Nueva venta" (o "Cargar una venta" en el Resumen). Elegí el alumno (uno que ya está o uno nuevo) y el servicio: el monto se completa con el precio de lista en dólares y lo podés cambiar. Completá la moneda (dólar, peso, real o USDT), el medio de pago, el estado y la fecha de cobro.

- **Tipo de cambio.** Con "Automático (BCRA)" el panel usa la última cotización oficial del día de cobro o de antes (si fue fin de semana o feriado, la del último día hábil). Con "Manual" escribís vos los pesos por dólar (y por real, si cobraste en reales). Si el BCRA no contesta, el formulario te pide el valor a mano y la venta se guarda igual. El USDT cuenta como dólar. Confirmá con tu contador qué tipo de cambio corresponde.
- **Estados.** "Pendiente" es una venta que todavía no cobraste; "Cobrada" y "Entregada" son ventas cobradas; "Cancelada" es una que no se concretó y "Reembolsada", una en la que devolviste la plata. Las ventas no se borran: si no se dio, pasala a cancelada o reembolsada y queda en el historial.
- **Qué cuenta como ingreso.** Solo las ventas "Cobrada" y "Entregada", y en el día de su fecha de cobro (no el día que entregaste ni el que facturaste). Las pendientes, canceladas y reembolsadas no suman en ningún número del panel, y una venta con fecha de cobro futura recién suma ese día.

**Marcar facturas.** El panel no emite facturas: vos las hacés en ARCA y acá anotás las que ya hiciste. En "Facturación", "Por facturar" lista lo cobrado que falta, agrupado por mes de cobro.

1. Elegí una venta, varias o un mes entero con las casillas.
2. Elegí el tipo de factura (C o E), escribí el número como figura en ARCA (por ejemplo `00003-00000045`) y la fecha de la factura (no puede ser de un día que todavía no llegó).
3. Tocá "Marcar como facturadas". Una misma factura puede cubrir varias ventas.

"No requiere factura" saca las ventas elegidas de la lista sin anotar ninguna factura (con más de 5 pide confirmar). Si te equivocaste, abrí la venta en "Ventas" y tocá "Volver a pendiente" (borra los datos de la factura y la podés marcar de nuevo; solo en ventas cobradas o entregadas). Una factura ya emitida en ARCA se anula allá, con una nota de crédito.

**Monotributo.** En "Configuración" cargá la categoría (de la A a la K), el tope anual en pesos y desde cuándo rige, copiándolos de la [tabla vigente de ARCA](https://www.arca.gob.ar/monotributo/categorias.asp). El panel suma lo cobrado en pesos en los últimos 12 meses (por fecha de cobro) y lo compara con el tope que cargaste: te dice qué porcentaje llevás usado y cuánto te queda. No consulta ARCA ni verifica nada, y **no es asesoramiento impositivo: confirmalo con tu contador**.

### CSV para el contador

Hay dos descargas: "Exportar para el contador" en Facturación (lo cobrado, por defecto los 12 meses del monotributo, que se puede filtrar por estado de factura) y "Exportar CSV" en Ventas (lo que muestran los filtros de la lista, con ventas de todos los estados). Si el archivo no se puede armar, el panel te devuelve a la pantalla con un aviso.

El archivo usa `;` como separador y coma decimal (`1234,56`), las fechas van como `dd/mm/aaaa` y viene en UTF-8 con BOM: se abre con doble clic en Excel en español, con los acentos bien. Tiene estas 19 columnas:

| Columna | Qué es |
| --- | --- |
| Fecha de cobro | El día que cobraste |
| Alumno | Su nombre |
| País | Código de 2 letras (AR, BR, MX…) |
| Servicio | Qué se vendió |
| Descripción | El detalle, para las ventas "Otro" |
| Moneda | En la que cobraste (USD, ARS, BRL, USDT) |
| Monto | Lo que cobraste, en esa moneda |
| Pesos | Lo cobrado, en pesos |
| Dólares | Lo cobrado, en dólares |
| Tipo de cambio | Pesos por unidad de la moneda cobrada (1 si cobraste en pesos): Monto × Tipo de cambio = Pesos |
| Cotización del dólar | Pesos por dólar: Pesos ÷ Cotización del dólar = Dólares |
| Fuente | De dónde salió el tipo de cambio: "BCRA (oficial)" o "cargado a mano" |
| Fecha de cotización | El día de la cotización oficial que se usó (puede ser anterior al cobro: fin de semana o feriado); vacía si lo cargaste a mano |
| Medio de pago | Mercado Pago, Pix, PayPal, cripto, transferencia, efectivo u otro |
| Estado | El de la venta (Cobrada, Entregada…) |
| Factura | "Sin facturar", "Facturada" o "No requiere" |
| Tipo | Tipo de la factura (C o E) |
| Número | Número de la factura |
| Fecha de factura | El día de la factura |

Un texto que empieza con `=`, `+`, `-` o `@` sale con un apóstrofo adelante: así Excel no lo toma por una fórmula.

Si Excel te cambia el formato de la columna "Número" (por ejemplo le saca los ceros de adelante), no abras el archivo con doble clic: en Excel andá a Datos → Desde texto/CSV, elegí el archivo y, en la vista previa, poné esa columna como "Texto" antes de cargar.

### Ponerlo en línea

Para que el panel funcione en internet (en Vercel) la base no puede ser la local: usa Supabase. Una sola vez:

1. **Crear la base.** En [supabase.com](https://supabase.com) creá un proyecto nuevo, con la región São Paulo (la más cercana a Argentina y Brasil).
2. **Copiar la conexión.** En el panel de tu proyecto de Supabase buscá la cadena de conexión del pooler de transacciones («Transaction pooler»); la guía oficial [Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres) dice dónde está y cómo se ve. Completá la contraseña de la base donde la cadena trae `[YOUR-PASSWORD]`. Es el valor de `DATABASE_URL`. Tiene que ser la del pooler de transacciones y no la conexión directa: la web corre en Vercel y abre muchas conexiones cortas.
3. **Crear las tablas.** En tu compu, en una terminal, definí esa variable solo para ese comando y corré `npm run db:migrate`: en PowerShell, `$env:DATABASE_URL="la cadena"; npm run db:migrate`; en Git Bash, `DATABASE_URL="la cadena" npm run db:migrate`. Si la contraseña tiene símbolos (`@`, `:`, `/`, `#`…) la cadena no funciona tal cual: cambiala por una sin símbolos. Hay que repetirlo después de cada migración nueva que se suba al repo (carpeta `drizzle/`); sin `DATABASE_URL` el comando avisa y no hace nada.
4. **Usar el rol dueño de las tablas.** La cadena del paso 2 entra como el usuario `postgres` (en el pooler se escribe `postgres.` y el código de tu proyecto), que es el dueño de las tablas: dejala así. Todas las tablas tienen la seguridad por filas (RLS) activada y sin políticas, para que la API pública de Supabase no vea nada; el dueño es el único que pasa, así que con otro rol el panel no podría leer ni escribir.
5. **Cargar las variables en Vercel.** En el proyecto, Settings → Environment Variables: las tres de "Dejarlo listo" (`ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET` y `DATABASE_URL`). Volvé a desplegar y entrá a `/admin`.

Dos protecciones más, que se hacen en los paneles de Vercel y Supabase:

- **Límite de pedidos para los clics (Firewall de Vercel).** Es la defensa de verdad contra alguien que le pegue sin parar a `POST /api/interest`: la app tiene sus propios topes, pero cada pedido descartado igual le da trabajo a la base. En el proyecto de Vercel, el Firewall permite crear una regla de límite de pedidos ("rate limiting"). La regla que conviene: que valga solo para el método `POST` en la ruta `/api/interest`, que cuente los pedidos por IP en una ventana de 60 segundos con un tope de 30 (lo mismo que el límite propio de la app por visitante) y que, al pasarse, conteste 429. Los pasos exactos, los planes en los que está disponible y lo que cuesta cambian con el tiempo: seguilos desde la [guía oficial de Vercel](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).
- **Vigilar el uso de la base (Supabase).** El panel guarda poco (ventas, alumnos y clics, que se borran a los 400 días), pero conviene enterarse si algo crece de más. Supabase muestra en su panel cuánto usa tu proyecto contra la cuota de tu plan; mirá ese uso de vez en cuando y activá los avisos que ofrezca. Dónde está y cómo se configura lo explica la guía oficial [Manage your usage](https://supabase.com/docs/guides/platform/manage-your-usage).

**Respaldo.** Según la [guía de backups](https://supabase.com/docs/guides/platform/backups) de Supabase, los planes pagos tienen una copia diaria de la base (en el plan Pro, de los últimos 7 días) y en el plan gratis hay que exportar los datos por tu cuenta cada tanto (por ejemplo con `supabase db dump`); revisá ahí qué incluye tu plan. Como ayuda extra, descargá el CSV de Ventas de vez en cuando y guardalo: tiene todas las ventas con sus montos y su factura (no es un respaldo completo: no trae los alumnos sin compras ni sus notas, ni los clics).

### Cómo se protege

| Qué | Cómo |
| --- | --- |
| Contraseña | Hash scrypt (`scrypt$N$r$p$sal$hash`, N=2^17, r=8, p=1: el primer perfil que recomienda OWASP) con comparación en tiempo constante. Para cambiarla: volvé a correr `npm run admin:password` y reemplazá `ADMIN_PASSWORD_HASH`; eso cierra todas las sesiones abiertas |
| Sesión | JWT HS256 firmado con `ADMIN_SESSION_SECRET`, audiencia `tallami-admin`, 12 horas. Cookie `tallami_admin`: `httpOnly`, `SameSite=Strict`, solo para `/admin`, y `Secure` siempre (excepto http sobre `localhost`). Lleva un claim corto (`pwv`, un HMAC del `ADMIN_PASSWORD_HASH` con el secreto, `src/admin/auth/password-claim.ts`): cambiar la contraseña o el secreto cierra todas las sesiones |
| Intentos | 5 fallidos por conexión cada 15 minutos (una IPv6 cuenta por su /64, como en los clics), guardados en la tabla `login_attempts` con la clave convertida en un hash (nunca la IP). Los registros se borran a los 30 días |
| IP del visitante | Primer valor de `x-forwarded-for`. En Vercel lo escribe Vercel y no se puede falsificar; fuera de Vercel lo manda el propio cliente, así que el límite solo es una defensa real detrás de Vercel |
| Doble verificación | El `proxy` (`src/proxy.ts`) manda a `/admin/login` a quien no tenga sesión válida; además cada página y cada Server Action del panel llama a `requireAdmin()` (`src/admin/auth/require-admin.ts`). Una página o acción nueva sin esa llamada queda abierta: es obligatoria |
| Redirecciones | `?next=` del login solo acepta rutas `/admin…` del mismo sitio |

### Interés por servicio (clics en "Reservar")

Los botones de reserva del sitio público (`BookingLink`, `src/components/home/booking-link.tsx`) avisan cada clic con `navigator.sendBeacon` a `POST /api/interest` y siguen siendo un enlace común: no cancelan nada, no agregan atributos al HTML y las páginas `/es`, `/pt` y `/en` siguen estáticas (el aviso solo sale al tocar, nunca al cargar). La página Servicios del panel (`/admin/servicios`) cuenta esos clics contra las ventas.

| Qué | Cómo |
| --- | --- |
| Cuerpo | JSON `{ item, locale }`: `item` de `INTEREST_ITEMS` (`src/admin/catalog.ts`, todo menos "Otro") y `locale` `es`, `pt` o `en`. Cualquier otro campo o valor es un 400; sin eco de lo recibido |
| Respuestas | `204` guardado (y también aceptado y descartado), `400` inválido, `413` más de 1 KB, `415` si el `Content-Type` no es `application/json` (el aviso del sitio siempre lo manda; así no entra un POST entre sitios sin CORS), `429` con `Retry-After: 60`, `405` otros métodos; siempre `Cache-Control: no-store` |
| Descartes (204 sin guardar) | Bots por `user-agent` (lista corta en `src/admin/interest/bots.ts`), tope global superado (por minuto o por hora; se cuenta por día y Servicios lo muestra), y sin `ADMIN_SESSION_SECRET` o sin base configurada: el sitio público nunca se rompe por esto |
| Límites | 30 eventos por minuto por visitante, 200 por minuto y 2.000 por hora entre todos (pasado un tope global, descarte en silencio: acota lo que puede escribir quien rote IPs). Cada descarte global suma uno al día en `interest_drops` y la página Servicios dice "N clics descartados por exceso" si hubo en el período. El visitante es la IPv4 o el /64 de la IPv6 (una IPv4 escrita como `::ffff:a.b.c.d` cuenta como esa IPv4); ver `src/admin/net/ip-key.ts`. Los topes son una red de seguridad: cada pedido descartado igual le da trabajo a la base, así que la defensa de verdad contra un abuso sostenido es la regla del Firewall de Vercel sobre `POST /api/interest` (ver "Ponerlo en línea") |
| Privacidad | Se guarda un HMAC de la clave del visitante con la fecha de Argentina (nunca la IP): el mismo visitante tiene otro hash cada día, así que las filas no se pueden vincular entre días ni con `login_attempts`. A medianoche el cupo por minuto vuelve a empezar |
| Retención | Los clics se borran a los 400 días (más que cualquier período que muestra el panel). La limpieza es oportunista: al guardar un clic, como mucho una vez por hora por proceso (`src/admin/interest/retention.ts`) |
| País | Del encabezado `x-vercel-ip-country`, solo si son dos letras mayúsculas |
| Conversión | En Servicios: ventas cobradas ÷ clics en "Reservar" del mismo período; vacía (—) sin clics. En Clase 1 a 1 cuentan también las ventas del pack de 4 clases (se pide desde ese botón; la fila lo aclara). Puede pasar de 100 %: también se vende por fuera del sitio |

### Tests del panel

`npm run test:e2e` arranca el servidor con una contraseña y un secreto de prueba (`tests/helpers/admin-server.ts`), una base PGlite vacía en una carpeta temporal que se borra al iniciar, y `EXCHANGE_RATE_SOURCE=fixed` (cotizaciones fijas, sin llamar al BCRA; en producción de Vercel esa variable se ignora). Cada test navega con su propia IP, así los bloqueos de uno no afectan a los otros.

Los tests que verifican totales o que necesitan tablas y gráficos con datos (`admin-overview`, `admin-services-demo`, `admin-billing-demo` y `admin-quality`, en `tests/e2e/`) corren aparte, con `playwright.demo.config.ts`: un segundo servidor en el puerto 3101, con el mismo build y su propia base PGlite que se siembra con `buildDemoData(hoy en Argentina)` antes de arrancar (`src/admin/demo-data.ts`). Nadie escribe en esa base, así los números esperados salen de los mismos datos con las mismas funciones que usa la página. `npm run test:e2e:demo` arma el build y corre solo esa tanda; con `npm run test:e2e` el build lo arma la primera.

`tests/e2e/admin-quality.spec.ts` recorre todas las pantallas del panel (también el login y la página de "falta configurar") a 375, 768 y 1440 px: axe sin violaciones serias ni críticas, sin scroll horizontal de la página, el menú lateral y el del celular con el teclado, y un recorrido con Tab que mide que todo lo que se puede enfocar tenga un aro visible con contraste de al menos 3:1.

Los tests unitarios (`npm run test`) crean cada base de prueba clonando una base ya migrada (`tests/helpers/db.ts`), y `vitest.config.ts` sube el tiempo máximo de cada test a 30 segundos: con la máquina cargada, abrir la base o lanzar un script tardaba más que los 5 segundos de Vitest aunque nada estuviera roto.

## Deploy (Vercel)

La web se despliega en Vercel como un proyecto Next.js, sin configuración especial.

Variables de entorno (Project Settings → Environment Variables):

| Variable | Qué hace |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Origen público del sitio, sin barra final (por ejemplo `https://tallami.com`). Define canonical, hreflang, Open Graph, `sitemap.xml` y `robots.txt`. Se lee en el build: si la cambiás, volvé a desplegar. |

Si `NEXT_PUBLIC_SITE_URL` no está definida (o está vacía), el build usa `https://${VERCEL_PROJECT_PRODUCTION_URL}`: el dominio de producción del proyecto (por ejemplo `tallami-coaching.vercel.app`), que Vercel define solo. Así los metadatos nunca apuntan a `localhost` en un deploy. Fuera de Vercel y sin ninguna de las dos, se usa `http://localhost:3000`.

Cuando el sitio tenga dominio propio, definí `NEXT_PUBLIC_SITE_URL` con ese dominio para que los buscadores vean la URL definitiva.
