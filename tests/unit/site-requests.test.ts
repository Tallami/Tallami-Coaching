import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@/db/client";
import { siteRequests } from "@/db/schema";
import type { EmailMessage } from "@/email/send";
import { PUBLIC_FORM_GLOBAL_MAX_PER_HOUR, PUBLIC_FORM_MAX_PER_HOUR } from "@/public-forms/guard";
import {
  deleteSiteRequest,
  listSiteRequests,
  markSiteRequestHandled,
  submitSiteRequest,
  SITE_REQUEST_LIMITS,
  type SiteRequestInput,
} from "@/site-requests/requests";
import { createTestDb } from "../helpers/db";

const NOW = new Date("2026-11-05T12:00:00.000-03:00");
const IP_HASH = "hash-de-una-conexion";
const CODE = { withdrawal: /^ARR-[A-HJ-NP-Z2-9]{6}$/, cancellation: /^BAJ-[A-HJ-NP-Z2-9]{6}$/, contact: /^CON-[A-HJ-NP-Z2-9]{6}$/ };

let db: Db;
let sent: EmailMessage[];
let transportFails: boolean;
const transport = vi.fn(async (message: EmailMessage) => {
  if (transportFails) throw new Error("sin red");
  sent.push(message);
});

function validInput(overrides: Partial<SiteRequestInput> = {}): SiteRequestInput {
  return { name: "Ana Alumna", email: "ana@example.com", orderReference: "", message: "Quiero pedir esto.", locale: "es", ...overrides };
}

function submit(
  kind: "withdrawal" | "cancellation" | "contact",
  overrides: Partial<SiteRequestInput> = {},
  context: { ipHash?: string | null; honeypotFilled?: boolean } = {},
) {
  return submitSiteRequest(db, kind, validInput(overrides), { ipHash: IP_HASH, honeypotFilled: false, ...context }, { transport }, NOW);
}

