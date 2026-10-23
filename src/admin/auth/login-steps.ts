// El segundo paso del ingreso, lo que comparten sus páginas y sus acciones: usar
// una llave registrada (`/admin/login/llave`), registrar la primera
// (`/admin/login/primera-llave`) o, con un código generado en otro dispositivo,
// registrar la de este (también en `/admin/login/llave`; `redeemLoginCode` canjea el
// código y `finishLoginStep("code", …)` registra la llave). Ninguna pasa por
// `requireAdmin()`: son justamente lo que abre la sesión. Su verificación es el
// ingreso a medio camino de la cookie (`pending-logins.ts`): sin uno válido y del tipo
// que corresponde no se hace nada.
//
// Al terminar, el orden es el que protege (`finishLoginStep`):
//
// 1. reservar el intento antes de mirar la respuesta (`reserveLoginAttempt`), como
//    la contraseña: una ráfaga de pedidos no puede probar más de 5 (`rate-limit.ts`);
// 2. gastar el desafío (`takePendingChallenge`): cada respuesta se compara contra
//    él una sola vez y, si falla, el intento siguiente tiene que pedir otro;
// 3. verificar la respuesta; si no cierra, la reserva queda anotada como fallo
//    (llave de otro sitio, firma o contador malos, una llave que no es de acá);
// 4. gastar el ingreso (`consumePendingLogin`, un solo uso) ANTES de crear nada:
//    de dos pedidos con la misma respuesta, solo uno llega a abrir una sesión;
// 5. guardar lo que haga falta, abrir la sesión, cambiar la cookie del ingreso por
//    la de la sesión y avisar por email (después de responder: `notify.ts`).
//
// Los avisos nunca cambian lo que contesta el paso: salen con `after()` y no tiran.
// Un fallo que llena el tope de intentos avisa del bloqueo, una sola vez
// (`notifyIfJustBlocked`).

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getDb, type Db } from "../../db/client";
import { notifyIfJustBlocked } from "../alerts/blocked";
import { notifySecurityEvent } from "../alerts/notify";
import type { SecurityEvent } from "../alerts/render";
import { getMissingConfig } from "./config";
import type { LoginCodeRedeemed, LoginStepFailure, LoginStepSuccess } from "./login-errors";
import {
  PENDING_COOKIE,
  consumePendingLogin,
  pendingCookieOptions,
  readPendingLogin,
  switchPendingToCode,
  takePendingChallenge,
  type PendingLogin,
  type PendingMode,
} from "./pending-logins";
import { confirmLoginSuccess, isLoginBlocked, reserveLoginAttempt } from "./rate-limit";
import {
  FIRST_KEY_STEP_PATH,
  PASSKEY_STEP_PATH,
  SETUP_PATH,
  loginPath,
  loginStepPath,
  safeNextPath,
} from "./redirect";
import { shouldUseSecureCookie } from "./request";
import { hasAdminSession } from "./require-admin";
import { ADMIN_COOKIE, createSessionToken, sessionCookieOptions } from "./session";
import { createSession } from "./sessions";

const EXPIRED: LoginStepFailure = { ok: false, error: "expired" };
const BLOCKED: LoginStepFailure = { ok: false, error: "blocked" };
const FAILED: LoginStepFailure = { ok: false, error: "failed" };

/**
 * Qué se avisa por email al abrir la sesión, según el tipo de paso. La primera llave es
 * un registro y un ingreso a la vez, y avisa una sola vez como primera llave; un código
 * registra una llave nueva y además entra, así que son dos avisos.
 */
const EVENTS_BY_MODE: Record<PendingMode, readonly SecurityEvent[]> = {
  passkey: ["login"],
  "first-key": ["first-passkey"],
  code: ["passkey-added", "login"],
};

/** Programa los avisos del paso `mode` que acaba de abrir la sesión; los de llaves llevan el nombre de la llave. */
function notifyStepCompleted(mode: PendingMode, passkeyName: string | undefined): void {
  for (const event of EVENTS_BY_MODE[mode]) {
    if (event !== "login" && passkeyName !== undefined) notifySecurityEvent(event, { passkeyName });
    else notifySecurityEvent(event);
  }
}

