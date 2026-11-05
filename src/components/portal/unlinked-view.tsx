import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/routing";
import type { AccountOrderState } from "@/payments/orders";
import type { PortalProvider } from "@/portal/config";
import { SignInButtons } from "./sign-in-buttons";

interface UnlinkedViewProps {
  providers: readonly PortalProvider[];
  locale: Locale;
  /** La invitación del link que abrió, si la dirección trajo una. */
  inviteToken: string | null;
  /** Cómo va su compra, si vino a comprar: entonces no necesita ninguna invitación. */
  orderState?: AccountOrderState;
}

/** El título y el texto de cada caso (claves de `Portal.unlinked`). */
function copyKeys(inviteToken: string | null, orderState: AccountOrderState) {
  if (inviteToken) return { title: "title", body: "withInvite" } as const;
  if (orderState === "unconfirmed") return { title: "orderTitle", body: "orderBody" } as const;
  if (orderState === "failed") return { title: "failedTitle", body: "failedBody" } as const;
  return { title: "title", body: "body" } as const;
}

/**
 * Con sesión, pero la cuenta todavía no está vinculada a un alumno: no ve nada de nadie. Si llegó con el
 * link de una invitación, se le pide entrar de nuevo: el ingreso es donde se canjea. Si está esperando la
 * confirmación de un pago, se le dice que la compra aparece acá; si su último intento falló, se lo lleva a
 * probar de nuevo. Una compra confirmada vincula la cuenta sola.
 */
export async function UnlinkedView({ providers, locale, inviteToken, orderState = null }: UnlinkedViewProps) {
  const t = await getTranslations("Portal.unlinked");
  const copy = copyKeys(inviteToken, orderState);

  return (
    <section aria-labelledby="unlinked-title" className="max-w-2xl border-t-4 border-gold bg-white/60 p-[clamp(20px,4vw,32px)]">
      <h2 id="unlinked-title" className="text-[clamp(1.6rem,4vw,2.25rem)] font-extrabold font-stretch-72% leading-none">
        {t(copy.title)}
      </h2>
      <p className="mt-4 max-w-[52ch] text-ink-2">{t(copy.body)}</p>
      {inviteToken ? (
        <div className="stage mt-6 inline-block rounded-[4px] p-4">
          <SignInButtons providers={providers} locale={locale} inviteToken={inviteToken} />
        </div>
      ) : null}
      <Button asChild variant="ink-outline" size="sm" className="mt-6">
        <a href={`/${locale}#services`}>{t("services")}</a>
      </Button>
    </section>
  );
}
