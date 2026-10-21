import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  AUTH_RECORD_RETENTION_MS,
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
  SESSION_RETENTION_MS,
  SESSION_TOUCH_INTERVAL_MS,
} from "@/admin/auth/policy";
import {
  createSession,
  listActiveSessions,
  purgeExpiredAuthRecords,
  revokeAllSessions,
  revokeSession,
  revokeSessionsForPasskey,
  validateSession,
} from "@/admin/auth/sessions";
import type { Db } from "@/db/client";
import { adminEnrollmentCodes, adminPasskeys, adminPendingLogins, adminSessions } from "@/db/schema";
import { createTestDb } from "../helpers/db";

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Las 10:00 de un día cualquiera: todas las horas de los tests parten de acá. */
const START = new Date("2026-10-21T10:00:00.000Z");
const DEVICE = "Chrome en Windows";

/** `START` más `ms` milisegundos. */
function after(ms: number, base: Date = START): Date {
  return new Date(base.getTime() + ms);
}

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(adminPendingLogins);
  await db.delete(adminSessions); // las sesiones arrastran sus códigos (on delete cascade)
  await db.delete(adminPasskeys);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Una sesión nueva, abierta a las 10:00 salvo que el test diga otra cosa. */
function open(now: Date = START, passkeyId: string | null = null): Promise<string> {
  return createSession(db, { passkeyId, device: DEVICE, reauthed: false }, now);
}

async function addPasskey(credentialId: string): Promise<string> {
  const [row] = await db
    .insert(adminPasskeys)
    .values({ credentialId, publicKey: "clave-publica", name: `Llave ${credentialId}` })
    .returning({ id: adminPasskeys.id });
  return row.id;
}

describe("createSession", () => {
  test("returns a random url-safe id of 32 bytes, different every time", async () => {
    const ids = await Promise.all([open(), open(), open()]);

    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set(ids).size).toBe(3);
  });

  test("stores the device and the times: it ends eight hours after it starts", async () => {
    const id = await open();

    const [row] = await db.select().from(adminSessions).where(eq(adminSessions.id, id));
    expect(row).toMatchObject({
      id,
      passkeyId: null,
      device: DEVICE,
      createdAt: START,
      lastSeenAt: START,
      expiresAt: after(SESSION_MAX_MS),
      reauthAt: null,
      revokedAt: null,
      challenge: null,
      challengePurpose: null,
      challengeExpiresAt: null,
    });
  });

  test("remembers the passkey that opened it and whether the key was just confirmed", async () => {
    const passkeyId = await addPasskey("credencial-1");

    const confirmed = await createSession(db, { passkeyId, device: DEVICE, reauthed: true }, START);
    const unconfirmed = await createSession(db, { passkeyId, device: DEVICE, reauthed: false }, START);

    const rows = await db.select().from(adminSessions);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(confirmed)).toMatchObject({ passkeyId, reauthAt: START });
    expect(byId.get(unconfirmed)).toMatchObject({ passkeyId, reauthAt: null });
  });
});

describe("validateSession: when a session is still open", () => {
  test("closes by itself after thirty minutes without use", async () => {
    const justBefore = await open();
    const exactly = await open();

    expect(await validateSession(db, justBefore, after(30 * MINUTE_MS - SECOND_MS))).not.toBeNull();
    expect(await validateSession(db, exactly, after(30 * MINUTE_MS))).toBeNull();
    expect(SESSION_IDLE_MS).toBe(30 * MINUTE_MS);
  });

  test("using it keeps it open another thirty minutes", async () => {
    const used = await open();
    const unused = await open();

    expect(await validateSession(db, used, after(20 * MINUTE_MS))).not.toBeNull();

    expect(await validateSession(db, used, after(49 * MINUTE_MS))).not.toBeNull();
    // Sin el uso de las 10:20 también habría vencido a las 10:50.
    expect(await validateSession(db, unused, after(50 * MINUTE_MS))).toBeNull();
  });

  test("has an eight-hour limit that using it does not move", async () => {
    const id = await open();

    // Se usa cada 10 minutos, hasta las 17:50.
    for (let elapsed = 10 * MINUTE_MS; elapsed <= 8 * HOUR_MS - 10 * MINUTE_MS; elapsed += 10 * MINUTE_MS) {
      expect(await validateSession(db, id, after(elapsed)), `a los ${elapsed / MINUTE_MS} minutos`).not.toBeNull();
    }

    expect(await validateSession(db, id, after(8 * HOUR_MS - SECOND_MS))).not.toBeNull();
    expect(await validateSession(db, id, after(8 * HOUR_MS))).toBeNull();
  });

  test("is closed for good once revoked", async () => {
    const id = await open();
    expect(await validateSession(db, id, after(MINUTE_MS))).not.toBeNull();

    await revokeSession(db, id, after(2 * MINUTE_MS));

    expect(await validateSession(db, id, after(3 * MINUTE_MS))).toBeNull();
  });

  test("an id that does not exist is not a session", async () => {
    expect(await validateSession(db, "a".repeat(43), START)).toBeNull();
    expect(await validateSession(db, "", START)).toBeNull();
  });

  test("hands back what the panel needs to know about it, and nothing secret", async () => {
    const passkeyId = await addPasskey("credencial-2");
    const id = await createSession(db, { passkeyId, device: "Safari en iPhone", reauthed: true }, START);

    const session = await validateSession(db, id, after(MINUTE_MS / 2));

    expect(session).toEqual({
      id,
      passkeyId,
      device: "Safari en iPhone",
      createdAt: START,
      lastSeenAt: START,
      reauthAt: START,
    });
  });
});

