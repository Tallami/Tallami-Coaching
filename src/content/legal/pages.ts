// Las tres páginas legales y su dirección, la misma en los tres idiomas. El pie, el sitemap y
// las páginas las leen de acá. Son públicas y se indexan, a diferencia de los formularios.

export const LEGAL_PAGES = [
  { key: "terms", href: "/terminos" },
  { key: "refunds", href: "/reembolsos" },
  { key: "privacy", href: "/privacidad" },
] as const;

export type LegalPageKey = (typeof LEGAL_PAGES)[number]["key"];
export type LegalPageHref = (typeof LEGAL_PAGES)[number]["href"];
