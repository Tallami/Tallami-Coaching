import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
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
