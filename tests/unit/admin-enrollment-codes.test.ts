import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  ENROLLMENT_CODE_ALPHABET,
  ENROLLMENT_CODE_LENGTH,
  ENROLLMENT_CODE_MS,
} from "@/admin/auth/policy";
import {
  formatEnrollmentCode,
  generateEnrollmentCode,
  redeemEnrollmentCode,
} from "@/admin/auth/enrollment-codes";
import { createSession, revokeSession } from "@/admin/auth/sessions";
import type { Db } from "@/db/client";
import { adminEnrollmentCodes, adminPasskeys, adminSessions } from "@/db/schema";
import { createTestDb, insertTestPasskey } from "../helpers/db";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;

const START = new Date("2026-10-21T10:00:00.000Z");
const SECRET = "secreto-de-prueba-de-mas-de-32-caracteres";
const OTHER_SECRET = "otro-secreto-de-prueba-de-mas-de-32-caracteres";

function after(ms: number): Date {
  return new Date(START.getTime() + ms);
}

let db: Db;
let passkeyId: string;
let sessionId: string;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
  await db.delete(adminSessions); // las sesiones arrastran sus códigos (on delete cascade)
  await db.delete(adminPasskeys);
  passkeyId = await insertTestPasskey(db);
  sessionId = await createSession(db, { passkeyId, device: "Chrome en Windows", reauthed: true }, START);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("generateEnrollmentCode", () => {
  test("is ten characters long, all from the alphabet without confusing letters", async () => {
    for (let i = 0; i < 40; i += 1) {
      const code = await generateEnrollmentCode(db, sessionId, START);

      expect(code).toHaveLength(ENROLLMENT_CODE_LENGTH);
      for (const char of code) expect(ENROLLMENT_CODE_ALPHABET).toContain(char);
    }
    expect(ENROLLMENT_CODE_LENGTH).toBe(10);
    expect(ENROLLMENT_CODE_ALPHABET).not.toMatch(/[IO01]/);
  });

  test("is different every time", async () => {
    const codes = new Set<string>();
    for (let i = 0; i < 20; i += 1) codes.add(await generateEnrollmentCode(db, sessionId, START));

    expect(codes.size).toBe(20);
  });

  test("uses the whole alphabet, not only part of it", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 60; i += 1) for (const char of await generateEnrollmentCode(db, sessionId, START)) seen.add(char);

    // 600 caracteres sobre 32 símbolos: que falte alguno es de una probabilidad despreciable.
    expect(seen.size).toBe(ENROLLMENT_CODE_ALPHABET.length);
  });

  test("stores only a hash of the code, never the code, and remembers the session it was born in", async () => {
    const code = await generateEnrollmentCode(db, sessionId, START);

    const rows = await db.select().from(adminEnrollmentCodes);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      createdBySession: sessionId,
      createdAt: START,
      expiresAt: after(ENROLLMENT_CODE_MS),
      usedAt: null,
    });
    expect(rows[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
    const everything = JSON.stringify(rows).toUpperCase();
    expect(everything).not.toContain(code);
    expect(everything).not.toContain(formatEnrollmentCode(code));
    expect(ENROLLMENT_CODE_MS).toBe(10 * MINUTE_MS);
  });

  test("a new code cancels the one before it", async () => {
    const first = await generateEnrollmentCode(db, sessionId, START);
    const second = await generateEnrollmentCode(db, sessionId, after(MINUTE_MS));

    expect(await redeemEnrollmentCode(db, first, after(2 * MINUTE_MS))).toBe(false);
    expect(await redeemEnrollmentCode(db, second, after(2 * MINUTE_MS))).toBe(true);
  });

  test("a new code cancels the ones of other sessions too: only one code is alive at a time", async () => {
    const otherSession = await createSession(db, { passkeyId, device: "Safari en iPhone", reauthed: true }, START);
    const firstFromOther = await generateEnrollmentCode(db, otherSession, START);

    const second = await generateEnrollmentCode(db, sessionId, after(MINUTE_MS));

    expect(await redeemEnrollmentCode(db, firstFromOther, after(2 * MINUTE_MS))).toBe(false);
    expect(await redeemEnrollmentCode(db, second, after(2 * MINUTE_MS))).toBe(true);
  });

  test("two generated at the same time leave exactly one alive", async () => {
    const codes = await Promise.all([
      generateEnrollmentCode(db, sessionId, START),
      generateEnrollmentCode(db, sessionId, START),
      generateEnrollmentCode(db, sessionId, START),
    ]);

    const redeemed = await Promise.all(codes.map((code) => redeemEnrollmentCode(db, code, after(MINUTE_MS))));

    expect(redeemed.filter(Boolean)).toHaveLength(1);
  });

  test("a code that was already used stays used when a new one is generated", async () => {
    const used = await generateEnrollmentCode(db, sessionId, START);
    await redeemEnrollmentCode(db, used, after(MINUTE_MS));

    await generateEnrollmentCode(db, sessionId, after(2 * MINUTE_MS));

    const rows = await db.select().from(adminEnrollmentCodes);
    expect(rows.filter((row) => row.usedAt !== null)).toHaveLength(1);
  });

  test("fails, and stores nothing, when the session secret is missing", async () => {
    vi.stubEnv("ADMIN_SESSION_SECRET", "");

    await expect(generateEnrollmentCode(db, sessionId, START)).rejects.toThrow(/ADMIN_SESSION_SECRET/);
    expect(await db.select().from(adminEnrollmentCodes)).toEqual([]);
  });
});

