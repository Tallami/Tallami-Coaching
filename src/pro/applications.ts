// Las aplicaciones a la Temporada Pro: guardar la del formulario público y lo que el panel
// hace con ellas. Los errores de validación vuelven como códigos (`required`, `too-long`) que
// el formulario traduce al idioma de quien lo llena.

import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { proApplications } from "@/db/schema";
import { isUuid } from "@/db/uuid";
import type { EmailDeps } from "@/email/send";
import { routing, type Locale } from "@/i18n/routing";
import { notifyProApplication } from "@/payments/emails";
import { PRO_APPLICATION_STATUSES, type ProApplicationStatus } from "@/payments/policy";
import { isOverPublicFormLimit } from "@/public-forms/guard";

export type ProApplication = typeof proApplications.$inferSelect;

export const PRO_APPLICATION_LIMITS = { name: 200, discord: 200, teamMembers: 2000, results: 2000, message: 2000 } as const;

/** Lo que llega del formulario: todo texto. */
export interface ProApplicationInput {
  name: string;
  discord: string;
  teamMembers: string;
  results: string;
  message: string;
  privacy: boolean;
  locale: string;
}

export interface ProApplicationContext {
  /** El HMAC de la conexión (`publicFormIpHash`), o `null`. */
  ipHash: string | null;
  /** Llenaron el campo trampa: se responde que salió bien y no se guarda. */
  honeypotFilled: boolean;
  emailDeps?: EmailDeps;
}

export type FieldErrorCode = "required" | "too-long";
export type SubmitResult =
  | { ok: true }
  | { ok: false; fieldErrors: Record<string, string> }
  | { ok: false; limited: true };

const NUL = "\u0000";
const TEXT_FIELDS = ["name", "discord", "teamMembers", "results"] as const;

function clean(value: string): string {
  return value.replaceAll(NUL, "").trim();
}

function siteLocale(value: string): Locale {
  return routing.locales.find((locale) => locale === value) ?? routing.defaultLocale;
}

function validate(input: ProApplicationInput): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of TEXT_FIELDS) {
    const value = clean(input[field]);
    if (value === "") errors[field] = "required";
    else if (value.length > PRO_APPLICATION_LIMITS[field]) errors[field] = "too-long";
  }
  if (clean(input.message).length > PRO_APPLICATION_LIMITS.message) errors.message = "too-long";
  if (!input.privacy) errors.privacy = "required";
  return errors;
}

/**
 * Guarda una aplicación y le avisa a Tallami. El aviso que no sale no cambia el resultado.
 * Nunca guarda con el campo trampa lleno ni pasados los topes.
 */
export async function submitProApplication(
  db: Db,
  input: ProApplicationInput,
  context: ProApplicationContext,
  now: Date = new Date(),
): Promise<SubmitResult> {
  if (context.honeypotFilled) return { ok: true };
  const fieldErrors = validate(input);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  if (await isOverPublicFormLimit(db, "proApplications", context.ipHash, now)) return { ok: false, limited: true };

  const message = clean(input.message);
  const [saved] = await db
    .insert(proApplications)
    .values({
      name: clean(input.name),
      discord: clean(input.discord),
      teamMembers: clean(input.teamMembers),
      results: clean(input.results),
      message: message === "" ? null : message,
      locale: siteLocale(input.locale),
      ipHash: context.ipHash,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await notifyProApplication(saved, context.emailDeps);
  return { ok: true };
}

/** Todas, de la más nueva a la más vieja. */
export async function listProApplications(db: Db): Promise<ProApplication[]> {
  return db.select().from(proApplications).orderBy(desc(proApplications.createdAt), desc(proApplications.id));
}

/** La aplicación `id`, o `null` si no existe (o no es un id). */
export async function getProApplication(db: Db, id: string): Promise<ProApplication | null> {
  if (!isUuid(id)) return null;
  const [row] = await db.select().from(proApplications).where(eq(proApplications.id, id));
  return row ?? null;
}

/** Cambia el estado. `false` si el estado no existe o la aplicación ya no está. */
export async function setProApplicationStatus(db: Db, id: string, status: string): Promise<boolean> {
  const known = PRO_APPLICATION_STATUSES.find((candidate) => candidate === status);
  if (!known || !isUuid(id)) return false;
  const updated = await db
    .update(proApplications)
    .set({ status: known satisfies ProApplicationStatus })
    .where(eq(proApplications.id, id))
    .returning({ id: proApplications.id });
  return updated.length > 0;
}

/** Borra la aplicación y sus links. Los pedidos y las ventas quedan (el pedido pierde la referencia al link). */
export async function deleteProApplication(db: Db, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db.delete(proApplications).where(eq(proApplications.id, id)).returning({ id: proApplications.id });
  return deleted.length > 0;
}