/** Un ingreso a medio camino válido, con la base donde vive. */
export type PendingStep = { db: Db; pending: PendingLogin };

/** La página donde se completa un ingreso de tipo `mode` (los códigos también se canjean en la de la llave). */
export function stepPathFor(mode: PendingMode): string {
  return mode === "first-key" ? FIRST_KEY_STEP_PATH : PASSKEY_STEP_PATH;
}

async function pendingCookieValue(): Promise<string | undefined> {
  return (await cookies()).get(PENDING_COOKIE)?.value;
}

/** El ingreso a medio camino `id` (el valor de la cookie), si sigue valiendo (sin vencer ni usar). */
async function readPendingStep(id: string | undefined): Promise<PendingStep | null> {
  const db = await getDb();
  const pending = await readPendingLogin(db, id);
  return pending ? { db, pending } : null;
}

async function readRequestPending(): Promise<PendingStep | null> {
  return readPendingStep(await pendingCookieValue());
}

/**
 * Para empezar una ceremonia (pedir las opciones que van al navegador): el ingreso a
 * medio camino si es de tipo `mode` y la conexión no está bloqueada; si no, por qué.
 * Mirar el bloqueo acá solo ahorra pedirle la llave a quien ya no puede entrar: lo
 * que cuenta es la reserva de `finishLoginStep`.
 */
export async function beginLoginStep(mode: PendingMode): Promise<PendingStep | LoginStepFailure> {
  const step = await readRequestPending();
  if (step === null || step.pending.mode !== mode) return EXPIRED;
  if (await isLoginBlocked(step.db, step.pending.ipHash)) return BLOCKED;
  return step;
}

/** Cómo termina cada tipo de paso: qué verifica y qué guarda. */
export type StepCompletion<Verified> = {
  /** El nombre de la llave que registra este paso, si registra una: va en el aviso por email. */
  passkeyName?: string;
  /** Verifica la respuesta del navegador contra el desafío. `null` si no cierra: cuenta como intento fallido. */
  verify: (db: Db, challenge: string) => Promise<Verified | null>;
  /**
   * Con el ingreso ya gastado, guarda lo que corresponda y devuelve el id de la llave
   * con la que se entra, o `null` si ya no se puede (por ejemplo, otra pestaña
   * registró la primera llave mientras tanto): eso es volver a empezar.
   */
  commit: (db: Db, verified: Verified) => Promise<string | null>;
};

/**
 * Termina el segundo paso de tipo `mode`, en el orden de arriba. Los fallos cuentan
 * contra la conexión que puso la contraseña (`pending.ipHash`): el ingreso es uno
 * solo aunque el teléfono cambie de red en el medio. Si sale bien, la sesión queda
 * abierta (con la llave usada y la confirmación reciente), la cookie del ingreso
 * borrada y hay que ir a donde se iba (`redirectTo`).
 */
export async function finishLoginStep<Verified>(
  mode: PendingMode,
  completion: StepCompletion<Verified>,
): Promise<LoginStepSuccess | LoginStepFailure> {
  const step = await readRequestPending();
  if (step === null || step.pending.mode !== mode) return EXPIRED;
  const { db, pending } = step;

  const attemptId = await reserveLoginAttempt(db, pending.ipHash);
  if (attemptId === null) return BLOCKED;
  const challenge = await takePendingChallenge(db, pending.id);
  const verified = challenge === null ? null : await completion.verify(db, challenge);
  if (verified === null) {
    await notifyIfJustBlocked(db, pending.ipHash);
    return FAILED;
  }

  // La llave es buena: pase lo que pase con el ingreso, este intento no es un fallo.
  await confirmLoginSuccess(db, attemptId);
  if (!(await consumePendingLogin(db, pending.id))) return EXPIRED;
  const passkeyId = await completion.commit(db, verified);
  if (passkeyId === null) return EXPIRED;

  const sessionId = await createSession(db, { passkeyId, device: pending.device, reauthed: true });
  const secure = shouldUseSecureCookie(await headers());
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, await createSessionToken(sessionId), sessionCookieOptions(secure));
  cookieStore.delete({ name: PENDING_COOKIE, path: pendingCookieOptions(secure).path });
  notifyStepCompleted(mode, completion.passkeyName);
  return { ok: true, redirectTo: pending.nextPath };
}

