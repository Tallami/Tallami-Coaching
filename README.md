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
| `npm run test:e2e` | Tests end to end (Playwright), en tres tandas: la web en el puerto 3100 (hace el build) junto con el servidor OAuth falso del portal en el 3110; las pantallas del panel que se prueban con datos de ejemplo (resumen, Servicios, Facturación y la calidad de todo el panel: accesibilidad, scroll y teclado) en el 3101 (reutiliza ese build); y la seguridad del ingreso (primera llave, códigos, sesiones, y la calidad de esas pantallas) en el 3102 (también reutiliza el build). `test:e2e:main`, `test:e2e:demo` y `test:e2e:security` corren cada una por separado (las dos últimas siempre arman el build antes) |
| `npm run db:generate` | Genera en `drizzle/` la migración SQL de los cambios hechos en `src/db/schema.ts` (la migración se sube al repo) |
| `npm run db:migrate` | Aplica las migraciones de `drizzle/` a la base de `DATABASE_URL` (Supabase); sin esa variable avisa en español y no hace nada. La base local (PGlite) se migra sola al abrirse. Todas las tablas llevan RLS activada y sin políticas (la Data API de Supabase no ve nada; la app se conecta como dueño de las tablas): toda tabla nueva termina en `.enableRLS()` en `src/db/schema.ts` y un test lo exige |
| `npm run db:seed:demo` | Carga en la base local (PGlite) 25 alumnos, unas 120 ventas y unos 750 clics en "Reservar" ficticios de los últimos 14 meses, para ver el resumen y Servicios con números. Se niega a correr si hay `DATABASE_URL`; se puede repetir (refresca las fechas). Con `npm run db:seed:demo -- --clear` los borra, y nada más |
| `npm run admin:password` | Genera el hash de la contraseña del panel (`ADMIN_PASSWORD_HASH`) y un secreto para las sesiones (`ADMIN_SESSION_SECRET`). Ver "Panel de admin" |
| `npm run admin:reset-passkeys` | Recuperación: borra todas las llaves de acceso del panel y cierra todas las sesiones, después de pedir que escribas `BORRAR LLAVES`. Ver "Guía de recuperación" |
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

El panel privado de Tallami vive en `/admin` (solo en español, fuera de los idiomas del sitio). Entra una sola persona, en dos pasos: la contraseña y una llave de acceso (la huella, la cara o el PIN de uno de sus dispositivos). No está enlazado desde el sitio público, lleva `noindex` y `robots.txt` lo bloquea.

### Dejarlo listo

1. Corré `npm run admin:password`: pide la contraseña (12 caracteres o más, sin mostrarla) e imprime dos variables, `ADMIN_PASSWORD_HASH` y `ADMIN_SESSION_SECRET`, en dos formatos.
2. Local: copiá las líneas de `.env.local` a un archivo `.env.local`. El hash lleva `$` y Next.js los expande como variables, por eso el script los imprime escritos `\$`: copiá esas líneas, no las de Vercel.
3. En Vercel (Project Settings → Environment Variables): pegá los valores de la sección "En Vercel", tal cual. Agregá también `DATABASE_URL` (Supabase, pooler de transacciones); en Vercel el panel no usa la base local. Volvé a desplegar.
4. Abrí `/admin`. Si falta algo, te lleva a `/admin/setup`, que dice qué variable falta (solo el nombre, nunca el valor).
5. Entrá con la contraseña. Como todavía no hay ninguna llave, el panel te pide registrar la primera en ese mismo dispositivo, **enseguida**: hasta que lo hagas, quien conozca la contraseña podría registrar la suya. Seguí "Entrar con contraseña y llave de acceso", más abajo.

Localmente entrá por `http://localhost:3000/admin`, no por la IP de tu red: la cookie de sesión lleva `Secure` en cualquier dirección que no sea `localhost`, y el navegador no la guarda sobre http. Las llaves de acceso también quedan atadas a la dirección donde se crean.

### Usarlo en tu compu

Una vez que hiciste lo de "Dejarlo listo" (la contraseña y el secreto en `.env.local`):

1. Corré `npm run dev` y abrí `http://localhost:3000/admin`.
2. Entrá con tu contraseña. La primera vez, el panel te pide registrar una llave en esta compu (la base local empieza sin llaves); es una llave aparte de las de la web en línea, que valen solo para su propia dirección.

No hace falta ninguna cuenta ni internet: el panel guarda todo en una base de datos que corre dentro de tu propia compu.

