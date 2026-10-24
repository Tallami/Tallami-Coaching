// Los motivos por los que el login vuelve a mostrarse con un aviso. Viajan en
// la dirección (`/admin/login?error=invalid`), así el formulario funciona
// también sin JavaScript.

/**
 * El motivo con el que `requireAdmin()` y el `proxy` mandan al login a quien tenía el panel abierto
 * y ya no tiene sesión (se cerró por inactividad, por las 8 horas, o desde otro dispositivo). El login
 * lo avisa y deja la marca para que los formularios recuperen lo escrito (`draft-store.ts`).
 */
export const SESSION_ENDED_ERROR = "vencida";

/**
 * `expired`: el ingreso a medio camino (contraseña bien, falta la llave) venció o ya se usó.
 * `vencida`: la sesión del panel terminó mientras se usaba (`SESSION_ENDED_ERROR`).
 */
export const LOGIN_ERRORS = ["invalid", "blocked", "unavailable", "expired", SESSION_ENDED_ERROR] as const;

export type LoginErrorCode = (typeof LOGIN_ERRORS)[number];

/** El código de error de la dirección, o `null` si no hay o no es uno conocido. */
export function parseLoginError(raw: unknown): LoginErrorCode | null {
  return LOGIN_ERRORS.find((code) => code === raw) ?? null;
}

/**
 * Por qué no se pudo seguir con el segundo paso (la llave o la primera llave):
 * - `expired`: no hay un ingreso a medio camino que sirva (sin cookie, vencido,
 *   ya usado, o de otro tipo): hay que volver a empezar desde la contraseña;
 * - `blocked`: esta conexión llegó al tope de intentos fallidos;
 * - `failed`: la llave no se pudo verificar (cuenta como intento fallido).
 */
export type LoginStepFailure = { ok: false; error: "expired" | "blocked" | "failed" };

/** El segundo paso salió bien: la sesión ya está abierta y hay que ir a `redirectTo`. */
export type LoginStepSuccess = { ok: true; redirectTo: string };

/** El código para otro dispositivo sirvió: todavía no hay sesión, falta registrar la llave de este dispositivo. */
export type LoginCodeRedeemed = { ok: true };
