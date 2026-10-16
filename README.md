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
| `npm run test:e2e` | Tests end to end (Playwright), en dos tandas: la web en el puerto 3100 (hace el build) y el resumen y Servicios del panel con datos de ejemplo en el 3101 (reutiliza ese build). `test:e2e:main` y `test:e2e:demo` corren cada una por separado (la segunda siempre arma el build antes) |
| `npm run db:generate` | Genera en `drizzle/` la migración SQL de los cambios hechos en `src/db/schema.ts` (la migración se sube al repo) |
| `npm run db:migrate` | Aplica las migraciones de `drizzle/` a la base de `DATABASE_URL` (Supabase); sin esa variable avisa en español y no hace nada. La base local (PGlite) se migra sola al abrirse. Todas las tablas llevan RLS activada y sin políticas (la Data API de Supabase no ve nada; la app se conecta como dueño de las tablas): toda tabla nueva termina en `.enableRLS()` en `src/db/schema.ts` y un test lo exige |
| `npm run db:seed:demo` | Carga en la base local (PGlite) 25 alumnos, unas 120 ventas y unos 750 clics en "Reservar" ficticios de los últimos 14 meses, para ver el resumen y Servicios con números. Se niega a correr si hay `DATABASE_URL`; se puede repetir (refresca las fechas) |
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
| Límites | 30 eventos por minuto por visitante, 200 por minuto y 2.000 por hora entre todos (pasado un tope global, descarte en silencio: acota lo que puede escribir quien rote IPs). Cada descarte global suma uno al día en `interest_drops` y la página Servicios dice "N clics descartados por exceso" si hubo en el período. El visitante es la IPv4 o el /64 de la IPv6 (una IPv4 escrita como `::ffff:a.b.c.d` cuenta como esa IPv4); ver `src/admin/interest/ip-key.ts` |
| Privacidad | Se guarda un HMAC de la clave del visitante con la fecha de Argentina (nunca la IP): el mismo visitante tiene otro hash cada día, así que las filas no se pueden vincular entre días ni con `login_attempts`. A medianoche el cupo por minuto vuelve a empezar |
| Retención | Los clics se borran a los 400 días (más que cualquier período que muestra el panel). La limpieza es oportunista: al guardar un clic, como mucho una vez por hora por proceso (`src/admin/interest/retention.ts`) |
| País | Del encabezado `x-vercel-ip-country`, solo si son dos letras mayúsculas |
| Conversión | En Servicios: ventas cobradas ÷ clics en "Reservar" del mismo período; vacía (—) sin clics. En Clase 1 a 1 cuentan también las ventas del pack de 4 clases (se pide desde ese botón; la fila lo aclara). Puede pasar de 100 %: también se vende por fuera del sitio |

### Tests del panel

`npm run test:e2e` arranca el servidor con una contraseña y un secreto de prueba (`tests/helpers/admin-server.ts`), una base PGlite vacía en una carpeta temporal que se borra al iniciar, y `EXCHANGE_RATE_SOURCE=fixed` (cotizaciones fijas, sin llamar al BCRA; en producción de Vercel esa variable se ignora). Cada test navega con su propia IP, así los bloqueos de uno no afectan a los otros.

Los tests que verifican totales (`tests/e2e/admin-overview.spec.ts` y `tests/e2e/admin-services-demo.spec.ts`) corren aparte, con `playwright.demo.config.ts`: un segundo servidor en el puerto 3101, con el mismo build y su propia base PGlite que se siembra con `buildDemoData(hoy en Argentina)` antes de arrancar (`src/admin/demo-data.ts`). Nadie escribe en esa base, así los números esperados salen de los mismos datos con las mismas funciones que usa la página. `npm run test:e2e:demo` arma el build y corre solo esa tanda; con `npm run test:e2e` el build lo arma la primera.

## Deploy (Vercel)

La web se despliega en Vercel como un proyecto Next.js, sin configuración especial.

Variables de entorno (Project Settings → Environment Variables):

| Variable | Qué hace |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Origen público del sitio, sin barra final (por ejemplo `https://tallami.com`). Define canonical, hreflang, Open Graph, `sitemap.xml` y `robots.txt`. Se lee en el build: si la cambiás, volvé a desplegar. |

Si `NEXT_PUBLIC_SITE_URL` no está definida (o está vacía), el build usa `https://${VERCEL_PROJECT_PRODUCTION_URL}`: el dominio de producción del proyecto (por ejemplo `tallami-coaching.vercel.app`), que Vercel define solo. Así los metadatos nunca apuntan a `localhost` en un deploy. Fuera de Vercel y sin ninguna de las dos, se usa `http://localhost:3000`.

Cuando el sitio tenga dominio propio, definí `NEXT_PUBLIC_SITE_URL` con ese dominio para que los buscadores vean la URL definitiva.
