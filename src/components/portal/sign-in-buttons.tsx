import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import type { PortalProvider } from "@/portal/config";
import type { Locale } from "@/i18n/routing";

interface SignInButtonsProps {
  /** Los proveedores habilitados (`enabledProviders()`), en el orden en que se muestran. */
  providers: readonly PortalProvider[];
  locale: Locale;
  /** La invitación del link, si la dirección trajo una: viaja solo en el link de cada botón. */
  inviteToken: string | null;
}

/**
 * La dirección que empieza el ingreso con `provider`. Son links comunes dentro del sitio (no un
 * formulario ni un botón de JavaScript): la ruta solo canjea la invitación si el pedido sale de
 * esta página (`Sec-Fetch-Site: same-origin`), así un link de otro sitio no puede usarla.
 */
function signInHref(provider: PortalProvider, locale: Locale, inviteToken: string | null): string {
  const query = new URLSearchParams({ locale });
  if (inviteToken) query.set("invitacion", inviteToken);
  return `/api/portal/auth/${provider}?${query}`;
}

/** Un botón por cada forma de entrar que está habilitada. El de prueba dice, en su texto, que lo es. */
export async function SignInButtons({ providers, locale, inviteToken }: SignInButtonsProps) {
  const t = await getTranslations("Portal");

  return (
    <ul aria-label={t("signIn.providersLabel")} role="list" className="m-0 flex list-none flex-col gap-3 p-0 sm:flex-row sm:flex-wrap">
      {providers.map((provider) => (
        <li key={provider}>
          <Button asChild variant={provider === "test" ? "stage-outline" : "gold"} className="w-full sm:w-auto">
            <a href={signInHref(provider, locale, inviteToken)}>{t(`providers.${provider}.button`)}</a>
          </Button>
        </li>
      ))}
    </ul>
  );
}
