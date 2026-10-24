import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { generateEnrollmentCode } from "@/admin/auth/enrollment-codes";
import { countPasskeys, insertPasskey } from "@/admin/auth/passkeys";
import { createPendingLogin } from "@/admin/auth/pending-logins";
import { resetPasskeys } from "@/admin/auth/reset-passkeys";
import { createSession, listActiveSessions, revokeSession, validateSession } from "@/admin/auth/sessions";
import type { Db } from "@/db/client";
import { adminEnrollmentCodes, adminPendingLogins, adminSessions } from "@/db/schema";
import { createTestDb } from "../helpers/db";

const MINUTE_MS = 60_000;
/** Las 10:00 de un día cualquiera: todas las horas del test parten de acá. */
const START = new Date("2026-10-21T10:00:00.000Z");
const SECRET = "secreto-de-prueba-de-mas-de-32-caracteres";

function after(ms: number): Date {
  return new Date(START.getTime() + ms);
}

async function addPasskey(db: Db, credentialId: string): Promise<string> {
  const passkey = await insertPasskey(
    db,
    { credentialId, publicKey: "clave-publica", counter: 0, transports: ["internal"], name: `Llave ${credentialId}` },
    { onlyIfNone: false },
  );
  if (!passkey) throw new Error("No se guardó la llave de prueba.");
  return passkey.id;
}

/** Una base con lo que deja un panel en uso: 2 llaves, 3 sesiones abiertas, un ingreso a medio camino y un código sin usar. */
async function usedPanel(): Promise<{ db: Db; sessionIds: string[] }> {
  const db = await createTestDb();
  const first = await addPasskey(db, "credencial-1");
  const second = await addPasskey(db, "credencial-2");
  const device = "Chrome en Windows";
  const sessionIds = [
    await createSession(db, { passkeyId: first, device, reauthed: true }, START),
    await createSession(db, { passkeyId: first, device, reauthed: false }, START),
    await createSession(db, { passkeyId: second, device, reauthed: true }, START),
  ];
  await createPendingLogin(db, { mode: "passkey", nextPath: "/admin", ipHash: "hash", device }, START);
  await generateEnrollmentCode(db, sessionIds[0], START);
  return { db, sessionIds };
}

beforeEach(() => {
  vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resetPasskeys", () => {
  test("deletes every key, closes every open session and drops the half-way logins and the codes", async () => {
    const { db, sessionIds } = await usedPanel();
    const now = after(5 * MINUTE_MS);

    const result = await resetPasskeys(db, now);

    expect(result).toEqual({ passkeys: 2, sessions: 3 });
    expect(await countPasskeys(db)).toBe(0);
    expect(await listActiveSessions(db, now)).toEqual([]);
    for (const id of sessionIds) expect(await validateSession(db, id, now)).toBeNull();
    expect(await db.select().from(adminPendingLogins)).toEqual([]);
    expect(await db.select().from(adminEnrollmentCodes)).toEqual([]);
  });

  test("only counts the sessions it closes: one that was already closed does not count, and it keeps its closing time", async () => {
    const { db, sessionIds } = await usedPanel();
    await revokeSession(db, sessionIds[0], after(MINUTE_MS));

    const result = await resetPasskeys(db, after(5 * MINUTE_MS));

    expect(result.sessions).toBe(2);
    const [closedEarlier] = await db
      .select({ revokedAt: adminSessions.revokedAt })
      .from(adminSessions)
      .where(sql`${adminSessions.id} = ${sessionIds[0]}`);
    expect(closedEarlier.revokedAt).toEqual(after(MINUTE_MS));
  });

  test("keeps the session rows (only closed), so the history of logins stays", async () => {
    const { db } = await usedPanel();

    await resetPasskeys(db, after(MINUTE_MS));

    expect(await db.select({ id: adminSessions.id }).from(adminSessions)).toHaveLength(3);
  });

  test("on an empty panel it does nothing and says so", async () => {
    const db = await createTestDb();

    expect(await resetPasskeys(db, START)).toEqual({ passkeys: 0, sessions: 0 });
  });

  test("after it, the panel is back to the first-key state: the next first key can be registered", async () => {
    const { db } = await usedPanel();
    await resetPasskeys(db, after(MINUTE_MS));

    const registered = await insertPasskey(
      db,
      { credentialId: "credencial-nueva", publicKey: "clave", counter: 0, transports: [], name: "PC nueva" },
      { onlyIfNone: true },
    );

    expect(registered).not.toBeNull();
    expect(await countPasskeys(db)).toBe(1);
  });

  test("is all or nothing: if a step fails, no key is deleted and no session is closed", async () => {
    const { db } = await usedPanel();
    // El último paso del reinicio borra los códigos: sin su tabla falla, después de haber borrado las llaves.
    await db.execute(sql`drop table admin_enrollment_codes`);
    const now = after(MINUTE_MS);

    await expect(resetPasskeys(db, now)).rejects.toThrow();

    expect(await countPasskeys(db)).toBe(2);
    expect(await listActiveSessions(db, now)).toHaveLength(3);
    expect(await db.select().from(adminPendingLogins)).toHaveLength(1);
  });
});
