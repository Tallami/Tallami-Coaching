"use server";

import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/server";
import { z } from "zod";
import { registrationOptions, verifyRegistration } from "@/admin/auth/ceremonies";
import type { LoginStepFailure, LoginStepSuccess } from "@/admin/auth/login-errors";
import { beginLoginStep, finishLoginStep } from "@/admin/auth/login-steps";
import { countPasskeys, insertPasskey } from "@/admin/auth/passkeys";
import { setPendingChallenge } from "@/admin/auth/pending-logins";
import { PASSKEY_NAME_MAX_LENGTH } from "@/admin/auth/policy";

// El segundo paso cuando todavía no hay ninguna llave: registrar la primera en este
// dispositivo. Solo existe mientras no haya ninguna: el ingreso a medio camino es de
// tipo `first-key` únicamente si no había llaves al poner la contraseña, y al
// guardarla se vuelve a comprobar en la base, de forma atómica (`onlyIfNone`). Las
// dos acciones son puertas del panel (sin `requireAdmin()`; ver
// `src/admin/auth/login-steps.ts`).

const nameSchema = z.string().trim().min(1).max(PASSKEY_NAME_MAX_LENGTH);

/** Las opciones para crear la llave en el navegador, con su desafío guardado en el ingreso a medio camino. */
export async function beginFirstPasskeyAction(): Promise<
  { ok: true; options: PublicKeyCredentialCreationOptionsJSON } | LoginStepFailure
> {
  const step = await beginLoginStep("first-key");
  if ("error" in step) return step;
  // Otra pestaña ya registró la primera llave: desde ahora se entra con ella.
  if ((await countPasskeys(step.db)) > 0) return { ok: false, error: "expired" };
  const options = await registrationOptions([]);
  await setPendingChallenge(step.db, step.pending.id, options.challenge);
  return { ok: true, options };
}

/**
 * Verifica el registro y guarda la llave con el nombre `name` (de 1 a 40
 * caracteres) solo si sigue sin haber ninguna; si otra pestaña ganó, `expired` y
 * no se suma ninguna. Si sale bien, la sesión queda abierta con esa llave.
 */
export async function finishFirstPasskeyAction(
  response: unknown,
  name: string,
): Promise<LoginStepSuccess | LoginStepFailure> {
  // El formulario ya lo valida: un nombre inválido solo llega armando el pedido a mano.
  const parsedName = nameSchema.safeParse(name);
  if (!parsedName.success) return { ok: false, error: "failed" };

  return finishLoginStep("first-key", {
    passkeyName: parsedName.data,
    verify: (_db, challenge) => verifyRegistration(response, challenge),
    async commit(db, data) {
      const passkey = await insertPasskey(db, { ...data, name: parsedName.data }, { onlyIfNone: true });
      return passkey?.id ?? null;
    },
  });
}
