import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, test } from "vitest";
import { PASSKEY_NAME_MAX_LENGTH } from "@/admin/auth/policy";
import type { Db } from "@/db/client";
import { adminEnrollmentCodes, adminPasskeys, adminPendingLogins, adminSessions } from "@/db/schema";
import { createTestDb } from "../helpers/db";

// Las cuatro tablas de la seguridad del ingreso al panel: llaves de acceso,
// sesiones, ingresos a medio camino y códigos para otro dispositivo.

const LATER = new Date("2026-10-21T18:00:00.000Z");

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

describe("admin auth tables", () => {
  let db: Db;
  let counter = 0;

  beforeAll(async () => {
    db = await createTestDb();
  });

  function newPasskey(overrides: Partial<typeof adminPasskeys.$inferInsert> = {}) {
    counter += 1;
    return { credentialId: `credencial-${counter}`, publicKey: "clave-publica", name: "Celular", ...overrides };
  }

  function newSession(overrides: Partial<typeof adminSessions.$inferInsert> = {}) {
    counter += 1;
    return { id: `sesion-${counter}`, device: "Chrome en Windows", expiresAt: LATER, ...overrides };
  }

  function newPendingLogin(overrides: Partial<typeof adminPendingLogins.$inferInsert> = {}) {
    counter += 1;
    return {
      id: `ingreso-${counter}`,
      mode: "passkey",
      nextPath: "/admin",
      ipHash: "hash-de-una-ip",
      device: "Chrome en Windows",
      expiresAt: LATER,
      ...overrides,
    };
  }

  describe("passkeys", () => {
    test("start with no uses, a signature counter at zero and no transports", async () => {
      const [row] = await db.insert(adminPasskeys).values(newPasskey()).returning();

      expect(row.counter).toBe(0);
      expect(row.transports).toEqual([]);
      expect(row.lastUsedAt).toBeNull();
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    test("store the transports as a list and a big counter as a number", async () => {
      const [row] = await db
        .insert(adminPasskeys)
        .values(newPasskey({ transports: ["internal", "hybrid"], counter: 2 ** 40 }))
        .returning();

      expect(row.transports).toEqual(["internal", "hybrid"]);
      expect(row.counter).toBe(2 ** 40);
    });

    test("have a name of one to forty characters", async () => {
      const longest = "x".repeat(PASSKEY_NAME_MAX_LENGTH);

      await expect(db.insert(adminPasskeys).values(newPasskey({ name: "a" }))).resolves.toBeDefined();
      await expect(db.insert(adminPasskeys).values(newPasskey({ name: longest }))).resolves.toBeDefined();
      expect(await violatedConstraint(db.insert(adminPasskeys).values(newPasskey({ name: "" })))).toBe(
        "admin_passkeys_name_length",
      );
      expect(await violatedConstraint(db.insert(adminPasskeys).values(newPasskey({ name: `${longest}x` })))).toBe(
        "admin_passkeys_name_length",
      );
    });

    test("cannot repeat a credential id", async () => {
      await db.insert(adminPasskeys).values(newPasskey({ credentialId: "repetida" }));

      expect(await violatedConstraint(db.insert(adminPasskeys).values(newPasskey({ credentialId: "repetida" })))).toBe(
        "admin_passkeys_credential_id_unique",
      );
    });
  });

  describe("sessions", () => {
    test("start with no challenge, no confirmation and not revoked", async () => {
      const [row] = await db.insert(adminSessions).values(newSession()).returning();

      expect(row).toMatchObject({
        passkeyId: null,
        reauthAt: null,
        revokedAt: null,
        challenge: null,
        challengePurpose: null,
        challengeExpiresAt: null,
      });
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.lastSeenAt).toBeInstanceOf(Date);
    });

    test("keep a challenge only for confirming or for registering a key", async () => {
      for (const challengePurpose of ["reauth", "register", null]) {
        await expect(
          db.insert(adminSessions).values(newSession({ challengePurpose, challenge: "desafio", challengeExpiresAt: LATER })),
        ).resolves.toBeDefined();
      }

      expect(
        await violatedConstraint(db.insert(adminSessions).values(newSession({ challengePurpose: "login" }))),
      ).toBe("admin_sessions_challenge_purpose_valid");
    });

    test("survive the deletion of their passkey, without a passkey", async () => {
      const [passkey] = await db.insert(adminPasskeys).values(newPasskey()).returning({ id: adminPasskeys.id });
      const [session] = await db
        .insert(adminSessions)
        .values(newSession({ passkeyId: passkey.id }))
        .returning({ id: adminSessions.id });

      await db.delete(adminPasskeys).where(eq(adminPasskeys.id, passkey.id));

      const [row] = await db.select().from(adminSessions).where(eq(adminSessions.id, session.id));
      expect(row.passkeyId).toBeNull();
    });

    test("only point to a passkey that exists", async () => {
      const missing = "00000000-0000-4000-8000-000000000000";

      expect(await violatedConstraint(db.insert(adminSessions).values(newSession({ passkeyId: missing })))).toBe(
        "admin_sessions_passkey_id_admin_passkeys_id_fk",
      );
    });
  });

  describe("half-done logins", () => {
    test("know how they will finish: with a key, with the first key, or with a code", async () => {
      for (const mode of ["passkey", "first-key", "code"]) {
        await expect(db.insert(adminPendingLogins).values(newPendingLogin({ mode }))).resolves.toBeDefined();
      }

      expect(await violatedConstraint(db.insert(adminPendingLogins).values(newPendingLogin({ mode: "password" })))).toBe(
        "admin_pending_logins_mode_valid",
      );
    });

    test("start with no challenge and not consumed", async () => {
      const [row] = await db.insert(adminPendingLogins).values(newPendingLogin()).returning();

      expect(row.challenge).toBeNull();
      expect(row.consumedAt).toBeNull();
      expect(row.createdAt).toBeInstanceOf(Date);
    });
  });

  describe("enrollment codes", () => {
    test("belong to the session that made them and disappear with it", async () => {
      const [session] = await db.insert(adminSessions).values(newSession()).returning({ id: adminSessions.id });
      await db.insert(adminEnrollmentCodes).values({ codeHash: "hash-1", createdBySession: session.id, expiresAt: LATER });

      await db.delete(adminSessions).where(eq(adminSessions.id, session.id));

      expect(await db.select().from(adminEnrollmentCodes).where(eq(adminEnrollmentCodes.codeHash, "hash-1"))).toEqual([]);
    });

    test("start unused and cannot repeat a hash", async () => {
      const [session] = await db.insert(adminSessions).values(newSession()).returning({ id: adminSessions.id });
      const [code] = await db
        .insert(adminEnrollmentCodes)
        .values({ codeHash: "hash-2", createdBySession: session.id, expiresAt: LATER })
        .returning();

      expect(code.usedAt).toBeNull();
      expect(code.createdAt).toBeInstanceOf(Date);
      expect(
        await violatedConstraint(
          db.insert(adminEnrollmentCodes).values({ codeHash: "hash-2", createdBySession: session.id, expiresAt: LATER }),
        ),
      ).toBe("admin_enrollment_codes_code_hash_unique");
    });

    test("need an existing session", async () => {
      expect(
        await violatedConstraint(
          db.insert(adminEnrollmentCodes).values({ codeHash: "hash-3", createdBySession: "no-existe", expiresAt: LATER }),
        ),
      ).toBe("admin_enrollment_codes_created_by_session_admin_sessions_id_fk");
    });
  });

  test("the tables exist and start empty in a fresh database", async () => {
    const fresh = await createTestDb();

    for (const table of [adminPasskeys, adminSessions, adminPendingLogins, adminEnrollmentCodes]) {
      expect(await fresh.select().from(table)).toEqual([]);
    }
  });
});
