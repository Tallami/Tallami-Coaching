import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/home/locale-switcher";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

const NAV_ITEMS = [
  { href: "#results", labelKey: "results" },
  { href: "#services", labelKey: "services" },
  { href: "#how-it-works", labelKey: "howItWorks" },
  { href: "#faq", labelKey: "faq" },
] as const;

/** Encabezado transparente, absoluto sobre la portada. */
export async function SiteHeader() {
  const t = await getTranslations("Header");

  return (
    <header className="stage absolute inset-x-0 top-0 z-10 flex items-center gap-x-6 gap-y-3 bg-transparent px-gutter py-4 narrow:flex-wrap narrow:gap-y-0">
      <Link
        href="/"
        translate="no"
        className="mr-auto text-[1.5rem] font-extrabold font-stretch-75% no-underline"
      >
        Tallami<span className="text-gold">.</span>
      </Link>
      <LocaleSwitcher label={t("languageLabel")} />
      <nav
        aria-label={t("mainNavLabel")}
        className="narrow:order-3 narrow:min-w-0 narrow:flex-[1_1_100%]"
      >
        <ul className="m-0 flex list-none gap-6 p-0 narrow:gap-[18px] narrow:overflow-x-auto narrow:[mask-image:linear-gradient(90deg,#000_85%,transparent)] narrow:[scrollbar-width:none]">
          {NAV_ITEMS.map(({ href, labelKey }) => (
            <li key={href}>
              <a
                href={href}
                className="inline-block whitespace-nowrap py-2.5 font-medium text-on-stage-2 no-underline hover:text-on-stage"
              >
                {t(labelKey)}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <Button asChild size="sm" className="narrow:order-2">
        <a href="#services">{t("book")}</a>
      </Button>
    </header>
  );
}
