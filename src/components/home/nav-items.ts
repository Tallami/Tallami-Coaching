// Links de la navegación principal, en el orden en que se muestran. `labelKey`
// es la clave de `Header` en los mensajes.

const NAV_ITEMS = [
  { href: "#results", labelKey: "results" },
  { href: "#reviews", labelKey: "reviews" },
  { href: "#services", labelKey: "services" },
  { href: "#how-it-works", labelKey: "howItWorks" },
  { href: "#faq", labelKey: "faq" },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];

const REVIEWS_HREF = "#reviews";

/**
 * Los links que se muestran. Sin tarjetas de tweets la sección "Reviews" no
 * existe, y un link a ella no llevaría a ningún lado.
 */
export function visibleNavItems(hasReviews: boolean): readonly NavItem[] {
  return NAV_ITEMS.filter(({ href }) => hasReviews || href !== REVIEWS_HREF);
}
