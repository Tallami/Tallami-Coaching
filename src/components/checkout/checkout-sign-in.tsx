import { getTranslations } from "next-intl/server";
import { SignInButtons } from "@/components/portal/sign-in-buttons";
import type { Locale } from "@/i18n/routing";
import type { PortalProvider } from "@/portal/config";
import type { FlowCheckout } from "@/portal/oauth/flow";

interface CheckoutSignInProps {
  providers: readonly PortalProvider[];
  locale: Locale;
  /** Esta pantalla: el ingreso vuelve acá. */
  checkout: FlowCheckout;
}

/** Sin sesión: los mismos botones del portal, que al terminar vuelven a esta pantalla. */
export async function CheckoutSignIn({ providers, locale, checkout }: CheckoutSignInProps) {
  const t = await getTranslations("Checkout.signIn");

  return (
    <section aria-labelledby="checkout-sign-in-title" className="stage rounded-[4px] p-[clamp(24px,4vw,36px)]">
      <h2 id="checkout-sign-in-title" className="text-[clamp(1.6rem,3.5vw,2.25rem)] font-extrabold font-stretch-72% leading-none">
        {t("title")}
      </h2>
      <p className="mt-3 mb-6 text-on-stage-2">{t("body")}</p>
      <SignInButtons providers={providers} locale={locale} inviteToken={null} checkout={checkout} />
    </section>
  );
}
