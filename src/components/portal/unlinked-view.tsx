import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import type { PortalProvider } from "@/portal/config";
import { SignInButtons } from "./sign-in-buttons";

interface UnlinkedViewProps {
  providers: readonly PortalProvider[];
  locale: Locale;
  /** La invitación del link que abrió, si la dirección trajo una. */
  inviteToken: string | null;
}

/**
 * Con sesión, pero la cuenta todavía no está vinculada a un alumno: no ve nada de nadie. Si llegó
 * con el link de una invitación, se le pide entrar de nuevo: el ingreso es donde se canjea.
 */
export async function UnlinkedView({ providers, locale, inviteToken }: UnlinkedViewProps) {
  const t = await getTranslations("Portal.unlinked");

  return (
    <section aria-labelledby="unlinked-title" className="max-w-2xl border-t-4 border-gold bg-white/60 p-[clamp(20px,4vw,32px)]">
      <h2 id="unlinked-title" className="text-[clamp(1.6rem,4vw,2.25rem)] font-extrabold font-stretch-72% leading-none">
        {t("title")}
      </h2>
      <p className="mt-4 max-w-[52ch] text-ink-2">{inviteToken ? t("withInvite") : t("body")}</p>
      {inviteToken ? (
        <div className="stage mt-6 inline-block rounded-[4px] p-4">
          <SignInButtons providers={providers} locale={locale} inviteToken={inviteToken} />
        </div>
      ) : null}
    </section>
  );
}
