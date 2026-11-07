import { getTranslations } from "next-intl/server";
import { SOCIAL_LINKS } from "@/content/social";
import { Link } from "@/i18n/navigation";

/** Año del aviso de copyright; se actualiza a mano al cambiar de año. */
const COPYRIGHT_YEAR = "2026";

/**
 * Pie oscuro: marca, redes y aviso de que no hay relación con Epic Games.
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
        {/* Los dos botones que exige la norma, con el nombre que ella les da, en los tres idiomas. */}
        <nav aria-label={t("legalLinks")} className="basis-full">
          <ul className="m-0 flex list-none flex-wrap gap-x-[22px] gap-y-1 p-0">
            <li>
              <Link
                href="/arrepentimiento"
                prefetch={false}
                className="inline-block py-2.5 font-medium text-on-stage-2 no-underline hover:text-on-stage"
              >
                {t("withdrawal")}
              </Link>
            </li>
            <li>
              <Link
                href="/baja"
                prefetch={false}
                className="inline-block py-2.5 font-medium text-on-stage-2 no-underline hover:text-on-stage"
              >
                {t("cancellation")}
              </Link>
            </li>
            <li>
              <Link
                href="/contacto"
                prefetch={false}
                className="inline-block py-2.5 font-medium text-on-stage-2 no-underline hover:text-on-stage"
              >
                {t("contact")}
              </Link>
            </li>
          </ul>
        </nav>
        <small className="text-on-stage-2 [font-size:smaller]">
          {t("legal", { year: COPYRIGHT_YEAR })}
        </small>
      </div>
    </footer>
  );
}
