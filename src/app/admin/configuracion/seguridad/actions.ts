"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import { notifySecurityEvent } from "@/admin/alerts/notify";
import {
  authenticationOptions,
  credentialIdOf,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
} from "@/admin/auth/ceremonies";
import { formatEnrollmentCode, generateEnrollmentCode } from "@/admin/auth/enrollment-codes";
import {
  deletePasskeyUnlessLast,
  findPasskeyByCredentialId,
  insertPasskey,
  listPasskeys,
  recordPasskeyUse,
  renamePasskey,
} from "@/admin/auth/passkeys";
import { ENROLLMENT_CODE_MS, PASSKEY_NAME_MAX_LENGTH } from "@/admin/auth/policy";
import { LOGIN_PATH } from "@/admin/auth/redirect";
import { getAdminSession, requireAdmin } from "@/admin/auth/require-admin";
import { ADMIN_COOKIE, SESSION_COOKIE_PATH } from "@/admin/auth/session";
import {
  hasRecentReauth,
  markReauthed,
  revokeAllSessions,
  setSessionChallenge,
  takeSessionChallenge,
} from "@/admin/auth/sessions";
import type {
  BeginAddPasskeyResult,
  BeginReauthResult,
  CloseAllSessionsResult,
  DeletePasskeyResult,
  EnrollmentCodeResult,
  FinishAddPasskeyResult,
  FinishReauthResult,
  ReauthRequired,
  RenamePasskeyResult,
} from "@/admin/security/results";
import { getDb } from "@/db/client";

// Las acciones de Configuración → Seguridad. Todas empiezan con `await requireAdmin();`
// y piden después la sesión. Las delicadas (agregar, renombrar o borrar una llave,
// generar un código, cerrar todas las sesiones) además exigen haber confirmado con la
// llave hace menos de 5 minutos: si no, no hacen nada y contestan `reauth-required`.
// La confirmación es `beginReauthAction` + `finishReauthAction`, y el navegador la
// hace solo (`withReauth`, en `src/admin/security/with-reauth.ts`).

const REAUTH_REQUIRED: ReauthRequired = { ok: false, error: "reauth-required" };
const nameSchema = z.string().trim().min(1).max(PASSKEY_NAME_MAX_LENGTH);

/** Borra la cookie de la sesión de este navegador (la sesión misma se cierra en la base). */
async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete({ name: ADMIN_COOKIE, path: SESSION_COOKIE_PATH });
}

/**
 * Las opciones para pedirle al navegador que confirme con cualquiera de las llaves
 * registradas, con su desafío guardado en la sesión (de un solo uso, 5 minutos).
 */
export async function beginReauthAction(): Promise<BeginReauthResult> {
  await requireAdmin();
  const session = await getAdminSession();
  const db = await getDb();
  const passkeys = await listPasskeys(db);
  if (passkeys.length === 0) return { ok: false, error: "failed" };
  const options = await authenticationOptions(passkeys);
  await setSessionChallenge(db, session.id, "reauth", options.challenge);
  return { ok: true, options };
}

/**
 * Verifica la respuesta del navegador y, si es de una llave registrada y la firma
 * cierra, abre por 5 minutos la ventana de las acciones delicadas. Un fallo no cuenta
 * para el límite de intentos del ingreso: quien llega acá ya tiene la sesión, y una
 * firma no se adivina.
 */
export async function finishReauthAction(response: unknown): Promise<FinishReauthResult> {
  await requireAdmin();
  const session = await getAdminSession();
  const db = await getDb();
  const challenge = await takeSessionChallenge(db, session.id, "reauth");
  if (challenge === null) return { ok: false, error: "expired" };

  const credentialId = credentialIdOf(response);
  const passkey = credentialId === null ? null : await findPasskeyByCredentialId(db, credentialId);
  if (passkey === null) return { ok: false, error: "failed" };
  const verified = await verifyAuthentication(response, challenge, passkey);
  if (verified === null) return { ok: false, error: "failed" };

  await recordPasskeyUse(db, passkey.id, verified.newCounter);
  await markReauthed(db, session.id);
  return { ok: true };
}

/** Las opciones para crear una llave en este dispositivo (sin repetir las ya registradas), con su desafío guardado en la sesión. */
export async function beginAddPasskeyAction(): Promise<BeginAddPasskeyResult> {
  await requireAdmin();
  const session = await getAdminSession();
  if (!hasRecentReauth(session)) return REAUTH_REQUIRED;

  const db = await getDb();
  const options = await registrationOptions(await listPasskeys(db));
  await setSessionChallenge(db, session.id, "register", options.challenge);
  return { ok: true, options };
}

