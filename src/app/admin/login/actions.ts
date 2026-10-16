"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getMissingConfig } from "@/admin/auth/config";
import { attemptLogin } from "@/admin/auth/login";
import { loginIpHash } from "@/admin/auth/login-ip";
import type { LoginErrorCode } from "@/admin/auth/login-errors";
import { loginPath, safeNextPath } from "@/admin/auth/redirect";
import { getClientIp, shouldUseSecureCookie } from "@/admin/auth/request";
import { ADMIN_COOKIE, createSessionToken, sessionCookieOptions } from "@/admin/auth/session";
import { getDb } from "@/db/client";

/** Tope del largo de la contraseña: scrypt cuesta lo mismo, pero no hay por qué procesar un texto enorme. */
const MAX_PASSWORD_LENGTH = 1024;
const passwordSchema = z.string().min(1).max(MAX_PASSWORD_LENGTH);

/** Vuelve al formulario con un aviso, conservando a dónde se quería ir. */
function backToLogin(error: LoginErrorCode, next: string): never {
  redirect(loginPath({ next, error }));
}

/**
 * Inicia sesión: verifica la contraseña (con límite de intentos por IP) y, si es
 * correcta, guarda la cookie de sesión y va a `next` (una ruta del panel; ver
 * `safeNextPath`).
 *
 * Ante cualquier falla de contraseña el aviso es el mismo, también cuando el
 * hash o el secreto no están configurados: el formulario no dice qué falta.
 * Esta acción es la única del panel que no llama a `requireAdmin()`: es la
 * puerta.
 */
export async function loginAction(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next"));
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!password.success || getMissingConfig().length > 0) {
    return backToLogin("invalid", next);
  }

  const requestHeaders = await headers();
  let result: Awaited<ReturnType<typeof attemptLogin>>;
  try {
    const db = await getDb();
    result = await attemptLogin(db, loginIpHash(getClientIp(requestHeaders)), password.data);
  } catch (error) {
    // Base caída o mal configurada: no se deja entrar sin poder anotar el intento.
    console.error("Panel: no se pudo verificar el ingreso.", error);
    return backToLogin("unavailable", next);
  }
  if (result !== "ok") return backToLogin(result, next);

  (await cookies()).set(
    ADMIN_COOKIE,
    await createSessionToken(),
    sessionCookieOptions(shouldUseSecureCookie(requestHeaders)),
  );
  redirect(next);
}
