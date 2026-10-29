import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { routing } from "./src/i18n/routing";

/**
 * Encabezados base para todas las rutas. Sin CSP a propósito: una CSP con
 * nonce obliga a renderizar cada página en cada pedido y las páginas dejan de
 * ser estáticas.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
];

/**
 * La página del portal del alumno en cada idioma (`/es/portal`, `/pt/portal`, `/en/portal`). El link
 * de una invitación lleva su token en la dirección (`?invitacion=…`): la página lo saca de la barra,
 * pero mientras carga y en cualquier pedido que salga de ella no puede mandarse en un `Referer` a otro sitio.
 *
 * `same-origin` y no `no-referrer`: al propio sitio el `Referer` tiene que seguir llegando, porque es el
 * respaldo con el que `startedOnThisSite` reconoce un clic de la página en los navegadores sin
 * `Sec-Fetch-Site`; y con `no-referrer` el `Origin` de un POST del propio sitio ("Salir") pasa a ser `null`.
 */
const PORTAL_PAGE_SOURCE = `/:locale(${routing.locales.join("|")})/portal`;

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // Va después de la regla de todas las rutas: cuando dos reglas ponen el mismo encabezado,
      // gana la última, y acá la política es más estricta que la base: nada sale hacia otros sitios.
      { source: PORTAL_PAGE_SOURCE, headers: [{ key: "Referrer-Policy", value: "same-origin" }] },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite (la base local del panel, ver `src/db/pglite.ts`) no se puede
  // empaquetar: carga sus archivos wasm con `fs.readFile(new URL(…))`, y dentro
  // del bundle de Turbopack esa URL llega como otra clase `URL` y falla con
  // `ERR_INVALID_ARG_TYPE` al abrir la base en `next start` (el login lo usa
  // para anotar los intentos). Se deja como paquete externo de Node. En Vercel
  // no se usa: allá la base es `DATABASE_URL`.
  serverExternalPackages: ["@electric-sql/pglite"],
  images: {
    // Las fotos de los tweets (`pbs.twimg.com`). Solo https, solo este servidor y
    // solo `/media/`: las tarjetas piden la primera foto de cada tweet (`photos`
    // en `src/lib/tweets.ts`) y todas viven ahí; ninguna usa videos. Los avatares
    // de las tarjetas son las fotos locales de los jugadores (`src/assets/players`),
    // así que tampoco hacen falta `profile_images` ni el avatar por defecto de X
    // (`abs.twimg.com`).
    remotePatterns: [{ protocol: "https", hostname: "pbs.twimg.com", pathname: "/media/**" }],
  },
  experimental: {
    // Habilita `src/app/global-not-found.tsx`: el 404 localizado que se
    // renderiza en el servidor (ver el comentario de ese archivo).
    globalNotFound: true,
    // Las Server Actions aceptan 1 MB de cuerpo por defecto y un PDF de entrega pesa
    // hasta 4 MB (`DELIVERY_PDF_MAX_BYTES`, más el resto del formulario). Se sube a 5 MB:
    // apenas por encima, porque el techo de verdad lo pone Vercel, que corta con 413 los
    // pedidos de más de 4,5 MB a una función. Lo que pase de 4 MB y llegue hasta acá lo
    // rechaza la acción (`too-large`). En Next 16 la opción vive bajo `experimental`.
    //
    // OJO: es un límite global. Vale para TODAS las Server Actions del sitio (hoy, las del panel, también las
    // del ingreso), no solo para la que recibe el PDF (`addDeliveryAction`): cualquier otra acepta hasta 5 MB
    // de cuerpo. Por eso cada acción valida lo que recibe (tipo, largo, tamaño) y no se le confía nada al
    // formulario. Subirlo exige repensar eso, y más de 10 MB llegaría cortado (`tests/unit/next-config.test.ts`).
    serverActions: { bodySizeLimit: "5mb" },
  },
  turbopack: {
    rules: {
      // Los módulos CSS (`*.module.css`) quedan fuera del loader: con
      // `as: "*.css"` Turbopack los trata como CSS global y `styles.x` queda
      // en `undefined`. No usan directivas de Tailwind, solo `var(--color-*)`.
      "*.css": {
        condition: { not: { path: "*.module.css" } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
