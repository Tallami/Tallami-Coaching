// Una ceremonia del segundo paso del ingreso, del lado del navegador: pedirle al
// servidor las opciones, pasárselas al navegador (que pide la huella, la cara o el
// PIN) y devolverle al servidor la respuesta. Es igual para usar una llave y para
// registrar la primera; cambia solo qué hace el navegador.
//
// Lo que haga el navegador puede fallar sin que el servidor se entere (Tallami
// cancela, el dispositivo no tiene la llave, la dirección no es la configurada):
// en ese caso no se llama a `finish`, así que no cuenta como intento fallido.

import type { LoginStepFailure, LoginStepSuccess } from "@/admin/auth/login-errors";
import { describeWebAuthnError } from "./webauthn-errors";

/** El aviso cuando el servidor no contesta (sin red, base caída): no dice nada de la llave. */
export const UNAVAILABLE_MESSAGE = "No pudimos verificar el ingreso. Probá de nuevo en unos minutos.";

export interface Ceremony<Options> {
  /** La acción que arma las opciones y guarda el desafío. */
  begin: () => Promise<{ ok: true; options: Options } | LoginStepFailure>;
  /** Lo que hace el navegador con las opciones: pedir la llave o crearla. */
  ask: (options: Options) => Promise<unknown>;
  /** La acción que verifica la respuesta y abre la sesión. */
  finish: (response: unknown) => Promise<LoginStepSuccess | LoginStepFailure>;
}

/** Cómo terminó una ceremonia, ya traducido a qué hacer en la pantalla. */
export type CeremonyOutcome =
  /** Sesión abierta: ir a `redirectTo`. */
  | { kind: "done"; redirectTo: string }
  /** El ingreso venció o la conexión se bloqueó: volver al login con ese aviso. */
  | { kind: "restart"; error: "expired" | "blocked" }
  /** El servidor no pudo verificar la llave (contó como intento fallido). */
  | { kind: "failed" }
  /** Un aviso para mostrar tal cual (el navegador no completó la llave, o no hubo respuesta). */
  | { kind: "message"; message: string };

function outcomeOf(failure: LoginStepFailure): CeremonyOutcome {
  return failure.error === "failed" ? { kind: "failed" } : { kind: "restart", error: failure.error };
}

/** Corre la ceremonia entera y dice cómo terminó. Nunca tira. `origin` es el de las llaves, para los avisos. */
export async function runCeremony<Options>(ceremony: Ceremony<Options>, origin: string): Promise<CeremonyOutcome> {
  try {
    const begun = await ceremony.begin();
    if (!begun.ok) return outcomeOf(begun);

    let response: unknown;
    try {
      response = await ceremony.ask(begun.options);
    } catch (error) {
      return { kind: "message", message: describeWebAuthnError(error, origin) };
    }

    const finished = await ceremony.finish(response);
    return finished.ok ? { kind: "done", redirectTo: finished.redirectTo } : outcomeOf(finished);
  } catch {
    return { kind: "message", message: UNAVAILABLE_MESSAGE };
  }
}
