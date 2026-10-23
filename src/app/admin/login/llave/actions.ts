"use server";

import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/server";
import { authenticationOptions, credentialIdOf, verifyAuthentication } from "@/admin/auth/ceremonies";
import type { LoginStepFailure, LoginStepSuccess } from "@/admin/auth/login-errors";
import { beginLoginStep, finishLoginStep } from "@/admin/auth/login-steps";
import { findPasskeyByCredentialId, listPasskeys, recordPasskeyUse } from "@/admin/auth/passkeys";
import { setPendingChallenge } from "@/admin/auth/pending-logins";

// El segundo paso con una llave ya registrada. Las dos acciones son puertas del
// panel (sin `requireAdmin()`): verifican el ingreso a medio camino de la cookie,
// que solo existe si la contraseña era correcta (ver `src/admin/auth/login-steps.ts`).

/**
 * Las opciones para pedirle la llave al navegador (cualquiera de las registradas,
 * verificando al usuario), con su desafío guardado en el ingreso a medio camino.
 * Exige un ingreso de tipo `passkey`.
 */
export async function beginPasskeyLoginAction(): Promise<
  { ok: true; options: PublicKeyCredentialRequestOptionsJSON } | LoginStepFailure
> {
  const step = await beginLoginStep("passkey");
  if ("error" in step) return step;
  const passkeys = await listPasskeys(step.db);
  // Sin llaves (se borraron después de la contraseña) no hay qué pedir: el ingreso
  // vuelve a empezar y la contraseña lleva ahora a registrar la primera.
  if (passkeys.length === 0) return { ok: false, error: "expired" };
  const options = await authenticationOptions(passkeys);
  await setPendingChallenge(step.db, step.pending.id, options.challenge);
  return { ok: true, options };
}

/**
 * Verifica la respuesta del navegador y, si es de una llave registrada y la firma
 * cierra, abre la sesión. Una llave desconocida o una firma que no verifica es
 * `failed` y cuenta como intento fallido.
 */
export async function finishPasskeyLoginAction(response: unknown): Promise<LoginStepSuccess | LoginStepFailure> {
  return finishLoginStep("passkey", {
    async verify(db, challenge) {
      const credentialId = credentialIdOf(response);
      const passkey = credentialId === null ? null : await findPasskeyByCredentialId(db, credentialId);
      if (passkey === null) return null;
      const verified = await verifyAuthentication(response, challenge, passkey);
      return verified === null ? null : { passkeyId: passkey.id, newCounter: verified.newCounter };
    },
    async commit(db, { passkeyId, newCounter }) {
      await recordPasskeyUse(db, passkeyId, newCounter);
      return passkeyId;
    },
  });
}
