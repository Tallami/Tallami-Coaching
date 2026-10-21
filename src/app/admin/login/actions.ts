"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getMissingConfig } from "@/admin/auth/config";
import { describeDevice } from "@/admin/auth/device";
import { attemptLogin } from "@/admin/auth/login";
import { loginIpHash } from "@/admin/auth/login-ip";
import type { LoginErrorCode } from "@/admin/auth/login-errors";
import { loginPath, safeNextPath } from "@/admin/auth/redirect";
import { getClientIp, shouldUseSecureCookie } from "@/admin/auth/request";
import { ADMIN_COOKIE, createSessionToken, sessionCookieOptions } from "@/admin/auth/session";
import { createSession, purgeExpiredAuthRecords } from "@/admin/auth/sessions";
import { getDb } from "@/db/client";

/** Tope del largo de la contraseña: scrypt cuesta lo mismo, pero no hay por qué procesar un texto enorme. */
const MAX_PASSWORD_LENGTH = 1024;
const passwordSchema = z.string().min(1).max(MAX_PASSWORD_LENGTH);

/** Vuelve al formulario con un aviso, conservando a dónde se quería ir. */
function backToLogin(error: LoginErrorCode, next: string): never {
  redirect(loginPath({ next, error }));
}

/**
 * Verifica la contraseña (con límite de intentos por IP) y, si es correcta, abre
 * una sesión en la base y devuelve su id; si no, el motivo del rechazo. De paso
 * borra los registros viejos de sesiones, ingresos y códigos.
 *
 * Con solo la contraseña la sesión se abre ya, sin llave: es provisorio, el
 * ingreso con llave de acceso la reemplaza por un paso más.
 */
async function openSessionWithPassword(
  requestHeaders: Headers,
  password: string,
): Promise<{ sessionId: string } | { error: LoginErrorCode }> {
  const db = await getDb();
  const result = await attemptLogin(db, loginIpHash(getClientIp(requestHeaders)), password);
  if (result !== "ok") return { error: result };

  await purgeExpiredAuthRecords(db);
  const sessionId = await createSession(db, {
    passkeyId: null,
    device: describeDevice(requestHeaders.get("user-agent")),
    reauthed: false,
  });
  return { sessionId };
}

/**
 * Inicia sesión: verifica la contraseña, abre la sesión en la base y guarda la
 * cookie que lleva su id; después va a `next` (una ruta del panel; ver
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
  let outcome: Awaited<ReturnType<typeof openSessionWithPassword>>;
  try {
    outcome = await openSessionWithPassword(requestHeaders, password.data);
  } catch (error) {
    // Base caída o mal configurada: no se deja entrar sin poder anotar el intento ni abrir la sesión.
    console.error("Panel: no se pudo verificar el ingreso.", error);
    return backToLogin("unavailable", next);
  }
  if ("error" in outcome) return backToLogin(outcome.error, next);

  (await cookies()).set(
    ADMIN_COOKIE,
    await createSessionToken(outcome.sessionId),
    sessionCookieOptions(shouldUseSecureCookie(requestHeaders)),
  );
  redirect(next);
}
