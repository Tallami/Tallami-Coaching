"use server";

import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { PRO_SEASON_SLUG, checkoutHref, serviceFromSlug, type ServiceId } from "@/content/services";
import { getDb } from "@/db/client";
import type { Locale } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site-url";
import { startCheckout } from "@/payments/checkout";
import { getMercadoPagoClient } from "@/payments/mercadopago";
import { getCurrentStudent } from "@/portal/current";
import { inviteTokenFrom, portalLocale } from "@/portal/oauth/flow";

/** Lo que manda el formulario: un campo que no es texto (un archivo) es como si no estuviera. */
function textField(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" ? value : null;
}

interface ScreenRef {
  slug: string;
  locale: Locale;
  link: string | null;
}

/** A dónde sale el comprador: a Mercado Pago, o de vuelta a la pantalla con lo que pasó. */
async function destination(formData: FormData, item: ServiceId | "proSeason", screen: ScreenRef): Promise<string> {
  const { slug, locale, link } = screen;
  const account = await getCurrentStudent();
  // La sesión venció con la pantalla abierta: la pantalla vuelve a ofrecer el ingreso.
  if (!account) return checkoutHref(slug, locale, { link });

  const client = getMercadoPagoClient();
  if (!client) return checkoutHref(slug, locale, { link, error: "unavailable" });

  const result = await startCheckout(await getDb(), client, {
    account,
    item,
    adultConfirmed: textField(formData, "adult") === "yes",
    // Lo que no es un número da `NaN`, que no es igual a ningún precio.
    shownArsMinor: Number(textField(formData, "shownArsMinor")),
    linkToken: link,
    locale,
    returnOrigin: (await headers()).get("origin") ?? SITE_URL,
  });
  return result.kind === "redirect" ? result.url : checkoutHref(slug, locale, { link, error: result.reason });
}

/**
 * Tocar "Pagar" en la pantalla de confirmación. Funciona sin JavaScript. Del navegador se toma qué
 * servicio, la casilla, el monto que vio y el link; el resto lo pone el servidor, y la cuenta sale de
 * la sesión. `redirect` va afuera del `try`: es una señal de Next, no un error. Nunca un 500: si la
 * base no contesta, vuelve a la pantalla con el aviso.
 */
export async function startCheckoutAction(formData: FormData): Promise<void> {
  const locale = portalLocale(textField(formData, "locale"));
  const slug = textField(formData, "service") ?? "";
  const item = slug === PRO_SEASON_SLUG ? "proSeason" : serviceFromSlug(slug);
  // Un formulario armado a mano con un servicio que no existe no tiene pantalla a la que volver.
  if (!item) redirect(`/${locale}#services`);

  const screen: ScreenRef = { slug, locale, link: inviteTokenFrom(textField(formData, "link")) };
  let target: string;
  try {
    target = await destination(formData, item, screen);
  } catch (error) {
    unstable_rethrow(error);
    console.error("[pagos] no se pudo empezar el pago:", error instanceof Error ? error.name : typeof error);
    target = checkoutHref(slug, locale, { link: screen.link, error: "unavailable" });
  }
  redirect(target);
}