/**
 * Verifica el registro y guarda la llave con el nombre `name` (de 1 a 40 caracteres)
 * junto a las que ya había. Un nombre inválido se rechaza antes de gastar el
 * desafío: se corrige y se manda la misma respuesta.
 */
export async function finishAddPasskeyAction(response: unknown, name: string): Promise<FinishAddPasskeyResult> {
  await requireAdmin();
  const session = await getAdminSession();
  if (!hasRecentReauth(session)) return REAUTH_REQUIRED;
  const parsedName = nameSchema.safeParse(name);
  if (!parsedName.success) return { ok: false, error: "invalid-name" };

  const db = await getDb();
  const challenge = await takeSessionChallenge(db, session.id, "register");
  if (challenge === null) return { ok: false, error: "expired" };
  const data = await verifyRegistration(response, challenge);
  if (data === null) return { ok: false, error: "failed" };

  // El navegador ya evita repetir un dispositivo (`excludeCredentials`); esto cubre un pedido armado a mano.
  if ((await findPasskeyByCredentialId(db, data.credentialId)) !== null) {
    console.warn("Llave de acceso: registro rechazado. Esa llave ya estaba registrada.");
    return { ok: false, error: "failed" };
  }
  await insertPasskey(db, { ...data, name: parsedName.data }, { onlyIfNone: false });
  notifySecurityEvent("passkey-added", { passkeyName: parsedName.data });
  return { ok: true };
}

/** Le cambia el nombre a la llave `id`. */
export async function renamePasskeyAction(id: string, name: string): Promise<RenamePasskeyResult> {
  await requireAdmin();
  const session = await getAdminSession();
  if (!hasRecentReauth(session)) return REAUTH_REQUIRED;
  const parsedName = nameSchema.safeParse(name);
  if (!parsedName.success) return { ok: false, error: "invalid-name" };

  const renamed = await renamePasskey(await getDb(), id, parsedName.data);
  return renamed ? { ok: true } : { ok: false, error: "missing" };
}

/**
 * Borra la llave `id`, salvo que sea la última. Las sesiones que se abrieron con ella
 * se cierran en el acto: es lo que se hace al perder un dispositivo. Si una era la de
 * este navegador, también se borra su cookie y hay que volver al login.
 *
 * El cierre de esas sesiones va dentro del borrado (`deletePasskeyUnlessLast`, una sola
 * transacción): o pasan las dos cosas o ninguna, y la sesión de un dispositivo perdido
 * nunca queda abierta con la llave ya borrada.
 */
export async function deletePasskeyAction(id: string): Promise<DeletePasskeyResult> {
  await requireAdmin();
  const session = await getAdminSession();
  if (!hasRecentReauth(session)) return REAUTH_REQUIRED;

  const deletion = await deletePasskeyUnlessLast(await getDb(), id);
  if (deletion.outcome !== "deleted") return { ok: false, error: deletion.outcome };

  notifySecurityEvent("passkey-removed", { passkeyName: deletion.name });
  if (!deletion.closedSessionIds.includes(session.id)) return { ok: true };
  await clearSessionCookie();
  return { ok: true, redirectTo: LOGIN_PATH };
}

/**
 * Genera el código para registrar la llave de otro dispositivo. Se muestra una sola
 * vez, en dos mitades; vence a los 10 minutos y anula el anterior que no se usó.
 */
export async function generateEnrollmentCodeAction(): Promise<EnrollmentCodeResult> {
  await requireAdmin();
  const session = await getAdminSession();
  if (!hasRecentReauth(session)) return REAUTH_REQUIRED;

  const now = new Date();
  const code = await generateEnrollmentCode(await getDb(), session.id, now);
  notifySecurityEvent("code-generated");
  return {
    ok: true,
    code: formatEnrollmentCode(code),
    expiresAt: new Date(now.getTime() + ENROLLMENT_CODE_MS).toISOString(),
  };
}

/** Cierra todas las sesiones, la de este navegador incluida, y vuelve al login. Las llaves no se tocan. */
export async function closeAllSessionsAction(): Promise<CloseAllSessionsResult> {
  await requireAdmin();
  const session = await getAdminSession();
  if (!hasRecentReauth(session)) return REAUTH_REQUIRED;

  await revokeAllSessions(await getDb());
  await clearSessionCookie();
  notifySecurityEvent("sessions-closed");
  return { ok: true, redirectTo: LOGIN_PATH };
}
