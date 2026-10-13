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

La foto es opcional: sin foto, la franja muestra la inicial sobre un círculo azul.

## Deploy (Vercel)

La web se despliega en Vercel como un proyecto Next.js, sin configuración especial.

Variables de entorno (Project Settings → Environment Variables):

| Variable | Qué hace |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Origen público del sitio, sin barra final (por ejemplo `https://tallami.com`). Define canonical, hreflang, Open Graph, `sitemap.xml` y `robots.txt`. Se lee en el build: si la cambiás, volvé a desplegar. |

Si `NEXT_PUBLIC_SITE_URL` no está definida (o está vacía), el build usa `https://${VERCEL_PROJECT_PRODUCTION_URL}`: el dominio de producción del proyecto (por ejemplo `tallami-coaching.vercel.app`), que Vercel define solo. Así los metadatos nunca apuntan a `localhost` en un deploy. Fuera de Vercel y sin ninguna de las dos, se usa `http://localhost:3000`.

Cuando el sitio tenga dominio propio, definí `NEXT_PUBLIC_SITE_URL` con ese dominio para que los buscadores vean la URL definitiva.
