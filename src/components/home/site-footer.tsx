import { getTranslations } from "next-intl/server";
import { SOCIAL_LINKS } from "@/content/social";

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
        <small className="text-on-stage-2 [font-size:smaller]">
          {t("legal", { year: COPYRIGHT_YEAR })}
        </small>
      </div>
    </footer>
  );
}
