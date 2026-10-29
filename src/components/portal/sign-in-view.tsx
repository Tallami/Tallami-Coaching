import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import type { PortalProvider } from "@/portal/config";
import { SignInButtons } from "./sign-in-buttons";

interface SignInViewProps {
  providers: readonly PortalProvider[];
  locale: Locale;
  inviteToken: string | null;
}

/** Sin sesión: qué es el portal y cómo se entra. Una tarjeta del color del escenario, como la de Temporada Pro. */
export async function SignInView({ providers, locale, inviteToken }: SignInViewProps) {
  const t = await getTranslations("Portal.signIn");

  return (
    <section aria-labelledby="sign-in-title" className="stage max-w-2xl rounded-[4px] p-[clamp(24px,4vw,40px)]">
      <h2
        id="sign-in-title"
        className="text-[clamp(1.9rem,4.5vw,2.75rem)] font-extrabold font-stretch-72% leading-none"
      >
        {t("title")}
      </h2>
      <p className="mt-4 mb-7 max-w-[52ch] text-on-stage-2">{t("body")}</p>
      <SignInButtons providers={providers} locale={locale} inviteToken={inviteToken} />
    </section>
  );
}
