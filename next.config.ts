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
  images: {
    // Avatares y fotos de los tweets (`pbs.twimg.com`) y el avatar por defecto
    // de X (`abs.twimg.com`). Solo https y solo estos dos servidores.
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com", pathname: "/**" },
      { protocol: "https", hostname: "abs.twimg.com", pathname: "/**" },
    ],
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
