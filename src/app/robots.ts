import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    // El panel de admin es privado: ningún buscador debe rastrearlo. Las
    // páginas del panel además llevan `noindex` (por si alguien enlaza una).
    rules: { userAgent: "*", allow: "/", disallow: "/admin" },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
