// Los motivos por los que el login vuelve a mostrarse con un aviso. Viajan en
// la dirección (`/admin/login?error=invalid`), así el formulario funciona
// también sin JavaScript.

export const LOGIN_ERRORS = ["invalid", "blocked", "unavailable"] as const;

export type LoginErrorCode = (typeof LOGIN_ERRORS)[number];

/** El código de error de la dirección, o `null` si no hay o no es uno conocido. */
export function parseLoginError(raw: unknown): LoginErrorCode | null {
  return LOGIN_ERRORS.find((code) => code === raw) ?? null;
}
