"use server";

import { eq } from "drizzle-orm";
import { requireAdmin } from "@/admin/auth/require-admin";
import { getDb, type Db } from "@/db/client";
import { customers } from "@/db/schema";
import { isUuid } from "@/db/uuid";
import { accountForCustomer, deleteAccountOfCustomer, unlinkCustomer } from "@/portal/accounts";
import { createInvite, inviteExpiry, inviteUrl } from "@/portal/invites";
import { revokeAccountSessions } from "@/portal/sessions";

// Las acciones de la tarjeta "Portal del alumno" de la ficha del alumno
// (`src/admin/customers/portal-card.tsx`). Como todas las del panel, verifican la
// sesión antes de todo. Ninguna redirige: la tarjeta es un componente de cliente que
// muestra el resultado y vuelve a pedir la ficha.

/** El resultado de invitar: el link (se ve una sola vez) y cuándo vence, o por qué no se pudo. */
export type CreatePortalInviteResult =
  | { ok: true; url: string; expiresAt: string }
  | { ok: false; error: "not-found" | "already-linked" };

/** El resultado de desvincular o borrar la cuenta. Repetirlo no falla: si ya no hay cuenta, no hay nada que hacer. */
export type PortalAccountChangeResult = { ok: true } | { ok: false; error: "not-found" };

const NOT_FOUND = { ok: false, error: "not-found" } as const;

async function studentExists(db: Db, customerId: string): Promise<boolean> {
  const [student] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId));
  return student !== undefined;
}

/**
 * Genera la invitación al portal del alumno `customerId` (anula la anterior sin usar).
 * El link lleva el token en claro y no vuelve a poder verse: en la base queda su hash.
 * Un alumno que ya tiene cuenta no se invita de nuevo: primero se desvincula la cuenta.
 */
export async function createPortalInviteAction(customerId: string): Promise<CreatePortalInviteResult> {
  await requireAdmin();
  if (!isUuid(customerId)) return NOT_FOUND;

  const db = await getDb();
  if (!(await studentExists(db, customerId))) return NOT_FOUND;
  if (await accountForCustomer(db, customerId)) return { ok: false, error: "already-linked" };

  const now = new Date();
  const token = await createInvite(db, customerId, now);
  return { ok: true, url: inviteUrl(token), expiresAt: inviteExpiry(now).toISOString() };
}

/**
 * Desvincula la cuenta del portal del alumno `customerId` y cierra todas sus sesiones:
 * en un solo paso, para que no quede una cuenta suelta con la sesión abierta. La cuenta
 * sigue existiendo (puede volver a vincularse con otra invitación).
 */
export async function unlinkPortalAccountAction(customerId: string): Promise<PortalAccountChangeResult> {
  await requireAdmin();
  if (!isUuid(customerId)) return NOT_FOUND;

  await (await getDb()).transaction(async (tx) => {
    const accountId = await unlinkCustomer(tx, customerId);
    if (accountId) await revokeAccountSessions(tx, accountId);
  });
  return { ok: true };
}

/**
 * Borra la cuenta del portal del alumno `customerId`, con sus sesiones. El alumno, sus
 * ventas y sus entregas siguen en el panel.
 */
export async function deletePortalAccountAction(customerId: string): Promise<PortalAccountChangeResult> {
  await requireAdmin();
  if (!isUuid(customerId)) return NOT_FOUND;

  await deleteAccountOfCustomer(await getDb(), customerId);
  return { ok: true };
}
