import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/home/locale-switcher";
import { Link } from "@/i18n/navigation";

/**
 * Encabezado del portal: la marca, que vuelve a la portada, y el cambio de idioma. Sin la
 * navegación de la portada (sus links son anclas de esa página) y sin el botón de reservar.
 */
export async function PortalHeader() {
  const t = await getTranslations("Header");

  return (
    <header className="stage flex items-center gap-x-6 px-gutter py-4">
      <Link href="/" translate="no" className="mr-auto text-[1.5rem] font-extrabold font-stretch-75% no-underline">
        Tallami<span className="text-gold">.</span>
      </Link>
      <LocaleSwitcher label={t("languageLabel")} />
    </header>
  );
}
