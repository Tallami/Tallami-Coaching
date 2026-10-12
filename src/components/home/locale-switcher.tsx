"use client";

import { useLocale } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { HTML_LANG, routing } from "@/i18n/routing";

interface LocaleSwitcherProps {
  /** Nombre accesible de la navegación, ya traducido. */
  label: string;
}

/**
 * Lleva a la misma ruta en los otros idiomas. Es el único componente de
 * cliente del encabezado. En ≤900 px pasa a la primera fila, junto al botón
 * (`order-1`; el botón es `order-2` y la navegación principal `order-3`). Va
 * con `relative z-1` para quedar por encima del padding de esa navegación.
 */
export function LocaleSwitcher({ label }: LocaleSwitcherProps) {
  const currentLocale = useLocale();
  const pathname = usePathname();

  return (
    <nav
      aria-label={label}
      className="flex gap-0.5 narrow:relative narrow:z-1 narrow:order-1"
    >
      {routing.locales.map((locale) => (
        <Link
          key={locale}
          href={pathname}
          locale={locale}
          lang={HTML_LANG[locale]}
          hrefLang={HTML_LANG[locale]}
          aria-current={locale === currentLocale ? "page" : undefined}
          className="inline-block min-h-11 min-w-9 py-2.5 text-[.9rem] font-medium text-on-stage-2 no-underline aria-[current=page]:text-on-stage aria-[current=page]:underline aria-[current=page]:underline-offset-4"
        >
          {locale.toUpperCase()}
        </Link>
      ))}
    </nav>
  );
}
