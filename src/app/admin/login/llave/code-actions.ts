"use server";

import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/server";
import { registrationOptions, verifyRegistration } from "@/admin/auth/ceremonies";
import { redeemEnrollmentCode } from "@/admin/auth/enrollment-codes";
import type { LoginCodeRedeemed, LoginStepFailure, LoginStepSuccess } from "@/admin/auth/login-errors";
import { beginLoginStep, finishLoginStep, redeemLoginCode } from "@/admin/auth/login-steps";
import { passkeyNameSchema } from "@/admin/auth/passkey-name";
import { findPasskeyByCredentialId, insertPasskey, listPasskeys } from "@/admin/auth/passkeys";
import { setPendingChallenge } from "@/admin/auth/pending-logins";

// El código para registrar la llave de otro dispositivo (la PC sin Bluetooth, por
// ejemplo): después de la contraseña, "Tengo un código" lo canjea y el dispositivo
// registra su propia llave. Las tres acciones son puertas del panel (sin
// `requireAdmin()`): verifican el ingreso a medio camino de la cookie, con las mismas
// reglas que el resto del segundo paso (`src/admin/auth/login-steps.ts`): el tipo
// del ingreso, el límite de intentos y el orden en que se gasta cada cosa.

/** Un código es de 10 caracteres: más largo que esto no puede ser uno, y no hace falta procesarlo. */
const MAX_CODE_LENGTH = 64;

/**
 * Canjea el código tal como lo tecleó la persona (con o sin guion, en cualquier caso)
 * en un ingreso de tipo `passkey`. Si sirve, el ingreso pasa a tipo `code`; si no, es
 * `failed` y cuenta como intento fallido, igual que una llave inválida.
 */
export async function redeemCodeAction(code: string): Promise<LoginCodeRedeemed | LoginStepFailure> {
  const typed = typeof code === "string" ? code.slice(0, MAX_CODE_LENGTH) : "";
  return redeemLoginCode((db) => redeemEnrollmentCode(db, typed));
}

/**
 * Las opciones para crear la llave de este dispositivo, con su desafío guardado en el
 * ingreso a medio camino. Exige un ingreso de tipo `code`: antes de canjear un
 * código, esta puerta no existe.
 */
export async function beginCodePasskeyAction(): Promise<
  { ok: true; options: PublicKeyCredentialCreationOptionsJSON } | LoginStepFailure
> {
  const step = await beginLoginStep("code");
  if ("error" in step) return step;
  const options = await registrationOptions(await listPasskeys(step.db));
  await setPendingChallenge(step.db, step.pending.id, options.challenge);
  return { ok: true, options };
}

/**
 * Verifica el registro y guarda la llave con el nombre `name` (de 1 a 40 caracteres)
 * junto a las que ya había; si sale bien, la sesión queda abierta con esa llave. Exige
 * un ingreso de tipo `code`. Si esa llave ya estaba registrada, es `expired`: no se guarda
 * nada y hay que volver a empezar.
 */
export async function finishCodePasskeyAction(
  response: unknown,
  name: string,
): Promise<LoginStepSuccess | LoginStepFailure> {
  // El formulario ya lo valida: un nombre inválido solo llega armando el pedido a mano.
  const parsedName = passkeyNameSchema.safeParse(name);
  if (!parsedName.success) return { ok: false, error: "failed" };

  return finishLoginStep("code", {
    passkeyName: parsedName.data,
    verify: (_db, challenge) => verifyRegistration(response, challenge),
    async commit(db, data) {
      // El navegador ya evita repetir un dispositivo (`excludeCredentials`); esto cubre un pedido armado a mano.
      // Es volver a empezar como en los demás caminos (otra pestaña ya registró algo): sin tirar, con el ingreso gastado.
      if ((await findPasskeyByCredentialId(db, data.credentialId)) !== null) {
        console.warn("Llave de acceso: registro rechazado. Esa llave ya estaba registrada.");
        return null;
      }
      const passkey = await insertPasskey(db, { ...data, name: parsedName.data }, { onlyIfNone: false });
      return passkey?.id ?? null;
    },
  });
}
