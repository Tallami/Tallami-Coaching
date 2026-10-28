import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/db/client";
import {
  customers,
  deliveries,
  deliveryFiles,
  portalAccounts,
  portalInvites,
  portalSessions,
  sales,
} from "@/db/schema";
import { DELIVERY_TITLE_MAX_LENGTH } from "@/portal/policy";
import { createTestDb } from "../helpers/db";
import { insertTestAccount, insertTestCustomer, insertTestSale } from "../helpers/portal";

// Las cinco tablas del portal del alumno: cuentas, sesiones, invitaciones,
// entregas y archivos. Lo que la base garantiza por sí sola.

const NOW = new Date("2026-10-28T10:00:00.000Z");
const LATER = new Date("2026-11-11T10:00:00.000Z");
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** Nombre de la restricción que rechazó la consulta (la lleva el error de Postgres). */
async function violatedConstraint(query: PromiseLike<unknown>): Promise<string> {
  try {
    await query;
  } catch (error) {
    const pgError = (error as { cause?: { constraint?: string } }).cause ?? error;
    const { constraint } = pgError as { constraint?: string };
    if (constraint) return constraint;
    throw error;
  }
  throw new Error("La consulta no fue rechazada");
}

let db: Db;
let counter = 0;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(portalAccounts);
  await db.delete(deliveryFiles);
  await db.delete(sales);
  await db.delete(customers);
});

async function insertFile(bytes: Uint8Array = Uint8Array.from([...PDF_HEADER, 0x31])): Promise<string> {
  const [row] = await db
    .insert(deliveryFiles)
    .values({ contentType: "application/pdf", size: bytes.length, bytes })
    .returning({ id: deliveryFiles.id });
  return row.id;
}

