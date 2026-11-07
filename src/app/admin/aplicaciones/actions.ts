"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/admin/auth/require-admin";
import { ADMIN_ROUTES, applicationHref } from "@/admin/routes";
import { getDb } from "@/db/client";
import { isUuid } from "@/db/uuid";
import { routing, type Locale } from "@/i18n/routing";
import { PRO_LINK_TTL_MS } from "@/payments/policy";
import { deleteProApplication, getProApplication, setProApplicationStatus } from "@/pro/applications";
import { createProPaymentLink, proPaymentLinkUrl } from "@/pro/payment-links";

// Las acciones de las aplicaciones a la Temporada Pro. Como todas las del panel, verifican la sesión antes de todo.

/** El resultado de generar un link: la dirección (se ve una sola vez) y cuándo vence, o por qué no se pudo. */
export type CreateProLinkResult =
  | { ok: true; url: string; expiresAt: string }
  | { ok: false; error: "not-found" | "invalid-amount" | "invalid-language" };

const WHOLE_DOLLARS = /^\d{1,6}$/;
const CENTS_PER_DOLLAR = 100;

function siteLocale(value: string): Locale | null {
  return routing.locales.find((locale) => locale === value) ?? null;
}

/** Cambia el estado de la aplicación `id` con lo que eligió el formulario y vuelve a la ficha. */
export async function setApplicationStatusAction(id: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const status = formData.get("status");
  const saved = typeof status === "string" && (await setProApplicationStatus(await getDb(), id, status));
  redirect(saved ? `${applicationHref(id)}?guardado=estado` : applicationHref(id));
}

/**
 * Genera un link de pago por `dollars` dólares enteros para la aplicación `id`. Devuelve el link con su
 * token en claro: no vuelve a poder verse, en la base queda su hash. Los links anteriores siguen valiendo.
 */
export async function createProLinkAction(id: string, dollars: string, locale: string): Promise<CreateProLinkResult> {
  await requireAdmin();
  const language = siteLocale(locale);
  if (!language) return { ok: false, error: "invalid-language" };
  const text = dollars.trim();
  const amount = WHOLE_DOLLARS.test(text) ? Number(text) : 0;
  if (amount <= 0) return { ok: false, error: "invalid-amount" };
  if (!isUuid(id)) return { ok: false, error: "not-found" };

  const db = await getDb();
  if (!(await getProApplication(db, id))) return { ok: false, error: "not-found" };
  const now = new Date();
  const token = await createProPaymentLink(db, id, amount * CENTS_PER_DOLLAR, now);
  return {
    ok: true,
    url: proPaymentLinkUrl(token, language),
    expiresAt: new Date(now.getTime() + PRO_LINK_TTL_MS).toISOString(),
  };
}

/** Borra la aplicación `id` con sus links (las ventas quedan) y vuelve a la lista. */
export async function deleteApplicationAction(id: string): Promise<void> {
  await requireAdmin();
  await deleteProApplication(await getDb(), id);
  redirect(`${ADMIN_ROUTES.applications}?borrada=1`);
}
