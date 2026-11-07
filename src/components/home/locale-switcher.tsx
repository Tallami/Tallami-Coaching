"use client";

import { useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { Suspense } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { HTML_LANG, routing } from "@/i18n/routing";

interface LocaleSwitcherProps {
  /** Nombre accesible de la navegación, ya traducido. */
  label: string;
  /**
   * Parámetros de la dirección que sobreviven al cambio de idioma (por ejemplo `link`, el token del link
   * de pago de Temporada Pro). Sin esto la dirección pierde todos sus parámetros.
   */
  keepParams?: readonly string[];
}

const LINK_CLASSES =
  "inline-block min-h-11 min-w-9 py-2.5 text-[.9rem] font-medium text-on-stage-2 no-underline aria-[current=page]:text-on-stage aria-[current=page]:underline aria-[current=page]:underline-offset-4";

function LocaleLinks({ query }: { query?: Record<string, string> }) {
  const currentLocale = useLocale();
  const pathname = usePathname();

  return routing.locales.map((locale) => (
    <Link
      key={locale}
      href={query ? { pathname, query } : pathname}
      locale={locale}
      lang={HTML_LANG[locale]}
      hrefLang={HTML_LANG[locale]}
      aria-current={locale === currentLocale ? "page" : undefined}
      className={LINK_CLASSES}
    >
      {locale.toUpperCase()}
    </Link>
  ));
}

/** Lee los parámetros que se conservan. Solo se monta con `keepParams`, dentro de un `Suspense`. */
function LocaleLinksKeepingParams({ keepParams }: { keepParams: readonly string[] }) {
  const search = useSearchParams();
  const kept = keepParams.flatMap((name) => {
    const value = search.get(name);
    return value ? ([[name, value]] as const) : [];
  });
  return <LocaleLinks query={kept.length > 0 ? Object.fromEntries(kept) : undefined} />;
}

/**
 * Lleva a la misma ruta en los otros idiomas. Es el único componente de
 * cliente del encabezado. En ≤900 px pasa a la primera fila, junto al botón
 * (`order-1`; el botón es `order-2` y la navegación principal `order-3`). Va
 * con `relative z-1` para quedar por encima del padding de esa navegación.
 *
 * Con `keepParams`, la página sigue siendo estática: los parámetros se leen en el navegador, y
 * hasta entonces (y sin JavaScript) los links son los de siempre.
 */
export function LocaleSwitcher({ label, keepParams }: LocaleSwitcherProps) {
  return (
    <nav aria-label={label} className="flex gap-0.5 narrow:relative narrow:z-1 narrow:order-1">
      {keepParams ? (
        <Suspense fallback={<LocaleLinks />}>
          <LocaleLinksKeepingParams keepParams={keepParams} />
        </Suspense>
      ) : (
        <LocaleLinks />
      )}
    </nav>
  );
}