describe("validateSession: noting the last use", () => {
  test("writes it at most once a minute", async () => {
    const id = await open();
    const update = vi.spyOn(db, "update");

    await validateSession(db, id, after(30 * SECOND_MS));
    await validateSession(db, id, after(59 * SECOND_MS));
    expect(update).not.toHaveBeenCalled();

    await validateSession(db, id, after(61 * SECOND_MS));
    expect(update).toHaveBeenCalledTimes(1);

    // Dentro del minuto de la última escritura no vuelve a escribir.
    await validateSession(db, id, after(90 * SECOND_MS));
    await validateSession(db, id, after(120 * SECOND_MS));
    expect(update).toHaveBeenCalledTimes(1);

    await validateSession(db, id, after(122 * SECOND_MS));
    expect(update).toHaveBeenCalledTimes(2);
    expect(SESSION_TOUCH_INTERVAL_MS).toBe(MINUTE_MS);
  });

  test("stores the moment of the use it wrote, and leaves it alone when it skips the write", async () => {
    const id = await open();
    const lastSeen = async () =>
      (await db.select().from(adminSessions).where(eq(adminSessions.id, id)))[0].lastSeenAt;

    await validateSession(db, id, after(30 * SECOND_MS));
    expect(await lastSeen()).toEqual(START);

    const session = await validateSession(db, id, after(5 * MINUTE_MS));
    expect(await lastSeen()).toEqual(after(5 * MINUTE_MS));
    expect(session?.lastSeenAt).toEqual(after(5 * MINUTE_MS));
  });

  test("never writes for a session that is closed", async () => {
    const id = await open();
    await revokeSession(db, id, after(MINUTE_MS));
    const update = vi.spyOn(db, "update");

    expect(await validateSession(db, id, after(10 * MINUTE_MS))).toBeNull();
    expect(await validateSession(db, id, after(40 * MINUTE_MS))).toBeNull();

    expect(update).not.toHaveBeenCalled();
  });
});

describe("revoking sessions", () => {
  test("revokeSession keeps the first moment, and an unknown id is harmless", async () => {
    const id = await open();

    await revokeSession(db, id, after(MINUTE_MS));
    await revokeSession(db, id, after(5 * MINUTE_MS));
    await revokeSession(db, "b".repeat(43), after(5 * MINUTE_MS));

    const [row] = await db.select().from(adminSessions).where(eq(adminSessions.id, id));
    expect(row.revokedAt).toEqual(after(MINUTE_MS));
  });

  test("revokeAllSessions closes every open session and says how many", async () => {
    const first = await open();
    const second = await open(after(5 * MINUTE_MS));
    const alreadyRevoked = await open();
    await revokeSession(db, alreadyRevoked, after(MINUTE_MS));
    const idleLongAgo = await open(after(-2 * HOUR_MS));

    const closed = await revokeAllSessions(db, after(10 * MINUTE_MS));

    // Las que ya estaban cerradas (a mano o por inactividad) no cuentan.
    expect(closed).toBe(2);
    for (const id of [first, second, alreadyRevoked, idleLongAgo]) {
      expect(await validateSession(db, id, after(11 * MINUTE_MS))).toBeNull();
    }
  });

  test("revokeAllSessions with nothing open says zero", async () => {
    expect(await revokeAllSessions(db, START)).toBe(0);
  });

  test("revokeSessionsForPasskey closes only the sessions of that passkey and returns their ids", async () => {
    const phone = await addPasskey("celular");
    const laptop = await addPasskey("notebook");
    const phoneOne = await open(START, phone);
    const phoneTwo = await open(START, phone);
    const laptopOne = await open(START, laptop);
    const passwordOnly = await open(START, null);
    const phoneAlreadyClosed = await open(START, phone);
    await revokeSession(db, phoneAlreadyClosed, after(MINUTE_MS));

    const closed = await revokeSessionsForPasskey(db, phone, after(5 * MINUTE_MS));

    expect([...closed].sort()).toEqual([phoneOne, phoneTwo].sort());
    expect(await validateSession(db, phoneOne, after(6 * MINUTE_MS))).toBeNull();
    expect(await validateSession(db, phoneTwo, after(6 * MINUTE_MS))).toBeNull();
    expect(await validateSession(db, laptopOne, after(6 * MINUTE_MS))).not.toBeNull();
    expect(await validateSession(db, passwordOnly, after(6 * MINUTE_MS))).not.toBeNull();
  });

  test("revokeSessionsForPasskey says nothing for a passkey with no open sessions", async () => {
    const lonely = await addPasskey("sin-sesiones");

    expect(await revokeSessionsForPasskey(db, lonely, START)).toEqual([]);
  });
});

