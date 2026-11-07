// Lo que alguien pide desde el sitio sin entrar: arrepentimiento, baja de servicio o contacto.
// Los errores de validación vuelven como códigos (`required`, `invalid`, `too-long`) que el
// formulario traduce. El código de seguimiento se devuelve aunque el email de constancia no salga.

import { randomInt } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { siteRequests } from "@/db/schema";
import { isUuid } from "@/db/uuid";
import type { EmailDeps } from "@/email/send";
import { routing, type Locale } from "@/i18n/routing";
import type { SiteRequestKind } from "@/payments/policy";
import { isOverPublicFormLimit } from "@/public-forms/guard";
import { notifySiteRequest } from "./emails";

export type SiteRequest = typeof siteRequests.$inferSelect;

export const SITE_REQUEST_LIMITS = { name: 200, email: 254, orderReference: 200, message: 2000 } as const;

/** Sin 0/O ni 1/I/L: un código que se dicta o se copia a mano no se confunde. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_ATTEMPTS = 5;
const CODE_PREFIXES: Record<SiteRequestKind, string> = { withdrawal: "ARR", cancellation: "BAJ", contact: "CON" };
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NUL = "\u0000";

/** Lo que llega del formulario: todo texto. */
export interface SiteRequestInput {
  name: string;
  email: string;
  orderReference: string;
  message: string;
  locale: string;
}

export interface SiteRequestContext {
  /** El HMAC de la conexión (`publicFormIpHash`), o `null`. */
  ipHash: string | null;
  /** Llenaron el campo trampa: se responde que salió bien y no se guarda. */
  honeypotFilled: boolean;
}

export type SubmitSiteRequestResult =
  | { ok: true; code: string }
  | { ok: false; fieldErrors: Record<string, string> }
  | { ok: false; limited: true };

function clean(value: string): string {
  return value.replaceAll(NUL, "").trim();
}

function siteLocale(value: string): Locale {
  return routing.locales.find((locale) => locale === value) ?? routing.defaultLocale;
}

export function newRequestCode(kind: SiteRequestKind): string {
  const chars = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]);
  return `${CODE_PREFIXES[kind]}-${chars.join("")}`;
}

function validate(kind: SiteRequestKind, input: SiteRequestInput): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = clean(input.name);
  const email = clean(input.email);
  const message = clean(input.message);
  if (name === "") errors.name = "required";
  else if (name.length > SITE_REQUEST_LIMITS.name) errors.name = "too-long";
  if (email === "") errors.email = "required";
  else if (email.length > SITE_REQUEST_LIMITS.email) errors.email = "too-long";
  else if (!EMAIL_SHAPE.test(email)) errors.email = "invalid";
  if (clean(input.orderReference).length > SITE_REQUEST_LIMITS.orderReference) errors.orderReference = "too-long";
  if (kind === "contact" && message === "") errors.message = "required";
  else if (message.length > SITE_REQUEST_LIMITS.message) errors.message = "too-long";
  return errors;
}

async function insertWithCode(db: Db, kind: SiteRequestKind, values: Omit<typeof siteRequests.$inferInsert, "kind" | "code">) {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const [saved] = await db
      .insert(siteRequests)
      .values({ ...values, kind, code: newRequestCode(kind) })
      .onConflictDoNothing({ target: siteRequests.code })
      .returning();
    if (saved) return saved;
  }
  throw new Error("No se pudo generar un código de seguimiento libre.");
}

/**
 * Guarda el pedido, avisa a quien escribió (arrepentimiento y baja) y a Tallami, y devuelve el
 * código de seguimiento. Un email que no sale no cambia el resultado: `emailSentAt` queda en `null`.
 */
export async function submitSiteRequest(
  db: Db,
  kind: SiteRequestKind,
  input: SiteRequestInput,
  context: SiteRequestContext,
  deps: EmailDeps = {},
  now: Date = new Date(),
): Promise<SubmitSiteRequestResult> {
  if (context.honeypotFilled) return { ok: true, code: newRequestCode(kind) };
  const fieldErrors = validate(kind, input);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  if (await isOverPublicFormLimit(db, "siteRequests", context.ipHash, now)) return { ok: false, limited: true };

  const message = clean(input.message);
  const reference = clean(input.orderReference);
  const saved = await insertWithCode(db, kind, {
    name: clean(input.name),
    email: clean(input.email),
    orderReference: reference === "" ? null : reference,
    message: message === "" ? null : message,
    locale: siteLocale(input.locale),
    ipHash: context.ipHash,
    createdAt: now,
  });
  if (await notifySiteRequest(saved, deps)) {
    await db.update(siteRequests).set({ emailSentAt: now }).where(eq(siteRequests.id, saved.id));
  }
  return { ok: true, code: saved.code };
}

/** Todos, del más nuevo al más viejo. */
export async function listSiteRequests(db: Db): Promise<SiteRequest[]> {
  return db.select().from(siteRequests).orderBy(desc(siteRequests.createdAt), desc(siteRequests.id));
}

/** Lo marca atendido. `false` si ya no existe. */
export async function markSiteRequestHandled(db: Db, id: string, now: Date = new Date()): Promise<boolean> {
  if (!isUuid(id)) return false;
  const updated = await db
    .update(siteRequests)
    .set({ status: "handled", handledAt: now })
    .where(eq(siteRequests.id, id))
    .returning({ id: siteRequests.id });
  return updated.length > 0;
}

export async function deleteSiteRequest(db: Db, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  const deleted = await db.delete(siteRequests).where(eq(siteRequests.id, id)).returning({ id: siteRequests.id });
  return deleted.length > 0;
}
