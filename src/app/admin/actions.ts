"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAdminSession, requireAdmin } from "@/admin/auth/require-admin";
import { ADMIN_COOKIE, SESSION_COOKIE_PATH } from "@/admin/auth/session";
import { revokeSession } from "@/admin/auth/sessions";
import { LOGIN_PATH } from "@/admin/auth/redirect";
import { getDb } from "@/db/client";

/**
 * Cierra la sesión: la cierra en la base (así la cookie vieja deja de valer, aunque
 * alguien la tenga guardada), borra la cookie y vuelve al login.
 */
export async function logoutAction(): Promise<void> {
  await requireAdmin();
  const session = await getAdminSession();
  await revokeSession(await getDb(), session.id);
  (await cookies()).delete({ name: ADMIN_COOKIE, path: SESSION_COOKIE_PATH });
  redirect(LOGIN_PATH);
}
