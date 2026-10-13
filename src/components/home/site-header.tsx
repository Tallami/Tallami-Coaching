import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/home/locale-switcher";
import { visibleNavItems } from "@/components/home/nav-items";
import { NavList } from "@/components/home/nav-list";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

interface SiteHeaderProps {
  /** Si la sección "Reviews" se muestra. Sin tarjetas no hay sección, y el link tampoco. */
  hasReviews: boolean;
}

/** Encabezado transparente, absoluto sobre la portada. */
export async function SiteHeader({ hasReviews }: SiteHeaderProps) {
  const t = await getTranslations("Header");
  const navItems = visibleNavItems(hasReviews);

  return (
    <header className="stage absolute inset-x-0 top-0 z-10 flex items-center gap-x-6 gap-y-3 bg-transparent px-gutter py-4 narrow:flex-wrap narrow:gap-y-0">
      <Link
        href="/"
        translate="no"
        className="mr-auto text-[1.5rem] font-extrabold font-stretch-75% no-underline narrow:relative narrow:z-1"
      >
        Tallami<span className="text-gold">.</span>
      </Link>
      <LocaleSwitcher label={t("languageLabel")} />
      <nav
        aria-label={t("mainNavLabel")}
        className="narrow:order-3 narrow:min-w-0 narrow:flex-[1_1_100%]"
      >
        {/* ≤900 px la lista hace scroll y recorta lo que sobresale de su borde,
            incluido el aro de foco (3 px + 3 px de separación). `p-1.5` deja
            esos 6 px adentro y `-m-1.5` los compensa para que el diseño no cambie.
            Ese margen negativo la monta sobre el borde de la fila de arriba: por
            eso los controles de esa fila llevan `narrow:relative narrow:z-1`,
            para quedar por encima y recibir los toques en su borde de abajo.
            `scroll-px-1.5` deja esos 6 px libres al desplazar un link enfocado.
            El fundido del borde derecho tapa el último link: con el foco del
            teclado adentro se quita (`has-focus-visible`; un toque no lo quita)
            y `NavList` desplaza el link enfocado hasta verse entero. */}
        <NavList className="m-0 flex list-none gap-6 p-0 narrow:-m-1.5 narrow:gap-[18px] narrow:overflow-x-auto narrow:scroll-px-1.5 narrow:p-1.5 narrow:[mask-image:linear-gradient(90deg,#000_85%,transparent)] narrow:has-focus-visible:[mask-image:none] narrow:[scrollbar-width:none]">
          {navItems.map(({ href, labelKey }) => (
            <li key={href}>
              <a
                href={href}
                className="inline-block whitespace-nowrap py-2.5 font-medium text-on-stage-2 no-underline hover:text-on-stage"
              >
                {t(labelKey)}
              </a>
            </li>
          ))}
        </NavList>
      </nav>
      <Button
        asChild
        size="sm"
        className="narrow:relative narrow:z-1 narrow:order-2"
      >
        <a href="#services">{t("book")}</a>
      </Button>
    </header>
  );
}
