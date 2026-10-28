// Las cuentas del portal del alumno (`portal_accounts`). Una cuenta es una
// identidad de Discord o Google (proveedor + id del usuario en ese proveedor); lo
// único que se guarda de la persona es su nombre para mostrar y el email, y solo
// si el proveedor lo da verificado. Se vincula a un alumno del panel (`customers`)
// con una invitación: una cuenta tiene como mucho un alumno y un alumno como
// mucho una cuenta.
//
// Lo que sale de acá hacia el resto del portal es un `PortalAccount`, con campos
// explícitos: nunca la fila entera de la tabla.

import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { portalAccounts } from "../db/schema";
import type { PortalProvider } from "./config";

/** Lo que el portal sabe de una cuenta. */
export type PortalAccount = {
  id: string;
  provider: PortalProvider;
  displayName: string;
  email: string | null;
  /** El alumno del panel al que está vinculada, o `null` si todavía no se vinculó. */
  customerId: string | null;
};

/** Lo que dice un proveedor de quien ingresó. */
export type ProviderIdentity = {
  provider: PortalProvider;
  providerUserId: string;
  displayName: string;
  /** El email, solo si el proveedor lo da y está verificado. */
  email: string | null;
};

/** Cómo termina `linkAccountToCustomer`. */
export type LinkResult = "linked" | "account-linked-elsewhere" | "customer-has-account";

const ACCOUNT_COLUMNS = {
  id: portalAccounts.id,
  provider: portalAccounts.provider,
  displayName: portalAccounts.displayName,
  email: portalAccounts.email,
  customerId: portalAccounts.customerId,
};

/**
 * La fila como la devuelve la base. El proveedor llega como texto: la restricción
 * `portal_accounts_provider_valid` garantiza que sea uno de la lista.
 */
function toAccount(row: Omit<PortalAccount, "provider"> & { provider: string }): PortalAccount {
  return { ...row, provider: row.provider as PortalProvider };
}

/** Código de Postgres de una violación de restricción `unique`. */
const UNIQUE_VIOLATION = "23505";

/** Drizzle envuelve el error de Postgres: el código está en `cause` (o en el propio error). */
function isUniqueViolation(error: unknown): boolean {
  const pgError = (error as { cause?: unknown } | null)?.cause ?? error;
  return (pgError as { code?: string } | null)?.code === UNIQUE_VIOLATION;
}

/**
 * La cuenta de esta identidad, creada si no existía. La misma identidad dos veces es
 * la misma cuenta: se actualizan el nombre, el email (puede dejar de venir) y la hora
 * del último ingreso, y el vínculo con el alumno se conserva. Es un solo
 * `insert … on conflict`, así dos ingresos a la vez no crean dos cuentas.
 */
export async function upsertAccountFromIdentity(
  db: Db,
  identity: ProviderIdentity,
  now: Date = new Date(),
): Promise<PortalAccount> {
  const [account] = await db
    .insert(portalAccounts)
    .values({
      provider: identity.provider,
      providerUserId: identity.providerUserId,
      displayName: identity.displayName,
      email: identity.email,
      createdAt: now,
      lastLoginAt: now,
    })
    .onConflictDoUpdate({
      target: [portalAccounts.provider, portalAccounts.providerUserId],
      set: { displayName: identity.displayName, email: identity.email, lastLoginAt: now },
    })
    .returning(ACCOUNT_COLUMNS);
  return toAccount(account);
}

/** La cuenta `id`, o `null` si no existe. */
export async function getAccount(db: Db, id: string): Promise<PortalAccount | null> {
  const [account] = await db.select(ACCOUNT_COLUMNS).from(portalAccounts).where(eq(portalAccounts.id, id));
  return account ? toAccount(account) : null;
}

/** La cuenta vinculada al alumno `customerId`, o `null` si no tiene. */
export async function accountForCustomer(db: Db, customerId: string): Promise<PortalAccount | null> {
  const [account] = await db
    .select(ACCOUNT_COLUMNS)
    .from(portalAccounts)
    .where(eq(portalAccounts.customerId, customerId));
  return account ? toAccount(account) : null;
}

/**
 * Vincula la cuenta al alumno. Es atómico: un solo `update` que solo toca una cuenta
 * todavía libre, y la restricción `unique` de la base decide cuando dos cuentas
 * pelean por el mismo alumno (una gana, la otra recibe `"customer-has-account"`).
 *
 * - `"linked"`: quedó vinculada (también si ya lo estaba a este mismo alumno).
 * - `"account-linked-elsewhere"`: la cuenta ya es de otro alumno; no se toca.
 * - `"customer-has-account"`: el alumno ya tiene otra cuenta; no se toca nada.
 *
 * Tira si la cuenta no existe o si el alumno no existe (la clave foránea lo rechaza):
 * son errores de quien llama, no un resultado. El `update` corre en su propia transacción (un
 * savepoint, si quien llama ya abrió una), así el rechazo de la base no deja abortada
 * la transacción de quien llama.
 */
export async function linkAccountToCustomer(
  db: Db,
  accountId: string,
  customerId: string,
): Promise<LinkResult> {
  try {
    const linked = await db.transaction(async (tx) => {
      const rows = await tx
        .update(portalAccounts)
        .set({ customerId })
        .where(and(eq(portalAccounts.id, accountId), isNull(portalAccounts.customerId)))
        .returning({ id: portalAccounts.id });
      return rows.length > 0;
    });
    if (linked) return "linked";
  } catch (error) {
    if (isUniqueViolation(error)) return "customer-has-account";
    throw error;
  }

  // El update no tocó nada: la cuenta no existe o ya tenía alumno.
  const account = await getAccount(db, accountId);
  if (!account) throw new Error("La cuenta del portal no existe.");
  return account.customerId === customerId ? "linked" : "account-linked-elsewhere";
}

/**
 * Suelta la cuenta del alumno y devuelve el id de la cuenta desvinculada, o `null` si
 * no tenía. La cuenta sigue existiendo; cerrar sus sesiones (`revokeAccountSessions`)
 * es de quien desvincula.
 */
export async function unlinkCustomer(db: Db, customerId: string): Promise<string | null> {
  const [unlinked] = await db
    .update(portalAccounts)
    .set({ customerId: null })
    .where(eq(portalAccounts.customerId, customerId))
    .returning({ id: portalAccounts.id });
  return unlinked?.id ?? null;
}

/**
 * Borra la cuenta del alumno, con sus sesiones (`on delete cascade`). El alumno, sus
 * ventas y sus entregas siguen en el panel. No hace nada si no tenía cuenta.
 */
export async function deleteAccountOfCustomer(db: Db, customerId: string): Promise<void> {
  await db.delete(portalAccounts).where(eq(portalAccounts.customerId, customerId));
}
