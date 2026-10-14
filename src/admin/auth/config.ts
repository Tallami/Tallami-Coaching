// Lo que el panel necesita configurar para abrir, y la página `/admin/setup`
// que lo explica. Se lee de las variables de entorno en cada pedido.
//
// Solo se informan nombres de variables y el tipo de problema: nunca valores
// (la página de configuración es pública, porque se necesita justamente
// cuando todavía no se puede iniciar sesión).

import { isDbConfigured } from "../../db/config";
import { parseStoredHash } from "./password";

/** Largo mínimo del secreto que firma las sesiones. */
export const MIN_SESSION_SECRET_LENGTH = 32;

export type ConfigVariable = "ADMIN_PASSWORD_HASH" | "ADMIN_SESSION_SECRET" | "DATABASE_URL";
export type ConfigProblem = "missing" | "invalid" | "too-short";

export interface MissingConfig {
  name: ConfigVariable;
  problem: ConfigProblem;
}

/** El hash de la contraseña, o `null` si falta o no tiene el formato esperado. */
export function getPasswordHash(): string | null {
  const value = process.env.ADMIN_PASSWORD_HASH?.trim();
  return value && parseStoredHash(value) ? value : null;
}

/** El secreto de las sesiones, o `null` si falta o es más corto que el mínimo. */
export function getSessionSecret(): Uint8Array | null {
  const value = process.env.ADMIN_SESSION_SECRET;
  if (!value || value.length < MIN_SESSION_SECRET_LENGTH) return null;
  return new TextEncoder().encode(value);
}

/** Lo que falta para que el panel abra; vacío cuando está todo listo. */
export function getMissingConfig(): MissingConfig[] {
  const missing: MissingConfig[] = [];

  const hash = process.env.ADMIN_PASSWORD_HASH?.trim();
  if (!hash) missing.push({ name: "ADMIN_PASSWORD_HASH", problem: "missing" });
  else if (!parseStoredHash(hash)) missing.push({ name: "ADMIN_PASSWORD_HASH", problem: "invalid" });

  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) missing.push({ name: "ADMIN_SESSION_SECRET", problem: "missing" });
  else if (secret.length < MIN_SESSION_SECRET_LENGTH) {
    missing.push({ name: "ADMIN_SESSION_SECRET", problem: "too-short" });
  }

  if (!isDbConfigured()) missing.push({ name: "DATABASE_URL", problem: "missing" });

  return missing;
}
