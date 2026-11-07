import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Db } from "@/db/client";
import { orders, proApplications, sales } from "@/db/schema";
import type { EmailMessage } from "@/email/send";
import {
  deleteProApplication,
  getProApplication,
  listProApplications,
  setProApplicationStatus,
  submitProApplication,
  type ProApplicationInput,
} from "@/pro/applications";
import { createProPaymentLink } from "@/pro/payment-links";
import {
  isHoneypotFilled,
  isOverPublicFormLimit,
  PUBLIC_FORM_GLOBAL_MAX_PER_HOUR,
  PUBLIC_FORM_MAX_PER_HOUR,
  publicFormIpHash,
} from "@/public-forms/guard";
import { createTestDb } from "../helpers/db";
import { insertTestOrder } from "../helpers/orders";
import { insertTestCustomer, insertTestSale } from "../helpers/portal";

const NOW = new Date("2026-11-05T12:00:00.000-03:00");
const IP_HASH = "hash-de-una-conexion";
const SECRET = "x".repeat(40);

let db: Db;
let sent: EmailMessage[];
const transport = vi.fn(async (message: EmailMessage) => {
  sent.push(message);
});

function validInput(overrides: Partial<ProApplicationInput> = {}): ProApplicationInput {
  return {
    name: "Equipo Ejemplo",
    discord: "ejemplo#1234",
    teamMembers: "Ana (ana_fn), Beto (beto_fn)",
    results: "Top 20 en la FNCS de la temporada pasada",
    message: "Queremos entrenar toda la temporada.",
    privacy: true,
    locale: "es",
    ...overrides,
  };
}

function submit(overrides: Partial<ProApplicationInput> = {}, context: { ipHash?: string | null; honeypotFilled?: boolean } = {}) {
  return submitProApplication(
    db,
    validInput(overrides),
    { ipHash: IP_HASH, honeypotFilled: false, emailDeps: { transport }, ...context },
    NOW,
  );
}

async function storedApplications() {
  return db.select().from(proApplications);
}

