"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { notifyIfJustBlocked } from "@/admin/alerts/blocked";
import { getMissingConfig } from "@/admin/auth/config";
import { describeDevice } from "@/admin/auth/device";
import { attemptLogin } from "@/admin/auth/login";
import { loginIpHash } from "@/admin/auth/login-ip";
import type { LoginErrorCode } from "@/admin/auth/login-errors";
import { stepPathFor } from "@/admin/auth/login-steps";
import { countPasskeys } from "@/admin/auth/passkeys";
import {
  PENDING_COOKIE,
  createPendingLogin,
  pendingCookieOptions,
  type PendingMode,
} from "@/admin/auth/pending-logins";
import { loginPath, loginStepPath, safeNextPath } from "@/admin/auth/redirect";
import { getClientIp, shouldUseSecureCookie } from "@/admin/auth/request";
import { purgeExpiredAuthRecords } from "@/admin/auth/sessions";
import { getDb, type Db } from "@/db/client";

/** Tope del largo de la contraseña: scrypt cuesta lo mismo, pero no hay por qué procesar un texto enorme. */
const MAX_PASSWORD_LENGTH = 1024;
const passwordSchema = z.string().min(1).max(MAX_PASSWORD_LENGTH);

/** Vuelve al formulario con un aviso, conservando a dónde se quería ir. */
function backToLogin(error: LoginErrorCode, next: string): never {
  redirect(loginPath({ next, error }));
}

/**
 * Borra los registros viejos de sesiones, ingresos y códigos. Es una limpieza que se hace de
 * pasada: si falla, una contraseña correcta no puede pasar a "no disponible", así que el fallo
 * se anota y el ingreso sigue. Se anota solo el nombre del error: el mensaje podría traer la
 * conexión a la base.
 */
async function purgeOldRecords(db: Db): Promise<void> {
  try {
    await purgeExpiredAuthRecords(db);
  } catch (error) {
    const reason = error instanceof Error ? error.name : typeof error;
    console.error(`Panel: no se pudieron borrar los registros viejos del ingreso. ${reason}`);
  }
}

/**
 * Verifica la contraseña (con límite de intentos por IP) y, si es correcta, abre
 * un ingreso a medio camino: todavía no hay sesión, falta la llave. Si ya hay
 * alguna llave registrada, el paso siguiente es usarla; si no hay ninguna, es
 * registrar la primera. De paso borra los registros viejos de sesiones, ingresos
 * y códigos.
 */
async function startSecondStep(
  requestHeaders: Headers,
  password: string,
  next: string,
): Promise<{ pendingId: string; mode: PendingMode } | { error: LoginErrorCode }> {
  const db = await getDb();
  const ipHash = loginIpHash(getClientIp(requestHeaders));
  const result = await attemptLogin(db, ipHash, password);
  // Un intento bloqueado no deja ningún fallo anotado: el aviso es solo del fallo que llena el tope.
  if (result === "invalid") await notifyIfJustBlocked(db, ipHash);
  if (result !== "ok") return { error: result };

  await purgeOldRecords(db);
  // Con al menos una llave registrada, la contraseña sola nunca lleva a registrar otra.
  const mode: PendingMode = (await countPasskeys(db)) > 0 ? "passkey" : "first-key";
  const pendingId = await createPendingLogin(db, {
    mode,
    nextPath: next,
    ipHash,
    device: describeDevice(requestHeaders.get("user-agent")),
  });
  return { pendingId, mode };
}

/**
 * El primer paso del ingreso: verifica la contraseña y, si es correcta, guarda la
 * cookie del ingreso a medio camino y sigue al segundo paso (la llave, o registrar
 * la primera). La sesión la abre recién ese paso; `next` (una ruta del panel, ver
 * `safeNextPath`) queda guardado en el ingreso para ir ahí al terminar.
 *
 * Ante cualquier falla de contraseña el aviso es el mismo, también cuando el
 * hash o el secreto no están configurados: el formulario no dice qué falta.
 * Esta acción no llama a `requireAdmin()`: es la puerta (como las del segundo
 * paso, que verifican el ingreso a medio camino).
 */
export async function loginAction(formData: FormData): Promise<void> {
  const next = safeNextPath(formData.get("next"));
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!password.success || getMissingConfig().length > 0) {
    return backToLogin("invalid", next);
  }

  const requestHeaders = await headers();
  let outcome: Awaited<ReturnType<typeof startSecondStep>>;
  try {
    outcome = await startSecondStep(requestHeaders, password.data, next);
  } catch (error) {
    // Base caída o mal configurada: no se deja seguir sin poder anotar el intento ni guardar el ingreso.
    console.error("Panel: no se pudo verificar el ingreso.", error);
    return backToLogin("unavailable", next);
  }
  if ("error" in outcome) return backToLogin(outcome.error, next);

  (await cookies()).set(
    PENDING_COOKIE,
    outcome.pendingId,
    pendingCookieOptions(shouldUseSecureCookie(requestHeaders)),
  );
  redirect(loginStepPath(stepPathFor(outcome.mode), next));
}
