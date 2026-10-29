import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";
import type { PortalAccount } from "@/portal/accounts";

interface AccountBarProps {
  account: PortalAccount;
  locale: Locale;
}

/**
 * Quién ingresó, con qué cuenta, y el botón para salir. "Salir" es un formulario `POST` común: la
 * ruta cierra la sesión en la base, borra la cookie y vuelve al portal en el mismo idioma.
 */
export async function AccountBar({ account, locale }: AccountBarProps) {
  const t = await getTranslations("Portal");

  return (
    <div className="mb-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-b border-rule pb-6">
      <div className="min-w-0">
        <p className="text-[clamp(1.5rem,3.5vw,2rem)] font-extrabold font-stretch-80% leading-tight [overflow-wrap:anywhere]">
          {t("account.greeting", { name: account.displayName })}
        </p>
        <p className="mt-1 text-[.95rem] text-ink-2">
          {t("account.signedInWith", { provider: t(`providers.${account.provider}.name`) })}
        </p>
      </div>
      <form method="post" action={`/api/portal/auth/logout?locale=${locale}`}>
        <Button type="submit" variant="ink-outline" size="sm">
          {t("account.signOut")}
        </Button>
      </form>
    </div>
  );
}