beforeEach(async () => {
  db = await createTestDb();
  sent = [];
  transport.mockClear();
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("ADMIN_ALERT_EMAIL", "tallami@example.com");
  vi.stubEnv("ADMIN_ALERT_FROM", "Panel <panel@example.com>");
  vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("submitProApplication", () => {
  test("saves a valid application and tells Tallami", async () => {
    const result = await submit();

    expect(result).toEqual({ ok: true });
    const [row] = await storedApplications();
    expect(row).toMatchObject({
      name: "Equipo Ejemplo",
      discord: "ejemplo#1234",
      teamMembers: "Ana (ana_fn), Beto (beto_fn)",
      results: "Top 20 en la FNCS de la temporada pasada",
      message: "Queremos entrenar toda la temporada.",
      status: "new",
      locale: "es",
      ipHash: IP_HASH,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("tallami@example.com");
    expect(sent[0].subject).toContain("Equipo Ejemplo");
    expect(sent[0].text).toContain("ejemplo#1234");
    expect(sent[0].text).toContain(`/admin/aplicaciones/${row.id}`);
  });

  test("a message is optional and an empty one is stored as null", async () => {
    expect(await submit({ message: "   " })).toEqual({ ok: true });

    expect((await storedApplications())[0].message).toBeNull();
  });

  test("an application still saves when the email to Tallami does not go out", async () => {
    vi.stubEnv("RESEND_API_KEY", "");

    expect(await submit()).toEqual({ ok: true });
    expect(await storedApplications()).toHaveLength(1);
  });

  test.each(["name", "discord", "teamMembers", "results"] as const)("a missing %s is an error of that field", async (field) => {
    const result = await submit({ [field]: "   " });

    expect(result).toEqual({ ok: false, fieldErrors: { [field]: "required" } });
    expect(await storedApplications()).toEqual([]);
    expect(sent).toEqual([]);
  });

  test("the privacy box is required", async () => {
    const result = await submit({ privacy: false });

    expect(result).toEqual({ ok: false, fieldErrors: { privacy: "required" } });
    expect(await storedApplications()).toEqual([]);
  });

  test("reports every wrong field at once", async () => {
    const result = await submit({ name: "", results: "", privacy: false });

    expect(result).toEqual({ ok: false, fieldErrors: { name: "required", results: "required", privacy: "required" } });
  });

  test.each([
    ["name", 200],
    ["discord", 200],
    ["teamMembers", 2000],
    ["results", 2000],
    ["message", 2000],
  ] as const)("%s accepts exactly %i characters and rejects one more", async (field, max) => {
    expect(await submit({ [field]: "a".repeat(max) })).toEqual({ ok: true });

    const tooLong = await submit({ [field]: "a".repeat(max + 1) });

    expect(tooLong).toEqual({ ok: false, fieldErrors: { [field]: "too-long" } });
    expect(await storedApplications()).toHaveLength(1);
  });

  test("a filled trap field answers as if it went well and saves nothing", async () => {
    const result = await submit({}, { honeypotFilled: true });

    expect(result).toEqual({ ok: true });
    expect(await storedApplications()).toEqual([]);
    expect(sent).toEqual([]);
  });

  test(`the ${PUBLIC_FORM_MAX_PER_HOUR + 1}th application of the same connection in an hour is limited`, async () => {
    for (let index = 0; index < PUBLIC_FORM_MAX_PER_HOUR; index += 1) {
      expect(await submit({ name: `Equipo ${index}` })).toEqual({ ok: true });
    }

    expect(await submit({ name: "Una de más" })).toEqual({ ok: false, limited: true });
    expect(await storedApplications()).toHaveLength(PUBLIC_FORM_MAX_PER_HOUR);
    // Otra conexión sigue pudiendo aplicar.
    expect(await submit({ name: "Otra conexión" }, { ipHash: "otra-conexion" })).toEqual({ ok: true });
  });

  test(`the ${PUBLIC_FORM_GLOBAL_MAX_PER_HOUR + 1}st application of the whole site in an hour is limited`, async () => {
    await db.insert(proApplications).values(
      Array.from({ length: PUBLIC_FORM_GLOBAL_MAX_PER_HOUR }, (_, index) => ({
        name: `Equipo ${index}`,
        discord: "d",
        teamMembers: "t",
        results: "r",
        locale: "es",
        ipHash: `conexion-${index}`,
        createdAt: new Date(NOW.getTime() - 60_000),
      })),
    );

    expect(await submit({}, { ipHash: "una-nueva" })).toEqual({ ok: false, limited: true });
  });

  test("applications older than an hour no longer count", async () => {
    await db.insert(proApplications).values(
      Array.from({ length: PUBLIC_FORM_MAX_PER_HOUR }, () => ({
        name: "Vieja",
        discord: "d",
        teamMembers: "t",
        results: "r",
        locale: "es",
        ipHash: IP_HASH,
        createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      })),
    );

    expect(await submit()).toEqual({ ok: true });
  });

  test("without a hash for the connection only the limit of the whole site applies", async () => {
    for (let index = 0; index < PUBLIC_FORM_MAX_PER_HOUR + 1; index += 1) {
      expect(await submit({}, { ipHash: null })).toEqual({ ok: true });
    }
  });

  test("an unknown language is stored as Spanish", async () => {
    await submit({ locale: "fr" });

    expect((await storedApplications())[0].locale).toBe("es");
  });
});

describe("the public form guard", () => {
  test("the hash of a connection is stable for a day, never the IP, and null without the secret", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });

    const first = publicFormIpHash(headers, NOW);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain("203.0.113.9");
    expect(publicFormIpHash(headers, new Date(NOW.getTime() + 60_000))).toBe(first);
    expect(publicFormIpHash(new Headers({ "x-forwarded-for": "203.0.113.10" }), NOW)).not.toBe(first);
    vi.stubEnv("ADMIN_SESSION_SECRET", "");
    expect(publicFormIpHash(headers, NOW)).toBeNull();
  });

  test("the trap field is `website`: any text in it is a bot, empty or spaces is not", () => {
    const form = (value?: string) => {
      const data = new FormData();
      if (value !== undefined) data.set("website", value);
      return data;
    };

    expect(isHoneypotFilled(form())).toBe(false);
    expect(isHoneypotFilled(form(""))).toBe(false);
    expect(isHoneypotFilled(form("   "))).toBe(false);
    expect(isHoneypotFilled(form("http://spam.example"))).toBe(true);
  });

  test("it counts the rows of the table it is asked about", async () => {
    expect(await isOverPublicFormLimit(db, "proApplications", IP_HASH, NOW)).toBe(false);
    expect(await isOverPublicFormLimit(db, "siteRequests", IP_HASH, NOW)).toBe(false);
  });
});

describe("the applications of the panel", () => {
  test("lists the newest first and finds one by id", async () => {
    await submitProApplication(db, validInput({ name: "Primera" }), { ipHash: null, honeypotFilled: false, emailDeps: { transport } }, new Date(NOW.getTime() - 1000));
    await submit({ name: "Segunda" }, { ipHash: null });

    const list = await listProApplications(db);

    expect(list.map(({ name }) => name)).toEqual(["Segunda", "Primera"]);
    expect(await getProApplication(db, list[0].id)).toMatchObject({ name: "Segunda" });
  });

  test("an id that is not a uuid or does not exist is null, not an error", async () => {
    expect(await getProApplication(db, "no-es-un-uuid")).toBeNull();
    expect(await getProApplication(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  test("changes the status, and only to a known one", async () => {
    await submit();
    const [{ id }] = await storedApplications();

    expect(await setProApplicationStatus(db, id, "talking")).toBe(true);
    expect((await getProApplication(db, id))?.status).toBe("talking");
    expect(await setProApplicationStatus(db, id, "inventado")).toBe(false);
    expect(await setProApplicationStatus(db, "00000000-0000-4000-8000-000000000000", "accepted")).toBe(false);
    expect((await getProApplication(db, id))?.status).toBe("talking");
  });

  test("deleting an application removes its links but never the sales", async () => {
    await submit();
    const [{ id }] = await storedApplications();
    await createProPaymentLink(db, id, 100_000, NOW);
    const customerId = await insertTestCustomer(db);
    const saleId = await insertTestSale(db, customerId, { item: "proSeason" });
    const order = await insertTestOrder(db, { item: "proSeason", saleId, status: "approved" });

    expect(await deleteProApplication(db, id)).toBe(true);

    expect(await storedApplications()).toEqual([]);
    expect(await db.select().from(sales)).toHaveLength(1);
    expect(await db.select().from(orders)).toHaveLength(1);
    expect(order.saleId).toBe(saleId);
    expect(await deleteProApplication(db, id)).toBe(false);
  });
});