/**
 * Canjea el código para otro dispositivo en un ingreso de tipo `passkey` y, si sirve,
 * lo pasa a tipo `code`: falta registrar la llave de este dispositivo
 * (`finishLoginStep("code", …)`). No abre ninguna sesión. Va en el mismo orden que
 * `finishLoginStep`:
 *
 * 1. reservar el intento antes de mirar el código: una ráfaga de pedidos no puede
 *    probar más de 5 (`rate-limit.ts`);
 * 2. canjear (`redeem`, que gasta el código: un solo uso); si no sirve, la reserva
 *    queda anotada como fallo (código incorrecto, vencido, usado, o de una sesión que
 *    se cerró);
 * 3. con el código bueno, confirmar el éxito y cambiar el tipo del ingreso. Si el
 *    ingreso venció justo en el medio, `expired`: el código ya se gastó y hay que
 *    generar otro.
 *
 * Solo parte de un ingreso `passkey`: uno de primera llave no tiene ninguna sesión de
 * la que pueda haber salido un código, y uno que ya canjeó uno no necesita otro.
 */
export async function redeemLoginCode(
  redeem: (db: Db) => Promise<boolean>,
): Promise<LoginCodeRedeemed | LoginStepFailure> {
  const step = await readRequestPending();
  if (step === null || step.pending.mode !== "passkey") return EXPIRED;
  const { db, pending } = step;

  const attemptId = await reserveLoginAttempt(db, pending.ipHash);
  if (attemptId === null) return BLOCKED;
  if (!(await redeem(db))) {
    await notifyIfJustBlocked(db, pending.ipHash);
    return FAILED;
  }

  await confirmLoginSuccess(db, attemptId);
  return (await switchPendingToCode(db, pending.id)) ? { ok: true } : EXPIRED;
}

/** Lo que muestra la página de un paso: el paso mismo, o que la sesión ya está abierta. */
export type LoginStepPage = { kind: "step"; pending: PendingLogin } | { kind: "signed-in" };

/**
 * Qué corresponde mostrar en la página `page` (`PASSKEY_STEP_PATH` o
 * `FIRST_KEY_STEP_PATH`). `rawNext` es el `?next=` de la dirección: solo se usa
 * para volver a empezar si el ingreso venció.
 *
 * - panel sin configurar → `/admin/setup`;
 * - un ingreso válido que se completa en la otra página → esa página;
 * - un ingreso válido de esta página → el paso;
 * - sin ingreso válido, con la sesión ya abierta → `signed-in`. No redirige a
 *   propósito: al terminar el paso, Next vuelve a dibujar esta misma página con la
 *   cookie nueva (cambió una cookie) en la respuesta de la acción, y una
 *   redirección acá competiría con la del navegador hacia `redirectTo`;
 * - sin ingreso ni sesión → al login, con "Tu ingreso venció, empezá de nuevo".
 */
export async function loadLoginStep(page: string, rawNext: unknown): Promise<LoginStepPage> {
  // Primero el dato del pedido (la cookie), después las redirecciones: ver `readCookieClaims` en `require-admin.ts`.
  const pendingId = await pendingCookieValue();
  if (getMissingConfig().length > 0) redirect(SETUP_PATH);
  // Lo que sigue (la base, la hora) es solo de un pedido de verdad: el prerender que Next
  // hace de antemano para navegar más rápido (con las cookies) se detiene acá.
  await connection();

  const step = await readPendingStep(pendingId);
  if (step !== null) {
    const target = stepPathFor(step.pending.mode);
    if (target !== page) redirect(loginStepPath(target, step.pending.nextPath));
    return { kind: "step", pending: step.pending };
  }
  if (await hasAdminSession()) return { kind: "signed-in" };
  redirect(loginPath({ next: safeNextPath(rawNext), error: "expired" }));
}
