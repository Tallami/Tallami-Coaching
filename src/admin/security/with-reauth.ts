// La confirmación reciente, del lado del navegador. Las acciones delicadas de
// Configuración → Seguridad contestan `reauth-required` si hace más de 5 minutos que
// Tallami no confirma con su llave: `withReauth` hace la confirmación (pedir las
// opciones, que el navegador pida la huella, la cara o el PIN, y mandar la respuesta)
// y repite el pedido una sola vez.
//
// Si la confirmación no sale, tira un `ReauthError` con el aviso en español; no hay
// otro camino: el pedido original no se repite sin confirmar. Lo que haga el
// navegador puede fallar sin que el servidor se entere (Tallami cancela, la llave no
// está en este dispositivo): en ese caso no se llama a `finishReauthAction`.

import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { beginReauthAction, finishReauthAction } from "@/app/admin/configuracion/seguridad/actions";
import { UNAVAILABLE_MESSAGE, runCeremony } from "@/components/admin/login-ceremony";
import type { ReauthRequired } from "./results";

const NOT_CONFIRMED = "No pudimos confirmar que sos vos. Probá de nuevo.";
const CONFIRMATION_EXPIRED = "La confirmación venció. Probá de nuevo.";
const CONFIRMATION_UNAVAILABLE = "No pudimos confirmar que sos vos. Probá de nuevo en unos minutos.";

/** La confirmación con la llave no salió: el mensaje es para mostrarle a Tallami tal cual. */
export class ReauthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReauthError";
  }
}

function isReauthRequired(value: unknown): value is ReauthRequired {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === false &&
    "error" in value &&
    value.error === "reauth-required"
  );
}

/** El origen de esta pestaña: solo para el aviso de "las llaves solo funcionan en…" cuando no se pasa el configurado. */
function currentOrigin(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

/** Pide la llave y la verifica en el servidor, o tira `ReauthError` con el motivo. */
async function confirmWithKey(origin: string): Promise<void> {
  const outcome = await runCeremony<PublicKeyCredentialRequestOptionsJSON>(
    {
      begin: beginReauthAction,
      ask: (optionsJSON) => startAuthentication({ optionsJSON }),
      async finish(response) {
        const result = await finishReauthAction(response);
        return result.ok ? { ok: true, redirectTo: "" } : result;
      },
    },
    origin,
  );

  switch (outcome.kind) {
    case "done":
      return;
    case "restart":
      throw new ReauthError(CONFIRMATION_EXPIRED);
    case "failed":
      throw new ReauthError(NOT_CONFIRMED);
    case "message":
      throw new ReauthError(outcome.message === UNAVAILABLE_MESSAGE ? CONFIRMATION_UNAVAILABLE : outcome.message);
  }
}

/**
 * Corre `run` (una acción delicada). Si contesta `reauth-required`, confirma con la
 * llave y la repite una sola vez; si la repetición todavía pide confirmar, se rinde.
 * Cualquier otra respuesta, de éxito o de fallo, se devuelve tal cual. `origin` es el
 * origen configurado de las llaves (`getWebAuthnConfig().origin`), para el aviso de
 * "otra dirección".
 */
export async function withReauth<T>(
  run: () => Promise<T | ReauthRequired>,
  origin: string = currentOrigin(),
): Promise<T> {
  const first = await run();
  if (!isReauthRequired(first)) return first;

  await confirmWithKey(origin);

  const second = await run();
  if (isReauthRequired(second)) throw new ReauthError(NOT_CONFIRMED);
  return second;
}
