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

La primera vez, Playwright necesita el navegador: `npx playwright install chromium`.

## Textos

Los mensajes viven en `messages/es.json`, `messages/pt.json` y `messages/en.json`. Los tres archivos tienen que tener exactamente las mismas claves (lo verifica `npm run test`).

## Deploy (Vercel)

La web se despliega en Vercel como un proyecto Next.js, sin configuración especial.

Variables de entorno (Project Settings → Environment Variables):

| Variable | Qué hace |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Origen público del sitio, sin barra final (por ejemplo `https://tallami.com`). Define canonical, hreflang, Open Graph, `sitemap.xml` y `robots.txt`. Se lee en el build: si la cambiás, volvé a desplegar. |

Si `NEXT_PUBLIC_SITE_URL` no está definida (o está vacía), el build usa `https://${VERCEL_PROJECT_PRODUCTION_URL}`: el dominio de producción del proyecto (por ejemplo `tallami-coaching.vercel.app`), que Vercel define solo. Así los metadatos nunca apuntan a `localhost` en un deploy. Fuera de Vercel y sin ninguna de las dos, se usa `http://localhost:3000`.

Cuando el sitio tenga dominio propio, definí `NEXT_PUBLIC_SITE_URL` con ese dominio para que los buscadores vean la URL definitiva.