describe("portal accounts", () => {
  test("start unlinked, with both dates set and the email optional", async () => {
    const [row] = await db
      .insert(portalAccounts)
      .values({ provider: "google", providerUserId: "g-1", displayName: "Ana" })
      .returning();

    expect(row.customerId).toBeNull();
    expect(row.email).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.lastLoginAt).toBeInstanceOf(Date);
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("accept discord, google and test as providers and nothing else", async () => {
    for (const provider of ["discord", "google", "test"]) {
      counter += 1;
      await expect(
        db.insert(portalAccounts).values({ provider, providerUserId: `u-${counter}`, displayName: "Ana" }),
      ).resolves.toBeDefined();
    }

    const constraint = await violatedConstraint(
      db.insert(portalAccounts).values({ provider: "facebook", providerUserId: "u-x", displayName: "Ana" }),
    );
    expect(constraint).toBe("portal_accounts_provider_valid");
  });

  test("one identity (provider and user id) is one account", async () => {
    await db.insert(portalAccounts).values({ provider: "discord", providerUserId: "42", displayName: "Ana" });

    const constraint = await violatedConstraint(
      db.insert(portalAccounts).values({ provider: "discord", providerUserId: "42", displayName: "Otra Ana" }),
    );

    expect(constraint).toBe("portal_accounts_identity_unique");
  });

  test("the same user id at another provider is allowed", async () => {
    await db.insert(portalAccounts).values({ provider: "discord", providerUserId: "42", displayName: "Ana" });

    await expect(
      db.insert(portalAccounts).values({ provider: "google", providerUserId: "42", displayName: "Ana" }),
    ).resolves.toBeDefined();
  });

  test("a student has at most one account", async () => {
    const customerId = await insertTestCustomer(db);
    await insertTestAccount(db, { customerId });

    const constraint = await violatedConstraint(insertTestAccount(db, { customerId }));

    expect(constraint).toBe("portal_accounts_customer_id_unique");
  });

  test("deleting the student leaves the account, unlinked", async () => {
    const customerId = await insertTestCustomer(db);
    const accountId = await insertTestAccount(db, { customerId });

    await db.delete(customers).where(eq(customers.id, customerId));

    const [row] = await db.select().from(portalAccounts).where(eq(portalAccounts.id, accountId));
    expect(row.customerId).toBeNull();
  });

  test("a student with sales is still protected from deletion by the sales, not by the account", async () => {
    const customerId = await insertTestCustomer(db);
    await insertTestAccount(db, { customerId });
    await insertTestSale(db, customerId);

    const constraint = await violatedConstraint(db.delete(customers).where(eq(customers.id, customerId)));

    expect(constraint).toBe("sales_customer_id_customers_id_fk");
  });
});

describe("portal sessions", () => {
  test("belong to an account and go away with it", async () => {
    const accountId = await insertTestAccount(db);
    await db.insert(portalSessions).values({ id: "hash-de-sesion", accountId, expiresAt: LATER });

    await db.delete(portalAccounts).where(eq(portalAccounts.id, accountId));

    expect(await db.select().from(portalSessions)).toHaveLength(0);
  });

  test("need an existing account", async () => {
    const constraint = await violatedConstraint(
      db.insert(portalSessions).values({
        id: "hash-sin-cuenta",
        accountId: "00000000-0000-4000-8000-000000000000",
        expiresAt: LATER,
      }),
    );

    expect(constraint).toBe("portal_sessions_account_id_portal_accounts_id_fk");
  });
});

describe("portal invites", () => {
  test("belong to a student and go away with him or her", async () => {
    const customerId = await insertTestCustomer(db);
    await db.insert(portalInvites).values({ tokenHash: "hash-de-invitacion", customerId, expiresAt: LATER });

    await db.delete(customers).where(eq(customers.id, customerId));

    expect(await db.select().from(portalInvites)).toHaveLength(0);
  });

  test("have a unique token hash", async () => {
    const customerId = await insertTestCustomer(db);
    await db.insert(portalInvites).values({ tokenHash: "repetido", customerId, expiresAt: LATER });

    const constraint = await violatedConstraint(
      db.insert(portalInvites).values({ tokenHash: "repetido", customerId, expiresAt: LATER }),
    );

    expect(constraint).toBe("portal_invites_token_hash_unique");
  });

  test("remember who used them, and forget it when that account is deleted", async () => {
    const customerId = await insertTestCustomer(db);
    const accountId = await insertTestAccount(db);
    await db.insert(portalInvites).values({
      tokenHash: "usada",
      customerId,
      expiresAt: LATER,
      usedAt: NOW,
      usedByAccountId: accountId,
    });

    await db.delete(portalAccounts).where(eq(portalAccounts.id, accountId));

    const [invite] = await db.select().from(portalInvites);
    expect(invite.usedByAccountId).toBeNull();
    expect(invite.usedAt).toEqual(NOW);
  });
});

describe("delivery files", () => {
  test("round-trip bytes exactly, including 0x00 and 0xFF", async () => {
    const bytes = Uint8Array.from([0x00, 0x01, 0x7f, 0x80, 0xfe, 0xff, 0x00, 0x0a, 0x0d, 0xff]);
    const id = await insertFile(bytes);

    const [row] = await db.select().from(deliveryFiles).where(eq(deliveryFiles.id, id));

    expect([...row.bytes]).toEqual([...bytes]);
    expect(row.size).toBe(bytes.length);
    expect(row.contentType).toBe("application/pdf");
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  test("round-trip a PDF header and a big random file without changing a byte", async () => {
    const big = Uint8Array.from(randomBytes(300 * 1024));
    const withHeader = Uint8Array.from([...PDF_HEADER, ...big.subarray(0, 1000)]);
    const bigId = await insertFile(big);
    const headerId = await insertFile(withHeader);

    const [storedBig] = await db.select().from(deliveryFiles).where(eq(deliveryFiles.id, bigId));
    const [storedHeader] = await db.select().from(deliveryFiles).where(eq(deliveryFiles.id, headerId));

    expect(Buffer.compare(Buffer.from(storedBig.bytes), Buffer.from(big))).toBe(0);
    expect(Buffer.compare(Buffer.from(storedHeader.bytes), Buffer.from(withHeader))).toBe(0);
    expect(storedHeader.bytes.subarray(0, 5)).toEqual(Buffer.from("%PDF-"));
  });

  test("come back as a Buffer, whatever the driver returns, and accept a Buffer too", async () => {
    const [row] = await db
      .insert(deliveryFiles)
      .values({ contentType: "application/pdf", size: 3, bytes: Buffer.from([0xff, 0x00, 0xff]) })
      .returning();

    expect(Buffer.isBuffer(row.bytes)).toBe(true);
    expect([...row.bytes]).toEqual([0xff, 0x00, 0xff]);
  });

  test("an empty file is stored and read back empty", async () => {
    const id = await insertFile(new Uint8Array());

    const [row] = await db.select().from(deliveryFiles).where(eq(deliveryFiles.id, id));

    expect(row.bytes).toHaveLength(0);
    expect(row.size).toBe(0);
  });
});

describe("deliveries", () => {
  let saleId: string;

  beforeEach(async () => {
    saleId = await insertTestSale(db, await insertTestCustomer(db));
  });

  const youtube = () => ({ kind: "youtube", title: "Review", youtubeVideoId: "dQw4w9WgXcQ" });
  const link = () => ({ kind: "link", title: "Guía", url: "https://drive.google.com/file/d/1" });

  test("store a YouTube video by its id", async () => {
    const [row] = await db.insert(deliveries).values({ saleId, ...youtube() }).returning();

    expect(row).toMatchObject({ saleId, kind: "youtube", youtubeVideoId: "dQw4w9WgXcQ", url: null, fileId: null });
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  test("store a link by its address", async () => {
    const [row] = await db.insert(deliveries).values({ saleId, ...link() }).returning();

    expect(row).toMatchObject({ kind: "link", url: "https://drive.google.com/file/d/1", youtubeVideoId: null, fileId: null });
  });

  test("store a PDF by its file", async () => {
    const fileId = await insertFile();

    const [row] = await db.insert(deliveries).values({ saleId, kind: "pdf", title: "Plan", fileId }).returning();

    expect(row).toMatchObject({ kind: "pdf", fileId, url: null, youtubeVideoId: null });
  });

  test("have a kind among youtube, pdf and link", async () => {
    const constraint = await violatedConstraint(
      db.insert(deliveries).values({ saleId, kind: "video", title: "Review", url: "https://example.com" }),
    );

    expect(constraint).toBe("deliveries_kind_valid");
  });

  test("have a title of 1 to 120 characters", async () => {
    const empty = await violatedConstraint(db.insert(deliveries).values({ saleId, ...youtube(), title: "" }));
    const tooLong = await violatedConstraint(
      db.insert(deliveries).values({ saleId, ...youtube(), title: "a".repeat(DELIVERY_TITLE_MAX_LENGTH + 1) }),
    );

    expect(empty).toBe("deliveries_title_length");
    expect(tooLong).toBe("deliveries_title_length");
    await expect(
      db.insert(deliveries).values({ saleId, ...youtube(), title: "a".repeat(DELIVERY_TITLE_MAX_LENGTH) }),
    ).resolves.toBeDefined();
    await expect(db.insert(deliveries).values({ saleId, ...youtube(), title: "a" })).resolves.toBeDefined();
  });

  test("carry exactly the field of their kind", async () => {
    const fileId = await insertFile();
    const wrongOnes = [
      { kind: "youtube", title: "x" }, // sin id de video
      { kind: "youtube", title: "x", youtubeVideoId: "dQw4w9WgXcQ", url: "https://example.com" },
      { kind: "youtube", title: "x", youtubeVideoId: "dQw4w9WgXcQ", fileId },
      { kind: "link", title: "x" }, // sin dirección
      { kind: "link", title: "x", url: "https://example.com", youtubeVideoId: "dQw4w9WgXcQ" },
      { kind: "link", title: "x", url: "https://example.com", fileId },
      { kind: "pdf", title: "x" }, // sin archivo
      { kind: "pdf", title: "x", fileId, url: "https://example.com" },
      { kind: "pdf", title: "x", fileId, youtubeVideoId: "dQw4w9WgXcQ" },
    ];

    for (const wrong of wrongOnes) {
      expect(await violatedConstraint(db.insert(deliveries).values({ saleId, ...wrong })), JSON.stringify(wrong)).toBe(
        "deliveries_one_field_per_kind",
      );
    }
  });

  test("keep only https links: no javascript:, http: or relative address can reach a link", async () => {
    for (const url of ["javascript:alert(1)", "http://example.com", "//example.com", "ftp://example.com/a", "example.com"]) {
      expect(await violatedConstraint(db.insert(deliveries).values({ saleId, ...link(), url })), url).toBe(
        "deliveries_url_is_https",
      );
    }
  });

  test("belong to a sale and go away with it", async () => {
    await db.insert(deliveries).values({ saleId, ...youtube() });

    await db.delete(sales).where(eq(sales.id, saleId));

    expect(await db.select().from(deliveries)).toHaveLength(0);
  });

  test("a PDF delivery goes away with its file", async () => {
    const fileId = await insertFile();
    await db.insert(deliveries).values({ saleId, kind: "pdf", title: "Plan", fileId });

    await db.delete(deliveryFiles).where(eq(deliveryFiles.id, fileId));

    expect(await db.select().from(deliveries)).toHaveLength(0);
  });

  test("need an existing sale", async () => {
    const constraint = await violatedConstraint(
      db.insert(deliveries).values({ saleId: "00000000-0000-4000-8000-000000000000", ...youtube() }),
    );

    expect(constraint).toBe("deliveries_sale_id_sales_id_fk");
  });
});
