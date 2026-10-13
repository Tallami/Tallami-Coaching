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
| `npm run test:e2e` | Tests end to end (Playwright): hace el build y sirve la web en el puerto 3100 |
| `npm run players:photo -- <usuario>` | Baja la foto de perfil de X de un jugador a `src/assets/players/` |
| `npm run tweets:record -- <id> [<id> …]` | Graba la respuesta de X de uno o más tweets en `tests/fixtures/tweets/` (necesita internet) |

La primera vez, Playwright necesita el navegador: `npx playwright install chromium`.

## Textos

Los mensajes viven en `messages/es.json`, `messages/pt.json` y `messages/en.json`. Los tres archivos tienen que tener exactamente las mismas claves (lo verifica `npm run test`).

## Contenido

### Sumar un tweet a "Reviews"

Son tweets reales de los jugadores que etiquetan a @tallami1. Para sumar uno:

1. Pegá su ID (el número al final del link, `x.com/<usuario>/status/<ID>`) en la lista de `src/content/tweets.ts`. El orden no importa: el muro va del tweet más nuevo al más viejo.
2. Corré `npm run tweets:record -- <ID>`. Graba la respuesta de X en `tests/fixtures/tweets/<ID>.json`; subí ese archivo junto con el cambio.
3. Corré `npm run test` y `npm run test:e2e`. El autor del tweet tiene que estar en la lista de jugadores y el texto tiene que etiquetar a @tallami1; si no, un test lo avisa.

Al construir la página, la web baja el texto, la imagen y el autor de cada tweet desde X y los refresca una vez por día. Si un tweet se borra o X no responde, esa tarjeta no aparece; si no carga ninguno, no hay sección ni link "Reviews" en el menú.

`TWEETS_FIXTURE_DIR` es una variable de entorno que cambia X por archivos grabados: con `TWEETS_FIXTURE_DIR=tests/fixtures/tweets`, la web lee `<carpeta>/<ID>.json` en lugar de pedirle los tweets a X. Así lo hace el build de `npm run test:e2e`, y por eso esos tests no dependen de internet. En producción no se define. `npm run tweets:record` también la respeta: si está definida, graba en esa carpeta.

### Sumar un jugador a "Trabajé con"

1. Corré `npm run players:photo -- <usuario>`: baja su foto a `src/assets/players/<usuario en minúsculas>.jpg`.
2. En `src/content/players.ts`, importá la foto y agregá una línea a la lista con el nombre de jugador (sin tag de equipo), el usuario de X y la foto. Escribila en una sola línea, como las demás.
3. Corré `npm run test` y `npm run test:e2e`.

La foto es opcional: sin foto, la franja muestra la inicial sobre un círculo azul.

## Deploy (Vercel)

La web se despliega en Vercel como un proyecto Next.js, sin configuración especial.

Variables de entorno (Project Settings → Environment Variables):

| Variable | Qué hace |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Origen público del sitio, sin barra final (por ejemplo `https://tallami.com`). Define canonical, hreflang, Open Graph, `sitemap.xml` y `robots.txt`. Se lee en el build: si la cambiás, volvé a desplegar. |

Si `NEXT_PUBLIC_SITE_URL` no está definida (o está vacía), el build usa `https://${VERCEL_PROJECT_PRODUCTION_URL}`: el dominio de producción del proyecto (por ejemplo `tallami-coaching.vercel.app`), que Vercel define solo. Así los metadatos nunca apuntan a `localhost` en un deploy. Fuera de Vercel y sin ninguna de las dos, se usa `http://localhost:3000`.

Cuando el sitio tenga dominio propio, definí `NEXT_PUBLIC_SITE_URL` con ese dominio para que los buscadores vean la URL definitiva.