describe("listActiveSessions", () => {
  test("lists only the open sessions, the newest first, with what the panel shows", async () => {
    const older = await open(after(-10 * MINUTE_MS));
    const newer = await open(after(-2 * MINUTE_MS));
    const revoked = await open(after(-5 * MINUTE_MS));
    await revokeSession(db, revoked, after(-4 * MINUTE_MS));
    await open(after(-3 * HOUR_MS)); // vencida por inactividad

    const sessions = await listActiveSessions(db, START);

    expect(sessions.map((session) => session.id)).toEqual([newer, older]);
    expect(sessions[0]).toEqual({
      id: newer,
      passkeyId: null,
      device: DEVICE,
      createdAt: after(-2 * MINUTE_MS),
      lastSeenAt: after(-2 * MINUTE_MS),
      reauthAt: null,
    });
  });

  test("leaves out the session that already reached the eight-hour limit even if it was just used", async () => {
    const id = await open();
    await db
      .update(adminSessions)
      .set({ lastSeenAt: after(8 * HOUR_MS - MINUTE_MS) })
      .where(eq(adminSessions.id, id));

    expect(await listActiveSessions(db, after(8 * HOUR_MS))).toEqual([]);
    expect(await listActiveSessions(db, after(8 * HOUR_MS - 30 * SECOND_MS))).toHaveLength(1);
  });
});

describe("purgeExpiredAuthRecords", () => {
  async function addPendingLogin(id: string, expiresAt: Date): Promise<void> {
    await db.insert(adminPendingLogins).values({
      id,
      mode: "passkey",
      nextPath: "/admin",
      ipHash: "hash-de-una-ip",
      device: DEVICE,
      createdAt: after(-10 * MINUTE_MS, expiresAt),
      expiresAt,
    });
  }

  async function addCode(codeHash: string, createdBySession: string, expiresAt: Date): Promise<void> {
    await db.insert(adminEnrollmentCodes).values({
      codeHash,
      createdBySession,
      createdAt: after(-10 * MINUTE_MS, expiresAt),
      expiresAt,
    });
  }

  test("deletes sessions older than thirty days and keeps the rest", async () => {
    const tooOld = await open(after(-(SESSION_RETENTION_MS + DAY_MS)));
    const recent = await open(after(-(SESSION_RETENTION_MS - DAY_MS)));
    const today = await open(START);

    await purgeExpiredAuthRecords(db, START);

    const ids = (await db.select({ id: adminSessions.id }).from(adminSessions)).map((row) => row.id);
    expect(ids.sort()).toEqual([recent, today].sort());
    expect(ids).not.toContain(tooOld);
  });

  test("deletes half-done logins that expired over a day ago and keeps the rest", async () => {
    await addPendingLogin("vencido-hace-dos-dias", after(-2 * DAY_MS));
    await addPendingLogin("vencido-hace-doce-horas", after(-12 * HOUR_MS));
    await addPendingLogin("todavia-vigente", after(5 * MINUTE_MS));

    await purgeExpiredAuthRecords(db, START);

    const ids = (await db.select({ id: adminPendingLogins.id }).from(adminPendingLogins)).map((row) => row.id);
    expect(ids.sort()).toEqual(["todavia-vigente", "vencido-hace-doce-horas"]);
  });

  test("deletes enrollment codes that expired over a day ago and keeps the rest", async () => {
    const owner = await open(START);
    await addCode("hash-vencido-hace-dos-dias", owner, after(-2 * DAY_MS));
    await addCode("hash-vencido-hace-doce-horas", owner, after(-12 * HOUR_MS));
    await addCode("hash-vigente", owner, after(10 * MINUTE_MS));

    await purgeExpiredAuthRecords(db, START);

    const hashes = (await db.select({ hash: adminEnrollmentCodes.codeHash }).from(adminEnrollmentCodes)).map(
      (row) => row.hash,
    );
    expect(hashes.sort()).toEqual(["hash-vencido-hace-doce-horas", "hash-vigente"]);
    expect(AUTH_RECORD_RETENTION_MS).toBe(DAY_MS);
  });

  test("does nothing, and does not fail, when there is nothing to delete", async () => {
    await expect(purgeExpiredAuthRecords(db, START)).resolves.toBeUndefined();
  });
});
