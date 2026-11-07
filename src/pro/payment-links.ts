// Los links de pago de la Temporada Pro. Un link lleva un token de 32 bytes al azar
// (base64url); en la base queda solo su SHA-256, como en las invitaciones del portal
// (`src/portal/invites.ts`). Es de un solo uso (`paidAt`) y vence a los 14 días. Una
// aplicación puede tener varios: cada uno es un pago con su monto.

import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { checkoutHref, PRO_SEASON_SLUG } from "@/content/services";
import type { Db } from "@/db/client";
import { proPaymentLinks } from "@/db/schema";
import type { Locale } from "@/i18n/routing";
import { SITE_URL } from "@/lib/site-url";
import { PRO_LINK_TTL_MS } from "@/payments/policy";

const TOKEN_BYTES = 32;

export type ProPaymentLink = typeof proPaymentLinks.$inferSelect;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Crea un link de `amountUsdMinor` centavos de dólar para la aplicación y devuelve su token en
 * claro, que no se guarda en ningún lado. Tira si el monto no es un entero positivo o si la
 * aplicación no existe.
 */
export async function createProPaymentLink(
  db: Db,
  applicationId: string,
  amountUsdMinor: number,
  now: Date = new Date(),
): Promise<string> {
  if (!Number.isSafeInteger(amountUsdMinor) || amountUsdMinor <= 0) {
    throw new RangeError("El monto del link tiene que ser un entero positivo en centavos.");
  }
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  await db.insert(proPaymentLinks).values({
    applicationId,
    tokenHash: hashToken(token),
    amountUsdMinor,
    createdAt: now,
    expiresAt: new Date(now.getTime() + PRO_LINK_TTL_MS),
  });
  return token;
}

/** El link si el token existe, no se usó y no venció (a los 14 días justos ya no vale); si no, `null`. */
export async function readProPaymentLink(
  db: Db,
  token: string,
  now: Date = new Date(),
): Promise<{ id: string; amountUsdMinor: number } | null> {
  if (!token) return null;
  const [link] = await db
    .select({ id: proPaymentLinks.id, amountUsdMinor: proPaymentLinks.amountUsdMinor })
    .from(proPaymentLinks)
    .where(
      and(eq(proPaymentLinks.tokenHash, hashToken(token)), isNull(proPaymentLinks.paidAt), gt(proPaymentLinks.expiresAt, now)),
    );
  return link ?? null;
}

/** Los links de una aplicación, del más viejo al más nuevo. Nunca traen el token (no se guarda). */
export async function listProPaymentLinks(db: Db, applicationId: string): Promise<ProPaymentLink[]> {
  return db
    .select()
    .from(proPaymentLinks)
    .where(eq(proPaymentLinks.applicationId, applicationId))
    .orderBy(asc(proPaymentLinks.createdAt), asc(proPaymentLinks.id));
}

/** La dirección que se le manda al equipo: la pantalla de compra de Temporada Pro con el token. */
export function proPaymentLinkUrl(token: string, locale: Locale = "es"): string {
  return `${SITE_URL}${checkoutHref(PRO_SEASON_SLUG, locale, { link: token })}`;
}

/** Marca el link como usado. Corre dentro de la transacción que aprueba el pedido. */
export async function markProPaymentLinkPaid(tx: Db, id: string, now: Date): Promise<void> {
  await tx
    .update(proPaymentLinks)
    .set({ paidAt: now })
    .where(and(eq(proPaymentLinks.id, id), isNull(proPaymentLinks.paidAt)));
}
