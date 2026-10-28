// Las invitaciones al portal: la forma de vincular la cuenta de un alumno (Discord o
// Google) con su ficha del panel. Tallami genera una desde la ficha, le manda el link
// al alumno por donde hable con él, y el alumno la usa al ingresar. El link lleva un
// token de 32 bytes al azar (base64url); en la base queda solo su SHA-256, como en las
// sesiones: quien lea la tabla no puede armar un link. Cada invitación es de un solo
// uso y vence a los 14 días.
//
// La hora la pone quien llama (`now`, por defecto la actual), como en `sessions.ts`.

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { customers, portalInvites } from "../db/schema";
import type { Locale } from "../i18n/routing";
import { SITE_URL } from "../lib/site-url";
import { linkAccountToCustomer, type LinkResult } from "./accounts";
import { PORTAL_INVITE_MS } from "./policy";

/** Un token son 32 bytes al azar, en base64url: 43 caracteres. */
const TOKEN_BYTES = 32;

/** Cómo termina `redeemInvite`: lo de `linkAccountToCustomer` más `"invalid"` (no existe, ya se usó o venció). */
export type RedeemResult = LinkResult | "invalid";

/**
 * Lo que el ingreso le cuenta a la página del portal (`?invitacion=…`) sobre la
 * invitación con la que llegó el alumno: la vinculó, no sirve (no existe, ya se usó o
 * venció) o está ocupada (el alumno ya tiene otra cuenta, o la cuenta ya es de otro).
 */
export const INVITE_OUTCOMES = ["vinculada", "invalida", "ocupada"] as const;
export type InviteOutcome = (typeof INVITE_OUTCOMES)[number];

const OUTCOME_OF_RESULT: Record<RedeemResult, InviteOutcome> = {
  linked: "vinculada",
  invalid: "invalida",
  "customer-has-account": "ocupada",
  "account-linked-elsewhere": "ocupada",
};

/** Lo que se le cuenta al portal de un canje. */
export function inviteOutcome(result: RedeemResult): InviteOutcome {
  return OUTCOME_OF_RESULT[result];
}

/** El `tokenHash` con el que se guarda la invitación de `token`: su SHA-256 en hexadecimal. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cuándo vence una invitación creada a la hora `now`: a los 14 días. */
export function inviteExpiry(now: Date): Date {
  return new Date(now.getTime() + PORTAL_INVITE_MS);
}

/**
 * Crea una invitación para el alumno `customerId` y devuelve su token en claro, que
 * va en el link y no se guarda en ningún lado. Anula las invitaciones sin usar de ese
 * alumno (solo vale la última); las ya usadas quedan como registro. Tira si el alumno
 * no existe, sin dejar nada hecho.
 */
export async function createInvite(db: Db, customerId: string, now: Date = new Date()): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  await db.transaction(async (tx) => {
    // Bloquea la ficha del alumno para que dos invitaciones a la vez se turnen y no dejen dos sin
    // usar. Es `no key update` y no `update` a propósito: Postgres toma un `key share` sobre la
    // fila del alumno cada vez que otra transacción escribe una fila que la referencia (canjear
    // una invitación vincula la cuenta, y eso lo hace). `update` choca con `key share`: quien crea
    // esperaría a quien canjea y quien canjea a quien crea (interbloqueo). `no key update` sigue
    // chocando consigo mismo, que es lo que hace falta, y no con `key share`.
    await tx
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.id, customerId))
      .for("no key update");
    await tx
      .delete(portalInvites)
      .where(and(eq(portalInvites.customerId, customerId), isNull(portalInvites.usedAt)));
    await tx.insert(portalInvites).values({
      tokenHash: hashToken(token),
      customerId,
      createdAt: now,
      expiresAt: inviteExpiry(now),
    });
  });
  return token;
}

/** Corta el canje cuando el vínculo no se hizo: deshace también la marca de "usada". */
class NotLinkedError extends Error {
  constructor(readonly result: Exclude<RedeemResult, "linked" | "invalid">) {
    super(`La invitación no vinculó la cuenta: ${result}.`);
    this.name = "NotLinkedError";
  }
}

/**
 * Canjea la invitación `token` para la cuenta `accountId`: la vincula al alumno de la
 * invitación. Es atómico (una transacción): la invitación se marca como usada solo si
 * el vínculo se hizo, y un `update … where used_at is null` decide cuando dos cuentas
 * la usan a la vez (una gana, la otra recibe `"invalid"`).
 *
 * - `"linked"`: la cuenta quedó vinculada (también si ya lo estaba a este mismo alumno).
 * - `"invalid"`: no hay invitación con ese token, ya se usó, o venció (a los 14 días justos ya no vale).
 * - `"customer-has-account"`: el alumno ya tiene otra cuenta. No se toca nada y la invitación queda sin usar.
 * - `"account-linked-elsewhere"`: la cuenta ya es de otro alumno. No se toca nada y la invitación queda sin usar.
 *
 * Tira si la cuenta no existe: es un error de quien llama, no un resultado.
 */
export async function redeemInvite(
  db: Db,
  token: string,
  accountId: string,
  now: Date = new Date(),
): Promise<RedeemResult> {
  try {
    return await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(portalInvites)
        .set({ usedAt: now, usedByAccountId: accountId })
        .where(
          and(
            eq(portalInvites.tokenHash, hashToken(token)),
            isNull(portalInvites.usedAt),
            gt(portalInvites.expiresAt, now),
          ),
        )
        .returning({ customerId: portalInvites.customerId });
      if (!claimed) return "invalid";

      const result = await linkAccountToCustomer(tx, accountId, claimed.customerId);
      if (result !== "linked") throw new NotLinkedError(result);
      return "linked";
    });
  } catch (error) {
    if (error instanceof NotLinkedError) return error.result;
    throw error;
  }
}

/** El link de invitación: la página del portal en `locale`, con el token en `invitacion`. */
export function inviteUrl(token: string, locale: Locale = "es"): string {
  return `${SITE_URL}/${locale}/portal?invitacion=${token}`;
}
