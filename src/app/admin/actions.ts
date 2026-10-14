"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/admin/auth/require-admin";
import { ADMIN_COOKIE, SESSION_COOKIE_PATH } from "@/admin/auth/session";
import { LOGIN_PATH } from "@/admin/auth/redirect";

/** Cierra la sesión: borra la cookie y vuelve al login. */
export async function logoutAction(): Promise<void> {
  await requireAdmin();
  (await cookies()).delete({ name: ADMIN_COOKIE, path: SESSION_COOKIE_PATH });
  redirect(LOGIN_PATH);
}
