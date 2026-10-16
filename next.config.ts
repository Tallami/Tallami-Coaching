import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

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

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
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
    // Las fotos de los tweets (`pbs.twimg.com`). Solo https y solo este servidor.
    // Los avatares de las tarjetas son las fotos locales de los jugadores
    // (`src/assets/players`), así que ya no hace falta el avatar por defecto de
    // X (`abs.twimg.com`).
    remotePatterns: [{ protocol: "https", hostname: "pbs.twimg.com", pathname: "/**" }],
  },
  experimental: {
    // Habilita `src/app/global-not-found.tsx`: el 404 localizado que se
    // renderiza en el servidor (ver el comentario de ese archivo).
    globalNotFound: true,
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
