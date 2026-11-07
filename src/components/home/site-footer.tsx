import { getTranslations } from "next-intl/server";
import { LEGAL_PAGES } from "@/content/legal/pages";
import { SOCIAL_LINKS } from "@/content/social";
import { Link } from "@/i18n/navigation";

/** Año del aviso de copyright; se actualiza a mano al cambiar de año. */
const COPYRIGHT_YEAR = "2026";

/**
 * Los dos botones que exige la norma, con el nombre que ella les da en los tres idiomas, el
 * contacto y las tres páginas legales. La clave es la del texto en `Footer`.
 */
const SITE_LINKS = [
  { key: "withdrawal", href: "/arrepentimiento" },
  { key: "cancellation", href: "/baja" },
  { key: "contact", href: "/contacto" },
  ...LEGAL_PAGES,
] as const;

/**
 * Pie oscuro: marca, redes, portal, trámites, páginas legales y aviso de que no hay relación con Epic Games.
 * Port de c-analisis.html (líneas 164-169). La marca lleva `mr-auto`, igual
 * que en la propuesta: empuja las redes y el aviso hacia la derecha.
 */
export async function SiteFooter() {
  const t = await getTranslations("Footer");

  return (
    <footer className="stage pt-11 pb-14">
      <div className="mx-auto flex max-w-wrap flex-wrap items-center justify-between gap-x-10 gap-y-5 px-gutter">
        <span
          translate="no"
          className="mr-auto text-[1.5rem] font-extrabold font-stretch-75%"
        >
          Tallami<span className="text-gold">.</span>
        </span>
        {/* Las redes y el link al portal comparten el espaciado de los links del pie. */}
        <div className="flex flex-wrap items-center gap-x-[22px] gap-y-1">
          <ul
            aria-label={t("socialLabel")}
            className="m-0 flex list-none flex-wrap gap-x-[22px] gap-y-1 p-0"
          >
            {SOCIAL_LINKS.map(({ label, href }) => (
              <li key={label}>
                <a
                  href={href}
                  className="inline-block py-2.5 font-medium text-on-stage-2 no-underline hover:text-on-stage"
                >
                  {label}
                </a>
              </li>
            ))}
          </ul>
          {/* Un link discreto, sin precarga: casi nadie que mira la portada es alumno. */}
          <Link
            href="/portal"
            prefetch={false}
            className="inline-block py-2.5 font-medium text-on-stage-2 no-underline hover:text-on-stage"
          >
            {t("portal")}
          </Link>
        </div>
        {/* Los dos botones de la norma, el contacto y lo legal, visibles en todas las páginas. */}
        <nav aria-label={t("legalLinks")} className="basis-full">
          <ul className="m-0 flex list-none flex-wrap gap-x-[22px] gap-y-1 p-0">
            {SITE_LINKS.map(({ key, href }) => (
              <li key={key}>
                <Link
                  href={href}
                  prefetch={false}
                  className="inline-block py-2.5 font-medium text-on-stage-2 no-underline hover:text-on-stage"
                >
                  {t(key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <small className="text-on-stage-2 [font-size:smaller]">
          {t("legal", { year: COPYRIGHT_YEAR })}
        </small>
      </div>
    </footer>
  );
}
