import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import { PRO_SEASON_SLUG, SERVICE_SLUGS, priceUsdMinor, type ServiceId } from "@/content/services";
import { getDb } from "@/db/client";
import type { Locale } from "@/i18n/routing";
import { getPaymentAvailability } from "@/payments/availability";
import { checkoutErrorFrom } from "@/payments/checkout";
import { pesosForUsd } from "@/payments/pricing";
import type { PortalAccount } from "@/portal/accounts";
import { enabledProviders, isPortalConfigured } from "@/portal/config";
import { getCurrentStudent } from "@/portal/current";
import { inviteTokenFrom } from "@/portal/oauth/flow";
import { readProPaymentLink } from "@/pro/payment-links";
import { CheckoutForm } from "./checkout-form";
import { CheckoutLegal } from "./checkout-legal";
import { CheckoutNotice } from "./checkout-notice";
import { CheckoutProInvalid } from "./checkout-pro-invalid";
import { CheckoutSignIn } from "./checkout-sign-in";
import { CheckoutSummary } from "./checkout-summary";
import { CheckoutUnavailable } from "./checkout-unavailable";

interface CheckoutContentProps {
  locale: Locale;
  item: ServiceId | "proSeason";
  /** Los parámetros de la dirección, sin esperar: leerlos vuelve dinámico a todo lo que sigue. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Lo que se sabe en este pedido: con qué valor se calcula y, si se puede pagar, quién mira. */
type Screen =
  | { canPay: false; rate: string | null }
  | { canPay: true; rate: string; account: PortalAccount | null };

/** `?clave=a&clave=b` llega como lista: vale el primero. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function loadScreen(): Promise<Screen> {
  // Sin portal no hay ingreso, y sin ingreso nadie puede comprar.
  if (!isPortalConfigured()) return { canPay: false, rate: null };
  const { canPay, rate } = await getPaymentAvailability(await getDb());
  if (!canPay || rate === null) return { canPay: false, rate };
  return { canPay: true, rate, account: await getCurrentStudent() };
}

/** Si la base no contesta, la pantalla dice que no se puede pagar: nunca un 500. */
async function loadScreenSafely(): Promise<Screen> {
  try {
    return await loadScreen();
  } catch (error) {
    // Las señales internas de Next (por ejemplo, esperar a que haya un pedido) no son fallas.
    unstable_rethrow(error);
    console.error("[pagos] no se pudo armar la pantalla de compra:", error instanceof Error ? error.name : typeof error);
    return { canPay: false, rate: null };
  }
}

const CENTS_PER_DOLLAR = 100;

/** Lo que se compra en esta pantalla: el monto en centavos de dólar y el slug. Temporada Pro sale del link, o de nada. */
async function loadPurchase(item: ServiceId | "proSeason", linkToken: string | null): Promise<{ slug: string; amountUsdMinor: number } | null> {
  if (item !== "proSeason") return { slug: SERVICE_SLUGS[item], amountUsdMinor: priceUsdMinor(item) };
  if (!linkToken) return null;
  try {
    const link = await readProPaymentLink(await getDb(), linkToken);
    return link ? { slug: PRO_SEASON_SLUG, amountUsdMinor: link.amountUsdMinor } : null;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[pagos] no se pudo leer el link de pago:", error instanceof Error ? error.name : typeof error);
    return null;
  }
}

/**
 * Lo que cambia en cada pedido de la pantalla de confirmación: el precio, quién mira y lo que dice la
 * dirección. Va dentro de un `Suspense`, y `connection()` corta la precarga, como en `PortalContent`.
 * El monto del campo oculto lo calcula el servidor con el valor de ahora, directo de la base. En Temporada
 * Pro el monto es el del link; sin un link que sirva no se muestra nada de ninguna venta.
 */
export async function CheckoutContent({ locale, item, searchParams }: CheckoutContentProps) {
  const params = await searchParams;
  await connection();
  const reason = checkoutErrorFrom(first(params.error));
  const linkToken = inviteTokenFrom(first(params.link));
  const purchase = await loadPurchase(item, linkToken);
  if (purchase === null) return <CheckoutProInvalid locale={locale} />;
  const { slug, amountUsdMinor } = purchase;
  const screen = await loadScreenSafely();

  return (
    <>
      {reason ? <CheckoutNotice reason={reason} /> : null}
      <div className="grid items-start gap-x-[clamp(32px,6vw,80px)] gap-y-10 md:grid-cols-[minmax(0,1fr)_minmax(0,27rem)]">
        <div className="min-w-0">
          <CheckoutSummary priceUsd={amountUsdMinor / CENTS_PER_DOLLAR} rate={screen.rate} locale={locale} />
          <CheckoutLegal locale={locale} />
        </div>
        {!screen.canPay ? (
          <CheckoutUnavailable locale={locale} />
        ) : screen.account ? (
          <CheckoutForm
            account={screen.account}
            slug={slug}
            locale={locale}
            shownArsMinor={pesosForUsd(amountUsdMinor, screen.rate)}
            linkToken={linkToken}
          />
        ) : (
          <CheckoutSignIn providers={enabledProviders()} locale={locale} checkout={{ slug, linkToken }} />
        )}
      </div>
    </>
  );
}