async function stored() {
  return db.select().from(siteRequests);
}

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
  transportFails = false;
  transport.mockClear();
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("ADMIN_ALERT_EMAIL", "tallami@example.com");
  vi.stubEnv("ADMIN_ALERT_FROM", "Panel <panel@example.com>");
  vi.stubEnv("PUBLIC_EMAIL_FROM", "Tallami <pagos@example.com>");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("submitSiteRequest", () => {
  test.each(["withdrawal", "cancellation", "contact"] as const)("%s is saved and returns a code with its prefix", async (kind) => {
    const result = await submit(kind);

    expect(result.ok).toBe(true);
    if (!result.ok || !("code" in result)) throw new Error("se esperaba un código");
    expect(result.code).toMatch(CODE[kind]);
    const [row] = await stored();
    expect(row).toMatchObject({ kind, code: result.code, name: "Ana Alumna", email: "ana@example.com", status: "new", locale: "es", ipHash: IP_HASH });
  });

  test("two requests get two different codes", async () => {
    const first = await submit("withdrawal");
    const second = await submit("withdrawal");

    expect(first.ok && second.ok && first.code !== second.code).toBe(true);
    expect(await stored()).toHaveLength(2);
  });

  test.each(["withdrawal", "cancellation"] as const)("%s emails the requester in their language with the code, and Tallami", async (kind) => {
    const result = await submit(kind, { locale: "pt", orderReference: "pedido 123" });
    if (!result.ok || !("code" in result)) throw new Error("se esperaba un código");

    const toRequester = sent.find(({ to }) => to === "ana@example.com");
    const toTallami = sent.find(({ to }) => to === "tallami@example.com");
    expect(sent).toHaveLength(2);
    expect(toRequester?.text).toContain(result.code);
    expect(toRequester?.subject).toContain(result.code);
    expect(toRequester?.text).toMatch(/Olá|recebemos|Recebemos/);
    expect(toTallami?.text).toContain(result.code);
    expect(toTallami?.text).toContain("ana@example.com");
    expect(toTallami?.text).toContain("pedido 123");
    expect(toTallami?.text).toContain("/admin/pedidos");
    // Tallami contesta con un clic; la constancia de quien escribió no lleva ninguna dirección de él.
    expect(toTallami?.replyTo).toBe("ana@example.com");
    expect(toRequester).not.toHaveProperty("replyTo");
    const [row] = await stored();
    expect(row.emailSentAt).toEqual(NOW);
  });

  test("the requester email is written in english and in spanish too", async () => {
    await submit("withdrawal", { locale: "en" });
    await submit("cancellation", { locale: "es" });

    expect(sent.find(({ to }) => to === "ana@example.com")?.text).toMatch(/Hi|received/);
    expect(sent.filter(({ to }) => to === "ana@example.com")[1].text).toMatch(/Hola/);
  });

  test("a contact message only goes to Tallami", async () => {
    await submit("contact");

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("tallami@example.com");
    expect(sent[0].text).toContain("Quiero pedir esto.");
    expect(sent[0].replyTo).toBe("ana@example.com");
    expect((await stored())[0].emailSentAt).toEqual(NOW);
  });

  test("when the transport fails, emailSentAt stays null and the code is returned anyway", async () => {
    transportFails = true;

    const result = await submit("withdrawal");

    expect(result.ok && "code" in result && CODE.withdrawal.test(result.code)).toBe(true);
    const [row] = await stored();
    expect(row.emailSentAt).toBeNull();
  });

  test.each([
    ["name", { name: "  " }, "required"],
    ["email", { email: "" }, "required"],
    ["email", { email: "no-es-un-email" }, "invalid"],
  ] as const)("a wrong %s is an error of that field", async (field, overrides, code) => {
    const result = await submit("withdrawal", overrides);

    expect(result).toEqual({ ok: false, fieldErrors: { [field]: code } });
    expect(await stored()).toEqual([]);
    expect(sent).toEqual([]);
  });

  test("contact requires a message, withdrawal and cancellation do not", async () => {
    expect(await submit("contact", { message: "   " })).toEqual({ ok: false, fieldErrors: { message: "required" } });
    expect((await submit("withdrawal", { message: "" })).ok).toBe(true);
    expect((await submit("cancellation", { message: "" })).ok).toBe(true);
    expect((await stored()).filter(({ kind }) => kind !== "contact")).toSatisfy((rows: { message: string | null }[]) => rows.every(({ message }) => message === null));
  });

  test("a message of 2000 characters passes and one of 2001 is rejected", async () => {
    expect(SITE_REQUEST_LIMITS.message).toBe(2000);
    expect((await submit("contact", { message: "a".repeat(2000) })).ok).toBe(true);

    expect(await submit("contact", { message: "a".repeat(2001) })).toEqual({ ok: false, fieldErrors: { message: "too-long" } });
  });

  test("the honeypot answers as if it worked and saves nothing", async () => {
    const result = await submit("withdrawal", {}, { honeypotFilled: true });

    expect(result.ok).toBe(true);
    expect(await stored()).toEqual([]);
    expect(sent).toEqual([]);
  });

  test("the sixth request from one connection in an hour is limited", async () => {
    for (let n = 0; n < PUBLIC_FORM_MAX_PER_HOUR; n += 1) expect((await submit("contact")).ok).toBe(true);

    expect(await submit("contact")).toEqual({ ok: false, limited: true });
    expect((await submit("contact", {}, { ipHash: "otra-conexion" })).ok).toBe(true);
    expect(await stored()).toHaveLength(PUBLIC_FORM_MAX_PER_HOUR + 1);
  });

  test("the whole site is limited too", async () => {
    const rows = Array.from({ length: PUBLIC_FORM_GLOBAL_MAX_PER_HOUR }, (_, n) => ({
      kind: "contact",
      code: `CON-TEST${String(n).padStart(2, "0")}`,
      name: "x",
      email: "x@example.com",
      locale: "es",
      createdAt: NOW,
    }));
    await db.insert(siteRequests).values(rows);

    expect(await submit("contact", {}, { ipHash: "una-nueva" })).toEqual({ ok: false, limited: true });
  });

  test("the cap of the whole site counts each kind apart: contact spam does not block a withdrawal or a cancellation", async () => {
    const rows = Array.from({ length: PUBLIC_FORM_GLOBAL_MAX_PER_HOUR }, (_, n) => ({
      kind: "contact",
      code: `CON-SPAM${String(n).padStart(2, "0")}`,
      name: "x",
      email: "x@example.com",
      locale: "es",
      createdAt: NOW,
    }));
    await db.insert(siteRequests).values(rows);

    expect(await submit("contact", {}, { ipHash: "una-nueva" })).toEqual({ ok: false, limited: true });
    expect((await submit("withdrawal", {}, { ipHash: "una-nueva" })).ok).toBe(true);
    expect((await submit("cancellation", { orderReference: "Pedido 1" }, { ipHash: "otra-nueva" })).ok).toBe(true);
  });

  test("the cap of one connection still counts every kind together", async () => {
    for (let n = 0; n < PUBLIC_FORM_MAX_PER_HOUR; n += 1) expect((await submit("contact")).ok).toBe(true);

    expect(await submit("withdrawal")).toEqual({ ok: false, limited: true });
  });
});

describe("panel operations", () => {
  test("lists newest first, marks handled and deletes", async () => {
    await submitSiteRequest(db, "contact", validInput({ name: "Vieja" }), { ipHash: null, honeypotFilled: false }, { transport }, new Date(NOW.getTime() - 1000));
    await submit("contact", { name: "Nueva" });
    const [first, second] = await listSiteRequests(db);
    expect([first.name, second.name]).toEqual(["Nueva", "Vieja"]);

    const later = new Date(NOW.getTime() + 5000);
    expect(await markSiteRequestHandled(db, first.id, later)).toBe(true);
    const handled = (await listSiteRequests(db))[0];
    expect(handled).toMatchObject({ status: "handled", handledAt: later });

    expect(await deleteSiteRequest(db, first.id)).toBe(true);
    expect(await listSiteRequests(db)).toHaveLength(1);
    expect(await deleteSiteRequest(db, first.id)).toBe(false);
    expect(await markSiteRequestHandled(db, "no-es-un-id")).toBe(false);
    expect(await deleteSiteRequest(db, "no-es-un-id")).toBe(false);
  });
});