describe("redeemEnrollmentCode", () => {
  test("works once: the second time is false", async () => {
    const code = await generateEnrollmentCode(db, sessionId, START);

    expect(await redeemEnrollmentCode(db, code, after(MINUTE_MS))).toBe(true);
    expect(await redeemEnrollmentCode(db, code, after(2 * MINUTE_MS))).toBe(false);

    const [row] = await db.select().from(adminEnrollmentCodes);
    expect(row.usedAt).toEqual(after(MINUTE_MS));
  });

  test("two at the same time: exactly one wins", async () => {
    const code = await generateEnrollmentCode(db, sessionId, START);

    const results = await Promise.all(Array.from({ length: 6 }, () => redeemEnrollmentCode(db, code, after(MINUTE_MS))));

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("accepts it typed in lower case, with a dash, or with spaces around and inside", async () => {
    const forms = [
      (code: string) => `${code.slice(0, 5)}-${code.slice(5)}`.toLowerCase(),
      (code: string) => ` ${code.slice(0, 5)} ${code.slice(5)} `,
      (code: string) => formatEnrollmentCode(code),
      (code: string) => `\t${code.toLowerCase()}\n`,
      (code: string) => `${code.slice(0, 3)}-${code.slice(3, 7)}--${code.slice(7)}`,
    ];

    for (const typed of forms) {
      const code = await generateEnrollmentCode(db, sessionId, START);
      expect(await redeemEnrollmentCode(db, typed(code), after(MINUTE_MS)), typed(code)).toBe(true);
    }
  });

  test("is valid at 9:59 and false at 10:00", async () => {
    const late = await generateEnrollmentCode(db, sessionId, START);
    expect(await redeemEnrollmentCode(db, late, after(ENROLLMENT_CODE_MS))).toBe(false);

    const justInTime = await generateEnrollmentCode(db, sessionId, START);
    expect(await redeemEnrollmentCode(db, justInTime, after(ENROLLMENT_CODE_MS - SECOND_MS))).toBe(true);
  });

  test("is false for a code that was never generated", async () => {
    await generateEnrollmentCode(db, sessionId, START);

    expect(await redeemEnrollmentCode(db, "ABCDEFGHJK", after(MINUTE_MS))).toBe(false);
  });

  test.each([
    ["empty", ""],
    ["blank", "   "],
    ["too short", "ABCDE"],
    ["too long", "ABCDEFGHJKL"],
    ["with letters that are not in the alphabet", "ABCDEIO010"],
    ["with symbols", "ABCDE!FGH%"],
  ])("is false for a code that is %s, without touching the database", async (_label, typed) => {
    await generateEnrollmentCode(db, sessionId, START);
    const update = vi.spyOn(db, "update");

    expect(await redeemEnrollmentCode(db, typed, after(MINUTE_MS))).toBe(false);
    expect(update).not.toHaveBeenCalled();
    update.mockRestore();
  });

  test("a failed try does not use up the real code", async () => {
    const code = await generateEnrollmentCode(db, sessionId, START);

    expect(await redeemEnrollmentCode(db, "ABCDEFGHJK", after(MINUTE_MS))).toBe(false);

    expect(await redeemEnrollmentCode(db, code, after(2 * MINUTE_MS))).toBe(true);
  });

  test("the hash depends on the secret: a code does not redeem if the secret changed", async () => {
    const code = await generateEnrollmentCode(db, sessionId, START);

    vi.stubEnv("ADMIN_SESSION_SECRET", OTHER_SECRET);

    expect(await redeemEnrollmentCode(db, code, after(MINUTE_MS))).toBe(false);
  });

  test("is false once the session that generated it was closed (closing every session cancels the code)", async () => {
    const code = await generateEnrollmentCode(db, sessionId, START);
    await revokeSession(db, sessionId, after(MINUTE_MS));

    expect(await redeemEnrollmentCode(db, code, after(2 * MINUTE_MS))).toBe(false);
  });

  test("is false once the session that generated it reached its eight-hour limit", async () => {
    const code = await generateEnrollmentCode(db, sessionId, START);
    await db
      .update(adminSessions)
      .set({ expiresAt: after(5 * MINUTE_MS) })
      .where(eq(adminSessions.id, sessionId));

    expect(await redeemEnrollmentCode(db, code, after(6 * MINUTE_MS))).toBe(false);
  });

  test("is redeemed by the code alone: no session is needed on the side of the new device", async () => {
    const code = await generateEnrollmentCode(db, sessionId, START);

    // Quien canjea no tiene sesión: el ingreso a medio camino de la PC nueva solo tiene el código.
    expect(await redeemEnrollmentCode(db, code, after(MINUTE_MS))).toBe(true);
  });
});

describe("formatEnrollmentCode", () => {
  test("splits the code in two halves of five with a dash", () => {
    expect(formatEnrollmentCode("ABCDEFGHJK")).toBe("ABCDE-FGHJK");
  });

  test("the formatted code redeems like the plain one", async () => {
    const code = await generateEnrollmentCode(db, sessionId, START);

    expect(formatEnrollmentCode(code)).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(await redeemEnrollmentCode(db, formatEnrollmentCode(code), after(MINUTE_MS))).toBe(true);
  });
});