- **La base.** Se llama PGlite (es Postgres, pero adentro de Node) y vive en la carpeta `.data/pglite` del proyecto. La crea sola la primera vez que abrís el panel. Esa carpeta no se sube a GitHub: lo que cargues acá queda solo en esta compu. Para hacer una copia, cerrá el panel y copiá la carpeta.
- **Empezar de cero.** Cerrá `npm run dev`, borrá la carpeta `.data/pglite` y volvé a abrirlo: la base vuelve a crearse vacía (también sin llaves: la primera vez volvés a registrar una).
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
| Configuración | La categoría del monotributo y su tope; y, en Seguridad, tus llaves de acceso, el código para sumar otro dispositivo y las sesiones abiertas |

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
2. **Copiar las conexiones.** En Supabase abrí tu proyecto y tocá **Connect** (arriba de la página): ahí están las cadenas de conexión, y la guía oficial [Connecting to Postgres](https://supabase.com/docs/guides/database/connecting-to-postgres) explica cuándo sirve cada una. Completá la contraseña de la base donde la cadena trae `[YOUR-PASSWORD]`. Necesitás dos cadenas distintas, una para la web y otra para crear las tablas:
   - **Para la web** (es el valor de `DATABASE_URL` en Vercel): el pooler de transacciones («Transaction pooler», puerto `6543`). La web corre en Vercel y abre muchas conexiones cortas, que es para lo que sirve.
   - **Para crear las tablas** (solo se usa en tu compu, en el paso 3): la conexión directa («Direct connection», puerto `5432`), que es la que la guía de Supabase recomienda para las migraciones. La directa usa IPv6: si tu red es solo IPv4 y no conecta, usá en su lugar el pooler de sesión («Session pooler», también puerto `5432`). No uses el pooler de transacciones para migrar: no soporta las sentencias preparadas que usa `drizzle-kit`.
3. **Crear las tablas.** Abrí una terminal nueva solo para esto, con la cadena de migración del paso 2, y corré `npm run db:migrate`. En PowerShell:

   ```powershell
   $env:DATABASE_URL = Read-Host "Cadena de conexión"
   npm run db:migrate
   Remove-Item Env:DATABASE_URL
   ```

   En Git Bash:

   ```bash
   read -r -s -p "Cadena de conexión: " DATABASE_URL; export DATABASE_URL
   npm run db:migrate
   unset DATABASE_URL
   ```

   Pegá la cadena cuando te la pida (en PowerShell se ve en pantalla mientras la pegás) y cerrá la terminal al terminar. La variable dura hasta que la borrás o cerrás la terminal, no solo un comando: si en esa misma ventana corrieras después `npm run dev`, el panel local escribiría en la base de producción. Por eso la última línea la borra y por eso conviene usar una terminal que sea solo para esto. Pidiéndola con `Read-Host` o con `read -s` la cadena no queda escrita en el historial de comandos (escribirla en la línea del comando sí la deja: la contraseña de la base quedaría guardada en texto). Si la contraseña tiene símbolos (`@`, `:`, `/`, `#`…) la cadena no funciona tal cual: cambiala por una sin símbolos. Hay que repetirlo después de cada migración nueva que se suba al repo (carpeta `drizzle/`); sin `DATABASE_URL` el comando avisa y no hace nada.

   La conexión de la migración va siempre cifrada: `drizzle.config.ts` le agrega `sslmode=require` a la cadena (`src/db/migrate-url.ts`), la traiga o no y aunque diga `sslmode=disable`; si la cadena ya pide `verify-ca` o `verify-full`, se respeta. La conexión de la web también se cifra siempre, desde el código (`src/db/client.ts`).
4. **Usar el rol dueño de las tablas.** Las cadenas del paso 2 entran como el usuario `postgres` (en los poolers se escribe `postgres.` y el código de tu proyecto; en la conexión directa, solo `postgres`), que es el dueño de las tablas: dejalas así. Todas las tablas tienen la seguridad por filas (RLS) activada y sin políticas, para que la API pública de Supabase no vea nada; el dueño es el único que pasa, así que con otro rol el panel no podría leer ni escribir.
5. **Cargar las variables en Vercel.** En el proyecto, Settings → Environment Variables: las tres de "Dejarlo listo" (`ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET` y `DATABASE_URL`, esta última con la cadena del pooler de transacciones, no la de migración). Definí también `NEXT_PUBLIC_SITE_URL`: para el panel es obligatoria en producción. Tiene que ser la dirección exacta donde termina el navegador al abrir la web, con `https://` y sin barra final: si la web se abre tanto con `www` como sin `www` y una redirige a la otra, la que queda después de la redirección (por ejemplo `https://tallami.com`). Las llaves de acceso quedan atadas a esa dirección: en cualquier otra el panel avisa «Las llaves solo funcionan en…» y no las pide. Si no la definís, la dirección es la del dominio de producción que Vercel le da al proyecto, y ese dominio cambia en cuanto le agregás uno propio: en el siguiente despliegue todas las llaves dejan de servir y hay que recuperar el acceso con `npm run admin:reset-passkeys` (ver "Guía de recuperación"). Definila y volvé a desplegar antes de registrar la primera llave. Los avisos por email llevan tres variables más, opcionales (ver "Avisos por email").
6. **Acercar las funciones a la base.** Por defecto las funciones de Vercel corren en Washington D.C. (`iad1`), lejos de una base en São Paulo, y cada consulta suma demora de ida y vuelta. En el proyecto, Settings → Functions → «Function Regions», elegí São Paulo (`gru1`); la guía oficial [Configuring regions for Vercel Functions](https://vercel.com/docs/functions/configuring-functions/region) lo explica. Después volvé a desplegar y entrá a `/admin`.
7. **Elegir Node 22 o más.** El proyecto pide Node 22.12 o superior (`engines` en `package.json`). Vercel ofrece Node 22.x y 24.x (la 24 es la que usa un proyecto nuevo por defecto); si el tuyo quedó con una versión más vieja, cambiala en Settings → Build and Deployment, sección «Node.js Version» (guía oficial: [Supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)) y volvé a desplegar.

**Si ya tenías el panel en línea, de antes de las llaves de acceso,** actualizalo en este orden:

1. Corré `npm run db:migrate` (paso 3) *antes* de desplegar: la migración `0004_admin_login_security` crea las tablas de las sesiones, las llaves, los ingresos a medio camino y los códigos, y la `0005_admin_fk_indexes` les suma dos índices (para que borrar una llave o una sesión no recorra la tabla entera). Sin la primera, el ingreso del panel nuevo falla; el comando aplica las dos juntas.
2. Desplegá.
3. Contá con volver a entrar una vez: las cookies de sesión de antes dejan de valer (ahora cada sesión se guarda en la base).
4. Entrá con la contraseña y registrá la primera llave **enseguida** (hasta que lo hagas, quien conozca la contraseña podría registrar la suya). Hacelo con la dirección definitiva de la web y con `NEXT_PUBLIC_SITE_URL` ya definida (paso 5 de arriba; ver "La dirección de la web"): si después cambia, las llaves dejan de servir.

Tres protecciones más, que se hacen en los paneles de Supabase y Vercel:

- **Exigir SSL en la base (Supabase).** La web y el comando de migración ya cifran su conexión, pero la base también tiene que negarse a las que no vengan cifradas: por defecto Supabase las acepta. En Supabase, Database → Settings, sección «SSL Configuration», activá «Enforce SSL on incoming connections». Reinicia la base y hay unos minutos sin servicio: hacelo cuando no estés usando el panel. Los pasos oficiales están en la guía [SSL Enforcement](https://supabase.com/docs/guides/platform/ssl-enforcement). El cifrado que usa la app (`require`) protege contra quien mira el tráfico, pero no verifica que el servidor sea el de Supabase; esa verificación (`verify-full`) pide bajar el certificado raíz que ofrece esa misma sección y no está activada.
- **Límite de pedidos para los clics (Firewall de Vercel).** Es la defensa de verdad contra alguien que le pegue sin parar a `POST /api/interest`: la app tiene sus propios topes, pero cada pedido descartado igual le da trabajo a la base. En el proyecto de Vercel, el Firewall permite crear una regla de límite de pedidos ("rate limiting"). La regla que conviene: que valga solo para el método `POST` en la ruta `/api/interest`, que cuente los pedidos por IP en una ventana de 60 segundos con un tope de 30 (lo mismo que el límite propio de la app por visitante) y que, al pasarse, conteste 429. Los pasos exactos, los planes en los que está disponible y lo que cuesta cambian con el tiempo: seguilos desde la [guía oficial de Vercel](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).
- **Vigilar el uso de la base (Supabase).** El panel guarda poco (ventas, alumnos y clics, que se borran a los 400 días), pero conviene enterarse si algo crece de más. Supabase muestra en su panel cuánto usa tu proyecto contra la cuota de tu plan; mirá ese uso de vez en cuando y activá los avisos que ofrezca. Dónde está y cómo se configura lo explica la guía oficial [Manage your usage](https://supabase.com/docs/guides/platform/manage-your-usage).

**Respaldo.** Según la [guía de backups](https://supabase.com/docs/guides/platform/backups) de Supabase, los planes pagos tienen una copia diaria de la base (en el plan Pro, de los últimos 7 días) y en el plan gratis hay que exportar los datos por tu cuenta cada tanto (por ejemplo con `supabase db dump`); revisá ahí qué incluye tu plan. Como ayuda extra, descargá el CSV de Ventas de vez en cuando y guardalo: tiene todas las ventas con sus montos y su factura (no es un respaldo completo: no trae los alumnos sin compras ni sus notas, ni los clics).

### Entrar con contraseña y llave de acceso

Para entrar al panel hacen falta dos cosas: la contraseña y una **llave de acceso** (en inglés, *passkey*): tu huella, tu cara o el PIN de un dispositivo tuyo. Con la contraseña sola no se entra, y quien te robe la contraseña tampoco puede sumar su propia llave. La llave no sale del dispositivo y solo sirve en la dirección de la web donde la creaste.

**El ingreso, paso a paso.**

1. En `/admin/login` escribís la contraseña.
2. Si ya hay una llave registrada, tocás «Usar mi llave» y el dispositivo te pide la huella, la cara o el PIN. Listo: estás adentro. Entre la contraseña y la llave tenés 5 minutos; si se pasa, el panel te lo dice y volvés a empezar.
3. Si todavía no hay ninguna llave (la primera vez, o después de la recuperación), aparece una pantalla que dice «Registrá tu primera llave»: ponele un nombre (por ejemplo Celular, PC o Notebook) y tocá «Registrar mi llave». Hasta registrarla no ves nada del panel.

Una sesión se cierra sola a los 30 minutos sin usarla (volver a entrar lleva unos segundos) y, por más que la uses, a las 8 horas. Si se cierra justo cuando guardás un formulario, lo que estabas guardando se recupera al volver a entrar, en esa misma pestaña (queda en la memoria de la pestaña: si la cerrás, se pierde). Lo que escribiste sin guardar no se recupera.

**La PC de escritorio (Windows 10): activá el PIN de Windows Hello.** Tu PC no necesita huella, cámara ni Bluetooth: alcanza con el PIN de Windows Hello, que es la llave de esa PC. Si todavía no lo tenés, activalo antes de registrar la llave. La guía oficial de Microsoft, [Configure Windows Hello](https://support.microsoft.com/en-us/windows/security/configure-windows-hello) (está en inglés y aplica a Windows 10 y 11), explica cómo crearlo desde la configuración de tu cuenta de Windows.

**Registrar la llave de cada dispositivo.** Conviene registrar al menos dos (la PC y el celular, por ejemplo): si perdés uno, entrás con el otro.

- **El primero** (el que uses primero, por ejemplo la PC): después de la contraseña, «Registrá tu primera llave».
- **Otro dispositivo desde el que ya entraste:** en Configuración tocá «Abrir Seguridad», poné un nombre y tocá «Agregar una llave en este dispositivo».
- **El celular, la notebook o la PC sin Bluetooth: con un código.** Funciona siempre, en cualquier dispositivo que todavía no tenga llave:
  1. En un dispositivo donde ya entraste, andá a Configuración → Seguridad, sección «Código para otro dispositivo», y tocá «Generar un código». Es de 10 letras y números, vale 10 minutos y sirve una sola vez. No cierres la sesión de ese dispositivo hasta usarlo: el código muere con ella.
  2. En el dispositivo nuevo, abrí `/admin/login`, escribí la contraseña, tocá «Tengo un código», escribilo, tocá «Continuar» y después «Registrar la llave de este dispositivo».
- **Entrar desde un dispositivo sin llave, usando la del celular** (código QR): en el paso de la llave, cuando el navegador te ofrezca usar tu celular, elegilo, escaneá el código QR con la cámara del celular y confirmá con tu huella o tu PIN. El celular tiene que estar cerca, con Bluetooth e internet; la PC de escritorio sin Bluetooth no puede hacerlo: para ella, usá el código. Si querés que ese dispositivo tenga su propia llave, después tocá «Agregar una llave en este dispositivo».
- **Si un dispositivo no pudiera crear llaves,** una llave de seguridad USB (FIDO2) sirve: el panel no restringe el tipo de llave.

En Configuración → Seguridad ves las llaves (nombre, cuándo se creó y cuándo se usó por última vez), las sesiones abiertas y si los avisos por email están activos. Ahí mismo podés renombrar una llave o borrarla. La última llave no se puede borrar (dejaría el panel con la contraseña sola): para cambiarla, primero agregá otra. Agregar, renombrar o borrar una llave, generar un código y cerrar todas las sesiones piden confirmar de nuevo con tu llave si pasaron más de 5 minutos desde la última vez.

### Guía de recuperación

**Perdiste un dispositivo, pero todavía entrás con otro.** Entrá desde el otro, andá a Configuración → Seguridad y borrá la llave del dispositivo perdido: sus sesiones se cierran en el acto. Si no solo lo perdiste sino que te lo robaron, además tocá «Cerrar todas las sesiones» y cambiá la contraseña (`npm run admin:password`, ver "Dejarlo listo"). Cuando tengas el dispositivo nuevo, registrale una llave con un código.

**Perdiste todos los dispositivos, o cambió la dirección de la web.** Sin ninguna llave no se puede entrar, y eso es a propósito: el panel no tiene una puerta trasera. La recuperación se hace desde tu compu, con el comando `npm run admin:reset-passkeys`, y solo puede hacerla quien tiene las credenciales de la base de datos, o sea vos. Borra todas las llaves y cierra todas las sesiones. Después, entrar con la contraseña vuelve a pedirte la primera llave, como el primer día.

1. Conseguí la cadena de conexión de la base de producción. En Vercel no la vas a poder ver: si la guardaste como «Secret» (ver "Seguridad de tus cuentas"), Vercel no vuelve a mostrarla. Usá la que tengas en tu administrador de contraseñas o, si no, sacala de Supabase como en "Ponerlo en línea", paso 2: abrí tu proyecto, tocá **Connect**, copiá la cadena y completá la contraseña de la base donde dice `[YOUR-PASSWORD]`. Sirve la misma que usaste para crear las tablas, que es la indicada para un comando que corrés desde tu compu: la conexión directa («Direct connection») o, si tu red es solo IPv4, el pooler de sesión («Session pooler»). También sirve la del pooler de transacciones («Transaction pooler», la de la web): el comando abre la conexión como la web, sin sentencias preparadas, y hace todo dentro de una sola transacción corta, que ese pooler admite.
   Abrí una terminal nueva solo para esto y cargá esa cadena como `DATABASE_URL` de la misma forma segura que en "Ponerlo en línea", paso 3 (con `Read-Host` en PowerShell o `read -s` en Git Bash, para que la cadena no quede en el historial). En PowerShell:

   ```powershell
   $env:DATABASE_URL = Read-Host "Cadena de conexión"
   npm run admin:reset-passkeys
   Remove-Item Env:DATABASE_URL
   ```

   En Git Bash el comando no puede preguntar (Node no ve esa terminal como interactiva y se queda esperando), así que la frase se le manda con una tubería. Para ver primero sobre qué base va a actuar, sin borrar nada, mandale una frase cualquiera:

   ```bash
   read -r -s -p "Cadena de conexión: " DATABASE_URL; export DATABASE_URL
   echo "NO" | npm run admin:reset-passkeys
   ```

2. El comando te dice sobre qué base va a actuar (nunca muestra la contraseña). Fijate que diga «base remota de DATABASE_URL» y que el usuario sea `postgres.` seguido del código de tu proyecto de Supabase, el mismo que lleva la cadena que copiaste de **Connect**. El servidor solo no alcanza: los del pooler (`aws-0-…pooler.supabase.com`) son de una región, no de tu proyecto, y los comparten muchos proyectos. Con la conexión directa el usuario es solo `postgres` y el código del proyecto va en el servidor. Si dice «base local», no cargaste la cadena y borraría las llaves de la base de tu compu, no las de la web: cancelá.
3. Escribí `BORRAR LLAVES` y Enter. Cualquier otra cosa cancela y no se borra nada. En PowerShell escribila cuando el comando pregunte (también se puede mandar sin que pregunte: `"BORRAR LLAVES" | npm run admin:reset-passkeys`). En Git Bash, que no puede preguntar, mandala con la tubería y después borrá la variable:

   ```bash
   echo "BORRAR LLAVES" | npm run admin:reset-passkeys
   unset DATABASE_URL
   ```

4. Entrá a `/admin` con la contraseña y registrá una llave nueva **enseguida**: hasta que la registres, quien conozca la contraseña podría registrar la suya. (El panel manda un aviso por email cuando se registra la primera llave.)

El comando también manda el aviso por email «se borraron las llaves», pero solo si en esa misma terminal cargaste `RESEND_API_KEY` y `ADMIN_ALERT_EMAIL` igual que `DATABASE_URL`: no lee ningún archivo `.env`. Si no están, borra igual y te avisa que no mandó el email. Sin `DATABASE_URL`, el comando actúa sobre la base local de tu compu (PGlite), por si necesitás lo mismo en desarrollo; cerrá antes `npm run dev`, porque la base local no admite dos programas a la vez.

Si lo que perdiste es la contraseña, no las llaves: generá un hash nuevo con `npm run admin:password`, reemplazá `ADMIN_PASSWORD_HASH` en Vercel y volvé a desplegar (eso cierra todas las sesiones).

**Te llegó un aviso por email de algo que no hiciste.** Qué conviene hacer depende del aviso (cada email lo dice al final):

- **Primera llave** que no registraste: no tenés ninguna llave con la que entrar, así que no hay nada que cerrar desde el panel. Primero cambiá la contraseña (`npm run admin:password`, reemplazá `ADMIN_PASSWORD_HASH` en Vercel) y volvé a desplegar, así quien la conocía ya no puede entrar; después corré `npm run admin:reset-passkeys` y registrá la tuya **enseguida**. Si hacés la recuperación antes de cambiar la contraseña, quien la sabe puede registrar otra llave.
- **Llave agregada** que no agregaste: entrá, borrá esa llave en Configuración → Seguridad (sus sesiones se cierran en el acto) y cambiá la contraseña.
- **Se borraron las llaves** sin que corrieras el comando: alguien tiene las credenciales de la base de datos. Cambiá la contraseña de la base en Supabase y actualizá `DATABASE_URL` en Vercel, cambiá también la del panel, volvé a desplegar y registrá tu llave **enseguida**.
- **Se cerraron todas las sesiones** y no fuiste vos: entrá, revisá las llaves en Configuración → Seguridad y cambiá la contraseña.
- **Cualquier otro aviso** (ingreso, llave borrada, código generado, ingreso bloqueado): entrá, cerrá todas las sesiones y cambiá la contraseña.

**La dirección de la web.** Las llaves quedan atadas a la dirección donde se crearon. En producción esa dirección es la de `NEXT_PUBLIC_SITE_URL`, que para el panel es obligatoria: tiene que ser exactamente la dirección donde termina el navegador al abrir la web (después de la redirección entre `www` y la raíz, si la hay). Si no la definiste, la dirección es el dominio de producción del proyecto en Vercel (`algo.vercel.app`), que cambia al agregarle un dominio propio. Por eso:

- Registrá tus llaves con la dirección definitiva. Si la web pasa de `algo.vercel.app` a un dominio propio sin que `NEXT_PUBLIC_SITE_URL` lo diga, las llaves anteriores dejan de servir en el siguiente despliegue y hay que hacer la recuperación de arriba. Lo mejor es definir `NEXT_PUBLIC_SITE_URL` con el dominio propio y volver a desplegar antes de registrar la primera llave.
- Entrá siempre por esa dirección. Desde otra (por ejemplo la `www` si configuraste la raíz) el panel no pide la llave y avisa dónde sí funciona.
- Los deploys de vista previa de Vercel (los de cada rama o pull request) tienen otra dirección: no sirven para entrar al panel. Entrá siempre por la dirección de producción.
- Las llaves de tu compu (`localhost`) y las de la web en línea son distintas; cada una se registra donde se usa.

### Avisos por email (Resend)

El panel te manda un email en cada ingreso y en cada cambio de seguridad: primera llave, llave agregada o borrada, código generado, todas las sesiones cerradas, intentos fallidos que bloquean una conexión (uno por hora como mucho) y la recuperación de arriba. Dicen qué pasó, cuándo (hora de Argentina), desde qué dispositivo y de qué país, y qué hacer si no fuiste vos. Nunca llevan contraseñas, códigos ni enlaces para entrar. Si el email falla, o no está configurado, el ingreso funciona igual: el error queda en los logs de Vercel y nada más.

1. Creá una cuenta en [resend.com](https://resend.com) con **el mismo email donde querés recibir los avisos**.
2. Creá una clave de API desde la sección de claves de tu cuenta (la guía oficial [Manage API keys](https://resend.com/docs/dashboard/api-keys/introduction) lo explica).
3. En Vercel (Settings → Environment Variables) cargá `RESEND_API_KEY` (la clave) y `ADMIN_ALERT_EMAIL` (tu email), y volvé a desplegar. Para guardar la clave sin que se pueda volver a leer, marcala como secreta (ver "Seguridad de tus cuentas").
4. Abrí Configuración → Seguridad: tiene que decir «Avisos por email: activos» con tu email tapado a medias (`t***@gmail.com`). Si dice «sin configurar», falta una de las dos variables; si dice «configuración inválida», `ADMIN_ALERT_EMAIL` no es una dirección de email.

Mientras no tengas un dominio propio, los avisos salen de la dirección de prueba de Resend (`onboarding@resend.dev`), que solo entrega al email de tu cuenta de Resend (es la regla que explica [esta página de Resend](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)). Alcanza, porque el destinatario sos vos: por eso el paso 1 pide el mismo email. Para que salgan desde una dirección propia, verificá un dominio en Resend ([Verified Domains](https://resend.com/docs/dashboard/domains/introduction)) y cargá `ADMIN_ALERT_FROM` con una dirección de ese dominio, por ejemplo `Panel de Tallami <avisos@tu-dominio.com>`.

### Seguridad de tus cuentas

El panel protege la entrada al panel, pero no sirve de nada si alguien controla las cuentas donde vive: GitHub (el código), Vercel (las variables y el despliegue), Supabase (la base) y el email con el que se recuperan. Activá el segundo factor en las cuatro. Cuando se pueda, elegí una llave de acceso o una llave de seguridad y no un SMS, que se puede robar con un mensaje falso.

- **GitHub.** [Configuring two-factor authentication](https://docs.github.com/es/authentication/securing-your-account-with-two-factor-authentication-2fa/configuring-two-factor-authentication) (está en español): una app de códigos y, además, llaves de acceso o de seguridad.
- **Vercel.** [Two-factor Authentication](https://vercel.com/docs/two-factor-authentication): una app de códigos o una llave de acceso. Guardá los códigos de recuperación que te da.
- **Supabase.** [Multi-factor Authentication](https://supabase.com/docs/guides/platform/multi-factor-authentication) (es para tu cuenta de Supabase, no para los usuarios de una app): usa una app de códigos. Supabase no da códigos de recuperación y no puede devolverte la cuenta si perdés todos los factores: registrá un segundo factor de respaldo en otro dispositivo.
- **Tu email.** El que recupera todas las anteriores. Si es Gmail: [Turn on 2-Step Verification](https://support.google.com/accounts/answer/185839).

Y dos ajustes en los paneles de Vercel y Supabase:

- **Variables secretas en Vercel.** `ADMIN_SESSION_SECRET`, `DATABASE_URL` y `RESEND_API_KEY` no deberían poder leerse una vez guardadas. Al cargarlas, elegí el tipo «Secret» (antes se llamaba «Sensitive»): el valor queda guardado pero ya no se puede ver, solo reemplazar. Guardá los valores en un administrador de contraseñas: si después necesitás la cadena de la base en tu compu (para migrar o para la recuperación), la sacás de ahí o de Supabase, no de Vercel. La guía oficial es [Config and Secret environment variables](https://vercel.com/docs/environment-variables/sensitive-environment-variables).
- **Apagar la API de datos de Supabase.** El panel se conecta directo a la base (`DATABASE_URL`) y no usa la Data API (la API REST que Supabase publica por defecto). Si el proyecto no la usa para nada más, apagala: la sección «Disable the Data API» de [Securing your API](https://supabase.com/docs/guides/api/securing-your-api) explica cómo. Además, todas las tablas ya tienen RLS activada y sin políticas, así que aun prendida no ve nada. Y exigí la conexión cifrada en la base, como se explica en "Ponerlo en línea" («Exigir SSL en la base»).

### Cómo se protege

| Qué | Cómo |
| --- | --- |
| Contraseña | Primer paso del ingreso; sola no abre nada. Hash scrypt (`scrypt$N$r$p$sal$hash`, N=2^17, r=8, p=1: el primer perfil que recomienda OWASP) con comparación en tiempo constante. Para cambiarla: volvé a correr `npm run admin:password` y reemplazá `ADMIN_PASSWORD_HASH`; eso cierra todas las sesiones abiertas |
| Llave de acceso (segundo paso) | WebAuthn con SimpleWebAuthn (`src/admin/auth/ceremonies.ts` y `passkeys.ts`): `userVerification: "required"` (huella, cara o PIN del dispositivo), sin attestation, y contador de firma estricto (rechaza una llave repetida o clonada). Las llaves se guardan en la tabla `admin_passkeys` (id de credencial, clave pública, contador, nombre). El dominio (`rpID`) y el origen esperado salen siempre de la configuración del sitio (`src/admin/auth/webauthn-config.ts`), nunca del encabezado `Host`. Con al menos una llave registrada, ningún camino entra ni registra otra llave con la contraseña sola, y la última llave no se puede borrar |
| Ingreso a medio camino | Pasada la contraseña, el ingreso queda en una fila de `admin_pending_logins` (5 minutos, un solo uso) atada a su propia cookie (`tallami_admin_pending`, `httpOnly`, `SameSite=Strict`, solo para `/admin/login`). No da acceso a ninguna página ni acción del panel. El desafío de la llave dura 5 minutos y se usa una sola vez. La primera llave se registra una sola vez: la base lo comprueba al guardarla, así dos registros a la vez no pueden sumar dos "primeras" |
| Código para otro dispositivo | 10 caracteres de un alfabeto sin letras ni números que se confunden, vence a los 10 minutos, un solo uso, se guarda solo su hash (HMAC con una clave derivada de `ADMIN_SESSION_SECRET`). Hay uno vivo a la vez y muere con la sesión que lo generó. Un código incorrecto cuenta para el límite de intentos |
| Confirmación reciente | Agregar, renombrar o borrar una llave, generar un código y cerrar todas las sesiones piden confirmar de nuevo con la llave si la última confirmación tiene más de 5 minutos |
| Avisos por email | Resend (`src/admin/alerts/`): un email en cada ingreso y en cada cambio de seguridad, enviado después de responder al navegador. Un fallo queda en el log y nada más; nunca llevan contraseñas, códigos ni enlaces para entrar |
| Recuperación | `npm run admin:reset-passkeys` (`scripts/admin-reset-passkeys.ts`): corre fuera de la web, con las credenciales de la base, y pide escribir `BORRAR LLAVES`. En una sola transacción borra las llaves, cierra las sesiones y borra los ingresos a medio camino y los códigos. Ninguna página del panel lo llama |
| Sesión | Se guarda en la base (tabla `admin_sessions`, `src/admin/auth/sessions.ts`): se cierra sola a los 30 minutos sin uso y, por más que se use, a las 8 horas del ingreso; "Salir" la cierra en la base, así que la cookie vieja deja de valer. Los registros se borran a los 30 días. La cookie `tallami_admin` lleva un JWT HS256 firmado con `ADMIN_SESSION_SECRET`, audiencia `tallami-admin`, 8 horas, con el id de esa sesión. Cookie: `httpOnly`, `SameSite=Strict`, solo para `/admin`, y `Secure` siempre (excepto http sobre `localhost`). Lleva un claim corto (`pwv`, un HMAC del `ADMIN_PASSWORD_HASH` con el secreto, `src/admin/auth/password-claim.ts`): cambiar la contraseña o el secreto cierra todas las sesiones |
| Intentos | 5 fallidos por conexión cada 15 minutos (una IPv6 cuenta por su /64, como en los clics): cuentan la contraseña incorrecta, una llave inválida o de otra cuenta, y un código incorrecto o vencido. Se guardan en la tabla `login_attempts` con la clave convertida en un hash (nunca la IP). Los registros se borran a los 30 días |
| IP del visitante | Primer valor de `x-forwarded-for`. En Vercel lo escribe Vercel y no se puede falsificar; fuera de Vercel lo manda el propio cliente, así que el límite solo es una defensa real detrás de Vercel |
| Doble chequeo de la sesión | El `proxy` (`src/proxy.ts`) manda a `/admin/login` a quien no tenga una cookie de sesión válida (solo verifica la firma, sin consultar la base); además cada página y cada Server Action del panel llama a `requireAdmin()` (`src/admin/auth/require-admin.ts`), que verifica en la base que la sesión exista, no esté cerrada ni lleve más de 30 minutos sin uso, y anota el uso. Una página o acción nueva sin esa llamada queda abierta: es obligatoria. Un Server Action sin cookie válida (por ejemplo, con la pestaña abierta de un día para otro: la cookie dura 8 horas) no llega a la acción: el `proxy` contesta 401 con la redirección al ingreso que entiende el navegador de Next, y lo que se estaba cargando no se guarda. Si algo más falla, `src/app/admin/error.tsx` muestra una pantalla en español con "Volver a intentar" e "Ir al ingreso" |
| Redirecciones | `?next=` del login solo acepta rutas `/admin…` del mismo sitio |
| Conexión a la base | Siempre cifrada: `ssl: "require"` en `src/db/client.ts` (ninguna `DATABASE_URL` puede apagarlo) y `sslmode=require` en `drizzle.config.ts` para las migraciones. Hasta 5 conexiones por instancia de la función (`max: 5`), que se cierran a los 20 s sin uso (`idle_timeout`). No 1: el pooler de transacciones no admite que postgres.js mande varias consultas seguidas por la misma conexión, y con una sola conexión eso pasa en cuanto dos consultas coinciden (el porqué, en el comentario de `REMOTE_DB_OPTIONS`) |

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

Los servidores principal y de datos de ejemplo arrancan con 32 llaves de acceso de prueba ya registradas (`tests/helpers/seed-e2e-passkeys.ts`, con `npm run e2e:seed-passkeys`), y el navegador de los tests usa el autenticador virtual de Chrome (`tests/helpers/webauthn.ts`): cada test entra con contraseña y llave como Tallami (`loginAsAdmin`). Las claves privadas de esas llaves salen de un texto público, así que el comando que las carga se niega a tocar cualquier base que no esté en la carpeta temporal del sistema, donde viven todas las bases de los e2e.

Los tests que verifican totales o que necesitan tablas y gráficos con datos (`admin-overview`, `admin-services-demo`, `admin-billing-demo` y `admin-quality`, en `tests/e2e/`) corren aparte, con `playwright.demo.config.ts`: un segundo servidor en el puerto 3101, con el mismo build y su propia base PGlite que se siembra con `buildDemoData(hoy en Argentina)` antes de arrancar (`src/admin/demo-data.ts`). Nadie escribe en esa base, así los números esperados salen de los mismos datos con las mismas funciones que usa la página. `npm run test:e2e:demo` arma el build y corre solo esa tanda; con `npm run test:e2e` el build lo arma la primera.

Los tests que cambian la seguridad de todo el panel (registrar la primera llave, códigos para otro dispositivo, borrar llaves, cerrar todas las sesiones) están en un solo archivo, `tests/e2e/admin-security.spec.ts`, que corre con `playwright.security.config.ts`: un tercer servidor en el puerto 3102, con el mismo build y una base propia sin ninguna llave, un test después del otro (cada uno parte de lo que dejó el anterior). Al final del archivo están las verificaciones de calidad de esas pantallas (el paso de la llave, el registro con un código y Seguridad): axe, sin scroll horizontal y un recorrido con Tab que mide el aro de foco, a 375 y 1440 px. `npm run test:e2e:security` arma el build y corre solo esa tanda.

`tests/e2e/admin-quality.spec.ts` recorre todas las pantallas del panel (también el login y la página de "falta configurar") a 375, 768 y 1440 px: axe sin violaciones serias ni críticas, sin scroll horizontal de la página, el menú lateral y el del celular con el teclado, y un recorrido con Tab que mide que todo lo que se puede enfocar tenga un aro visible con contraste de al menos 3:1.

Los tests unitarios (`npm run test`) crean cada base de prueba clonando una base ya migrada (`tests/helpers/db.ts`), y `vitest.config.ts` sube el tiempo máximo de cada test a 30 segundos: con la máquina cargada, abrir la base o lanzar un script tardaba más que los 5 segundos de Vitest aunque nada estuviera roto.

## Portal del alumno

El portal es la página donde cada alumno ve lo que compró y todo lo que Tallami le entregó, guardado para siempre: `/es/portal`, `/pt/portal` y `/en/portal` (hay un enlace «Portal de alumnos» en el pie del sitio). El alumno entra con su cuenta de **Discord o Google**, sin contraseña. Vos lo manejás desde el panel: invitás al alumno desde su ficha y cargás las entregas desde la ficha de cada venta. El portal nunca muestra notas, facturas, pesos, cotizaciones ni nada de otros alumnos. Por ahora es solo para ver: pagar y escribirte desde la web vienen después.

Esta guía sigue a "Ponerlo en línea": da por hecho que ya tenés Supabase y Vercel andando y el panel en línea.

### Dejarlo listo

Una sola vez. Cada paso dice dónde hacerlo; los nombres de los menús de Discord, Google y Vercel cambian de vez en cuando, así que si algo no coincide con lo que ves en pantalla, mandan las guías oficiales que se linkean.

1. **Crear las tablas.** El portal suma tablas nuevas a la base (cuentas, sesiones, invitaciones, entregas y archivos: la migración `0006_student_portal`). **Antes de desplegar**, corré `npm run db:migrate` como en "Ponerlo en línea", paso 3 (en una terminal aparte y con la cadena de migración de Supabase). Sin las tablas el portal no puede cargar.
2. **Anotar las direcciones de vuelta.** Cuando el alumno autoriza el ingreso, Discord y Google lo mandan de vuelta a tu web. Esas dos direcciones salen de `NEXT_PUBLIC_SITE_URL` y hay que registrarlas en cada servicio, idénticas, letra por letra:
   - Discord: `https://<tu-dominio>/api/portal/auth/discord/callback`
   - Google: `https://<tu-dominio>/api/portal/auth/google/callback`

   `<tu-dominio>` es la dirección exacta donde termina el navegador al abrir la web, o sea `NEXT_PUBLIC_SITE_URL` (ver "Ponerlo en línea", paso 5): si la web abre con `www` y sin `www` y una redirige a la otra, la que queda después de la redirección. Con `https://` y sin barra al final. Si un alumno empieza el ingreso en otra dirección (por ejemplo en la `www` cuando la definitiva es la raíz), el sitio lo manda primero a `NEXT_PUBLIC_SITE_URL`, que es donde vuelven Discord y Google. Los despliegues de vista previa de Vercel (los de cada rama) tienen otra dirección que no está registrada, así que **en una vista previa no se puede entrar con Discord ni con Google**: probá el portal siempre en la dirección de producción.
3. **Crear la aplicación de Discord.**
   1. Entrá al [Developer Portal de Discord](https://discord.com/developers/applications) con tu cuenta y creá una aplicación nueva (por ejemplo «Tallami Coaching»).
   2. En la parte **OAuth2** de la aplicación están el *Client ID* y el *Client Secret*: copialos. Discord puede mostrar el secreto una sola vez, así que guardalo enseguida en tu administrador de contraseñas.
   3. En esa misma parte registrá como URL de vuelta (*redirect*) `https://<tu-dominio>/api/portal/auth/discord/callback`.
   4. No hace falta elegir permisos ahí: el sitio pide `identify` y `email` cada vez que alguien entra. La guía oficial es [OAuth2](https://docs.discord.com/developers/topics/oauth2).
4. **Crear el cliente de Google.**
   1. Entrá a la [consola de Google Cloud](https://console.cloud.google.com/) y creá un proyecto (por ejemplo «Tallami Coaching»).
   2. Configurá la pantalla de consentimiento, que es lo que ve el alumno cuando Google le pregunta si autoriza el ingreso: nombre de la aplicación, tu email de contacto, tipo de usuario **External** (cualquier cuenta de Google) y los permisos `openid`, `email` y `profile`. Los pasos están en [Configure the OAuth consent screen](https://developers.google.com/workspace/guides/configure-oauth-consent) (en inglés).
   3. Dejala publicada («In production»): mientras está en «Testing», Google la puede limitar a los usuarios de prueba que cargues. Qué cambia con cada estado lo explica [Manage App Audience](https://support.google.com/cloud/answer/15549945). Google pide verificar la aplicación solo cuando usa permisos sensibles o restringidos; estos tres son los básicos.
   4. Creá el cliente: en **Google Auth platform → Clients** elegí crear un cliente de tipo **Web application** y, en las direcciones de redirección autorizadas, poné `https://<tu-dominio>/api/portal/auth/google/callback`. Google exige `https` y que coincida exacto, y un cambio puede tardar entre 5 minutos y unas horas en aplicarse. Copiá el *Client ID* y el *Client secret* (el secreto puede verse una sola vez: guardalo en tu administrador de contraseñas). Guías oficiales: [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) y [Manage OAuth Clients](https://support.google.com/cloud/answer/15549257).
5. **Cargar las variables en Vercel.** En el proyecto, Settings → Environment Variables (como en "Ponerlo en línea", paso 5), en el entorno de producción. Guía oficial: [Environment variables](https://vercel.com/docs/environment-variables).

   | Variable | Qué poner |
   | --- | --- |
   | `PORTAL_SESSION_SECRET` | Un secreto propio del portal, de 32 caracteres o más y distinto de `ADMIN_SESSION_SECRET`. Generalo con `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` y pegá lo que imprime. Firma los ingresos a medio camino: si lo cambiás, quien estaba entrando en ese momento tiene que volver a empezar (las sesiones abiertas de los alumnos siguen) |
   | `DISCORD_CLIENT_ID` y `DISCORD_CLIENT_SECRET` | El *Client ID* y el *Client Secret* de la aplicación de Discord |
   | `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` | El *Client ID* y el *Client secret* del cliente de Google |

   Marcá como «Secret» `PORTAL_SESSION_SECRET`, `DISCORD_CLIENT_SECRET` y `GOOGLE_CLIENT_SECRET` (ver "Seguridad de tus cuentas"). El botón de un proveedor aparece solo si cargaste **las dos** variables de ese proveedor: podés empezar con Discord y sumar Google después. Sin `PORTAL_SESSION_SECRET` (o con uno de menos de 32 caracteres), o sin ningún proveedor completo, el portal dice «El portal todavía no está disponible» y no deja entrar a nadie. `.env.example` tiene las mismas variables, sin valores.
6. **Desplegar.** Volvé a desplegar: Vercel aplica las variables nuevas solo a los despliegues nuevos. Después, hacé la prueba de abajo.

### Probarlo después de desplegar

1. En una ventana privada, abrí `https://<tu-dominio>/es/portal`. Tiene que decir «Entrá a tu portal» con un botón por cada proveedor que cargaste.
2. Tocá «Entrar con Discord», autorizá y fijate que volvés a `/es/portal` **en la misma dirección** en la que empezaste, con «Hola, …» y tu nombre arriba. Como tu cuenta todavía no está vinculada a ningún alumno, vas a ver «Falta un paso». Tocá «Salir» y repetí con «Entrar con Google».
3. Si la página rebota entre la dirección con `www` y la sin `www`, o termina en otra distinta de la que abriste, `NEXT_PUBLIC_SITE_URL` no coincide con la dirección final: corregila y desplegá de nuevo (se lee en el build).
4. Si Discord o Google muestran un error de «redirect» (en Google, `redirect_uri_mismatch`), la dirección de vuelta registrada no es idéntica a la de arriba. Si el portal vuelve con «No pudimos completar el ingreso», revisá que el *Client ID* y el *Client Secret* de Vercel sean los del proveedor y volvé a desplegar.
5. Para ver el recorrido completo, creá en el panel un alumno de prueba, invitalo con tu propia cuenta (ver "Invitar a un alumno") y, si querés ver una compra, cargale una venta en estado «Pendiente»: no suma en ningún número del panel. El alumno de prueba queda en la lista de Alumnos.

### Invitar a un alumno

1. En el panel, abrí la ficha del alumno (Alumnos) y buscá la tarjeta **Portal del alumno**.
2. Elegí el **Idioma del link** (Español, Português o English): es el idioma en que el alumno abre el portal.
3. Tocá **Invitar al portal** y después **Copiar link**. El link se ve **una sola vez** (en la base queda solo una huella): si lo perdés, generá otro. Sirve para una persona y vence a los 14 días; si generás otro, el anterior deja de valer.
4. Mandáselo por donde hables con él. El alumno lo abre, toca «Entrar con Discord» o «Entrar con Google» **en esa misma página** (la invitación viaja con ese ingreso) y queda vinculado: ve «Listo, tu cuenta quedó vinculada.» y sus compras.

**Qué ve el alumno.** Cada compra con el nombre del servicio, la fecha de cobro (o «Pendiente de pago»), el estado, lo que pagó en la moneda de la venta y sus entregas, y un botón «Salir». Si todavía no tiene compras, lo dice; si entra con una cuenta que no está vinculada, ve «Falta un paso» y que te pida su invitación. Nunca ve notas, facturas, pesos, cotizaciones ni el medio de pago, ni nada de otros alumnos.

**Desvincular o borrar la cuenta.** Con la cuenta vinculada, la tarjeta muestra «Vinculado» con el proveedor y el nombre. Los dos botones piden confirmar:

- **Desvincular** cierra las sesiones de esa cuenta y el alumno deja de ver sus compras. La cuenta sigue existiendo y podés invitarlo de nuevo. Un alumno que ya tiene cuenta no se puede invitar otra vez hasta desvincularla: para pasar de Discord a Google, desvinculá y generá otra invitación.
- **Borrar cuenta del portal** borra la cuenta y sus sesiones. Las ventas y las entregas siguen en el panel.

### Cargar entregas

1. En el panel, abrí la venta (Ventas) y buscá la tarjeta **Entregas**.
2. Elegí el **Tipo**, escribí un **Título** (de 1 a 120 caracteres: lo que lee el alumno, por ejemplo «Review de tu partida del sábado»), completá lo que pide cada tipo y tocá **Agregar entrega**. El alumno la ve en su portal, dentro de esa compra, la próxima vez que lo abra. Cada entrega tiene **Abrir** y **Borrar** (pregunta antes; si era un PDF, borra también el archivo).

| Tipo | Qué cargás | Cómo lo ve el alumno |
| --- | --- | --- |
| Video de YouTube | El link del video (`youtube.com/watch`, `youtu.be`, `youtube.com/live` o `youtube.com/shorts`). Subilo como **no listado** ([Change video privacy settings](https://support.google.com/youtube/answer/157177)): no aparece en tu canal ni en las búsquedas, pero lo ve cualquiera que tenga el link | El video dentro de la página (con `youtube-nocookie.com`, que no deja cookies de YouTube hasta que toca «play») y «Abrir en YouTube» |
| PDF | Un archivo PDF de hasta 4 MB. Se verifica por su contenido que sea un PDF de verdad: cambiarle el nombre no alcanza | «Ver PDF», que lo abre solo si la sesión es del alumno dueño |
| Link | Cualquier dirección que empiece con `https://`, para lo que pase de 4 MB o no sea un video de YouTube. Si es de Google Drive, compartilo con «cualquiera con el link» ([Share and manage access](https://support.google.com/drive/answer/7166529)) | «Abrir», en una pestaña nueva, con el dominio a la vista |

Un video no listado lo puede ver cualquiera que reciba el link, tenga o no cuenta en el portal. Para algo que solo deba ver ese alumno, no uses ese tipo.

**Dónde se guardan los PDF.** En la base de datos (tabla `delivery_files`), no en un almacenamiento de archivos. Es lo más simple, pero ocupan el espacio de la base: el plan gratuito de Supabase incluye 500 MB (octubre de 2026; confirmalo en [precios](https://supabase.com/pricing)), y cómo se cuenta y qué pasa si te pasás lo explica [Understanding Database and Disk Size](https://supabase.com/docs/guides/platform/database-size) (el uso lo ves como en "Vigilar el uso de la base", más arriba). Cien PDF de 4 MB ya son 400 MB. Para PDF grandes o muchos, mejor un link de Google Drive. Los PDF también viajan en cada copia de seguridad de la base. El código los guarda detrás de una interfaz (`src/portal/files.ts`), así que más adelante se pueden pasar a un almacenamiento de archivos sin tocar el resto.

**Por qué el tope es de 4 MB.** El PDF viaja en el formulario del panel (una Server Action de Next.js), que por defecto acepta 1 MB. `next.config.ts` lo sube a 5 MB (`experimental.serverActions.bodySizeLimit`), pero ese límite vale para **todas** las Server Actions del sitio, no solo para esta, y Vercel corta con un error 413 los pedidos de más de 4,5 MB a una función ([Vercel Functions Limits](https://vercel.com/docs/functions/limitations)). Por eso el tope es 4 MB y no 5: lo que pase de 4 MB lo rechaza la acción con un aviso que manda a Drive.

### Qué se guarda de cada alumno

Al entrar con Discord o Google, la base guarda solo esto:

- el proveedor (Discord o Google) y el id del usuario en ese proveedor (un número interno, no su usuario);
- el nombre para mostrar que tiene en esa cuenta;
- el email, solo si el proveedor dice que está verificado;
- cuándo se creó la cuenta, cuándo entró por última vez y a qué alumno del panel está vinculada;
- una huella de su sesión (no la sesión misma): dura 30 días.

No se guarda el avatar, ni la contraseña (no hay), ni la IP, ni los permisos que da el proveedor: se descartan en cuanto se lee el perfil. Muchos alumnos son menores de edad, por eso se guarda lo mínimo. Las sesiones y las invitaciones que ya no sirven se borran al día siguiente, de pasada, cuando alguien entra. Al borrar la cuenta desde el panel se va todo lo de arriba.

La política de privacidad del sitio todavía no está escrita: queda para la investigación legal pendiente. Hasta entonces, el portal no guarda nada fuera de esta lista.

### Probarlo en tu compu

Solo para desarrollo: sin Discord ni Google, con un servidor OAuth falso que corre en tu compu (el mismo que usan los tests). La variable `PORTAL_OAUTH_TEST_ISSUER` activa un proveedor de prueba que deja entrar a quien elija un nombre: **no la cargues nunca en Vercel**. En producción de Vercel se ignora y el log avisa, pero igual no la pongas en ningún entorno de Vercel.

1. En `.env.local` (el archivo de "Dejarlo listo", en "Panel de admin") sumá `PORTAL_SESSION_SECRET=` con un secreto generado con el comando de arriba, y `PORTAL_OAUTH_TEST_ISSUER=http://localhost:3110`.
2. En una terminal aparte corré `node tests/helpers/mock-oauth-server.mjs` (el puerto 3110 sale de ahí; se cambia con `MOCK_OAUTH_PORT`). Se queda corriendo; Ctrl+C lo cierra.
3. Corré `npm run dev` y abrí `http://localhost:3000/es/portal` (por `localhost`, no por la IP de tu red). Aparece el botón «Entrar con la cuenta de prueba».
4. El servidor falso necesita saber quién entra. En el navegador, abrí la consola de las herramientas de desarrollo (F12) y escribí `document.cookie = "mock_oauth_student=ana; path=/"` (con letras minúsculas, números y guiones): entrás como «Alumno ana». Con otro nombre, entrás como otro alumno.
5. Tocá el botón: volvés a `/es/portal` con tu sesión. Para probar una invitación, generala en `http://localhost:3000/admin`, en la ficha de un alumno, y abrí el link.

### Cómo se protege el portal

| Qué | Cómo |
| --- | --- |
| Ingreso | OAuth 2.0 *authorization code* con PKCE (S256) y `state`, guardados en una cookie corta (`tallami_alumno_oauth`: `httpOnly`, `SameSite=Lax`, solo para `/api/portal/auth`, 10 minutos, un solo uso) firmada con una clave derivada de `PORTAL_SESSION_SECRET` (`src/portal/oauth/flow.ts`). Discord pide `identify email`; Google, `openid email profile` |
| Sesión | Cookie `tallami_alumno` (`httpOnly`, `SameSite=Lax`, `path=/`, `Secure` salvo http en `localhost`) con un token al azar de 32 bytes; la base guarda solo su SHA-256 (`portal_sessions`). Dura 30 días desde el ingreso, se use o no, y "Salir" la cierra en la base (`src/portal/sessions.ts`) |
| Separada del panel | Otra cookie, otra tabla y otro secreto: la sesión de un alumno no sirve en `/admin` ni la del panel en el portal |
| Invitación | Token de 32 bytes al azar, guardado como hash, 14 días, un solo uso. Solo se canjea si el ingreso empezó en la página del portal del propio sitio: un link de otro sitio no puede hacer que la cuenta de otro alumno la consuma (`src/portal/invites.ts`) |
| Direcciones | Después de entrar solo se vuelve a `/{es,pt,en}/portal`. Si el ingreso con Discord o Google empieza en una dirección que no es `NEXT_PUBLIC_SITE_URL`, se lo manda ahí antes de empezar, porque la cookie del ingreso tiene que quedar donde vuelve el proveedor |
| Datos | Lo que sale hacia la página del alumno pasa por un tipo de datos propio con campos explícitos (`src/portal/purchases.ts`): nunca la fila entera de una venta |
| PDF | `/api/portal/files/<id>` lee la sesión y busca la entrega solo entre las compras de ese alumno; si no es suya, no existe o no hay sesión, contesta lo mismo (404 sin cuerpo). Se sirve con `Content-Type: application/pdf`, `Content-Disposition: inline`, `Cache-Control: private, no-store` y `X-Content-Type-Options: nosniff` |
| La página | `/[idioma]/portal` es dinámica (lee la sesión) y manda `Referrer-Policy: same-origin` y `noindex`: el link de una invitación lleva su token en la dirección y no sale hacia otros sitios. El resto del sitio sigue estático |
| Base | Las tablas del portal tienen RLS activada y sin políticas, como todas |

### Tests del portal

`npm run test` y `npm run test:e2e` cubren el portal sin salir a internet: el e2e arranca el servidor OAuth falso (puerto 3110) y el proveedor de prueba habla con él, nunca con Discord ni con Google. Los e2e del portal están en `tests/e2e/portal-*.spec.ts` (ingreso, invitaciones, entregas del panel y la página del alumno). `tests/unit/readme-portal-guide.test.ts` mantiene esta guía igual al código: las variables, las direcciones de vuelta, la migración y el comando del secreto.

## Deploy (Vercel)

La web se despliega en Vercel como un proyecto Next.js, sin configuración especial.

Variables de entorno (Project Settings → Environment Variables):

| Variable | Qué hace |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Origen público del sitio, sin barra final (por ejemplo `https://tallami.com`). Define canonical, hreflang, Open Graph, `sitemap.xml` y `robots.txt`. Se lee en el build: si la cambiás, volvé a desplegar. También es la dirección a la que quedan atadas las llaves de acceso del panel: si cambia, dejan de servir (ver "La dirección de la web"). |

Las variables del portal del alumno (`PORTAL_SESSION_SECRET`, `DISCORD_*` y `GOOGLE_*`) se cargan como dice "Portal del alumno" → "Dejarlo listo". Las direcciones de vuelta de Discord y Google salen de `NEXT_PUBLIC_SITE_URL`.

Para el panel en producción `NEXT_PUBLIC_SITE_URL` es obligatoria (ver "Ponerlo en línea", paso 5). Si no está definida (o está vacía), el build usa `https://${VERCEL_PROJECT_PRODUCTION_URL}`: el dominio de producción del proyecto (por ejemplo `tallami-coaching.vercel.app`), que Vercel define solo. Así los metadatos nunca apuntan a `localhost` en un deploy. Fuera de Vercel y sin ninguna de las dos, se usa `http://localhost:3000`.

Cuando el sitio tenga dominio propio, definí `NEXT_PUBLIC_SITE_URL` con ese dominio para que los buscadores vean la URL definitiva, y hacelo antes de registrar las llaves de acceso del panel.
