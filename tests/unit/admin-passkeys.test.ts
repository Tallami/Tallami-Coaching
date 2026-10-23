import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { PASSKEY_NAME_MAX_LENGTH } from "@/admin/auth/policy";
import {
  countPasskeys,
  deletePasskeyUnlessLast,
  findPasskeyByCredentialId,
  insertPasskey,
  listPasskeys,
  recordPasskeyUse,
  renamePasskey,
} from "@/admin/auth/passkeys";
import type { NewPasskeyData } from "@/admin/auth/ceremonies";
import type { Db } from "@/db/client";
import { adminPasskeys, adminSessions } from "@/db/schema";
import { createSession, revokeKeylessSessions, validateSession } from "@/admin/auth/sessions";
import { createTestDb } from "../helpers/db";

// `revokeKeylessSessions` es el real salvo en el test que lo hace fallar a propósito.
vi.mock("@/admin/auth/sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/admin/auth/sessions")>();
  return { ...actual, revokeKeylessSessions: vi.fn(actual.revokeKeylessSessions) };
});

const START = new Date("2026-10-21T10:00:00.000Z");

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(adminSessions);
  await db.delete(adminPasskeys);
});

function keyData(credentialId: string, overrides: Partial<NewPasskeyData> = {}): NewPasskeyData {
  return { credentialId, publicKey: `clave-publica-${credentialId}`, counter: 0, transports: ["internal"], ...overrides };
}

async function add(credentialId: string, name = `Llave ${credentialId}`) {
  const key = await insertPasskey(db, { ...keyData(credentialId), name }, { onlyIfNone: false });
  if (!key) throw new Error("La llave de prueba no se guardó.");
  return key;
}

describe("insertPasskey", () => {
  test("stores the key and hands back all of it", async () => {
    const key = await insertPasskey(
      db,
      { ...keyData("credencial-1", { counter: 7, transports: ["internal", "hybrid"] }), name: "Celular" },
      { onlyIfNone: false },
    );

    expect(key).toMatchObject({
      credentialId: "credencial-1",
      publicKey: "clave-publica-credencial-1",
      counter: 7,
      transports: ["internal", "hybrid"],
      name: "Celular",
      lastUsedAt: null,
    });
    expect(key?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(key?.createdAt).toBeInstanceOf(Date);
    expect(await findPasskeyByCredentialId(db, "credencial-1")).toEqual(key);
  });

  test("with onlyIfNone it stores the first key and refuses when there already is one", async () => {
    const first = await insertPasskey(db, { ...keyData("primera"), name: "PC" }, { onlyIfNone: true });
    const second = await insertPasskey(db, { ...keyData("segunda"), name: "Celular" }, { onlyIfNone: true });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect((await listPasskeys(db)).map((key) => key.credentialId)).toEqual(["primera"]);
  });

  test("two first-key registrations at the same time add exactly one key", async () => {
    const results = await Promise.all([
      insertPasskey(db, { ...keyData("carrera-a"), name: "A" }, { onlyIfNone: true }),
      insertPasskey(db, { ...keyData("carrera-b"), name: "B" }, { onlyIfNone: true }),
    ]);

    expect(results.filter((key) => key !== null)).toHaveLength(1);
    expect(await countPasskeys(db)).toBe(1);
  });

  test("many first-key registrations at the same time still add exactly one", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        insertPasskey(db, { ...keyData(`rafaga-${i}`), name: `Llave ${i}` }, { onlyIfNone: true }),
      ),
    );

    expect(results.filter((key) => key !== null)).toHaveLength(1);
    expect(await countPasskeys(db)).toBe(1);
  });

  test("without onlyIfNone it adds another key to the ones already there", async () => {
    await add("una");
    await add("otra");

    expect(await countPasskeys(db)).toBe(2);
  });

  test("never stores the same credential twice: the database refuses it", async () => {
    await add("repetida");

    await expect(
      insertPasskey(db, { ...keyData("repetida"), name: "Otra" }, { onlyIfNone: false }),
    ).rejects.toThrow();
    expect(await countPasskeys(db)).toBe(1);
  });

  test("the database refuses a name of zero characters and one of 41", async () => {
    await expect(insertPasskey(db, { ...keyData("sin-nombre"), name: "" }, { onlyIfNone: false })).rejects.toThrow();
    await expect(
      insertPasskey(db, { ...keyData("nombre-largo"), name: "x".repeat(PASSKEY_NAME_MAX_LENGTH + 1) }, { onlyIfNone: false }),
    ).rejects.toThrow();
    expect(PASSKEY_NAME_MAX_LENGTH).toBe(40);
    expect(await countPasskeys(db)).toBe(0);

    const edge = await insertPasskey(
      db,
      { ...keyData("nombre-justo"), name: "x".repeat(PASSKEY_NAME_MAX_LENGTH) },
      { onlyIfNone: false },
    );
    expect(edge?.name).toHaveLength(PASSKEY_NAME_MAX_LENGTH);
  });
});

describe("reading keys", () => {
  test("listPasskeys returns the oldest first, countPasskeys counts them", async () => {
    expect(await listPasskeys(db)).toEqual([]);
    expect(await countPasskeys(db)).toBe(0);

    const first = await add("vieja");
    await db.update(adminPasskeys).set({ createdAt: new Date("2026-01-01T00:00:00Z") }).where(eq(adminPasskeys.id, first.id));
    await add("nueva");

    expect((await listPasskeys(db)).map((key) => key.credentialId)).toEqual(["vieja", "nueva"]);
    expect(await countPasskeys(db)).toBe(2);
  });

  test("findPasskeyByCredentialId finds a key by its credential and says null for an unknown one", async () => {
    const key = await add("conocida");

    expect(await findPasskeyByCredentialId(db, "conocida")).toEqual(key);
    expect(await findPasskeyByCredentialId(db, "desconocida")).toBeNull();
    expect(await findPasskeyByCredentialId(db, "")).toBeNull();
  });
});

describe("renamePasskey", () => {
  test("renames the key and says so", async () => {
    const key = await add("renombrable", "PC");

    expect(await renamePasskey(db, key.id, "Notebook")).toBe(true);

    expect((await findPasskeyByCredentialId(db, "renombrable"))?.name).toBe("Notebook");
  });

  test("says false for a key that does not exist, or an id that is not even an id", async () => {
    expect(await renamePasskey(db, randomUUID(), "Nombre")).toBe(false);
    expect(await renamePasskey(db, "esto-no-es-un-uuid", "Nombre")).toBe(false);
  });

  test("the database refuses an empty name and one that is too long, and the key keeps its name", async () => {
    const key = await add("con-nombre", "Celular");

    await expect(renamePasskey(db, key.id, "")).rejects.toThrow();
    await expect(renamePasskey(db, key.id, "x".repeat(PASSKEY_NAME_MAX_LENGTH + 1))).rejects.toThrow();

    expect((await findPasskeyByCredentialId(db, "con-nombre"))?.name).toBe("Celular");
  });
});

describe("deletePasskeyUnlessLast", () => {
  const NOW = new Date(START.getTime() + 5 * 60 * 1000);
  const LATER = new Date(START.getTime() + 6 * 60 * 1000);

  /** Abre a las 10:00 una sesión con la llave `passkeyId`. */
  function openWith(passkeyId: string): Promise<string> {
    return createSession(db, { passkeyId, device: "Chrome en Windows", reauthed: true }, START);
  }

  test("refuses to delete the only key, which stays", async () => {
    const only = await add("unica");

    expect(await deletePasskeyUnlessLast(db, only.id, NOW)).toEqual({ outcome: "last" });

    expect(await countPasskeys(db)).toBe(1);
    expect(await findPasskeyByCredentialId(db, "unica")).not.toBeNull();
  });

  test("deletes a key when there is another one, with no sessions to close", async () => {
    const phone = await add("celular");
    await add("notebook");

    expect(await deletePasskeyUnlessLast(db, phone.id, NOW)).toEqual({ outcome: "deleted", closedSessionIds: [] });

    expect((await listPasskeys(db)).map((key) => key.credentialId)).toEqual(["notebook"]);
  });

  test("after deleting down to one, the one left cannot be deleted", async () => {
    const first = await add("a");
    const second = await add("b");

    expect((await deletePasskeyUnlessLast(db, first.id, NOW)).outcome).toBe("deleted");
    expect(await deletePasskeyUnlessLast(db, second.id, NOW)).toEqual({ outcome: "last" });
    expect(await countPasskeys(db)).toBe(1);
  });

  test("says missing for a key that is not there, even when it would be the last", async () => {
    await add("unica-presente");

    expect(await deletePasskeyUnlessLast(db, randomUUID(), NOW)).toEqual({ outcome: "missing" });
    expect(await deletePasskeyUnlessLast(db, "esto-no-es-un-uuid", NOW)).toEqual({ outcome: "missing" });
    expect(await countPasskeys(db)).toBe(1);
  });

  test("two deletions at the same time with two keys leave one key, never zero", async () => {
    const first = await add("par-a");
    const second = await add("par-b");

    const results = await Promise.all([
      deletePasskeyUnlessLast(db, first.id, NOW),
      deletePasskeyUnlessLast(db, second.id, NOW),
    ]);

    expect(results.map((result) => result.outcome).sort()).toEqual(["deleted", "last"]);
    expect(await countPasskeys(db)).toBe(1);
  });

  test("the sessions opened with a deleted key keep their row, without the key", async () => {
    const phone = await add("con-sesion");
    await add("la-otra");
    const sessionId = await openWith(phone.id);

    expect((await deletePasskeyUnlessLast(db, phone.id, NOW)).outcome).toBe("deleted");

    const [session] = await db.select().from(adminSessions).where(eq(adminSessions.id, sessionId));
    expect(session.passkeyId).toBeNull();
  });

  test("closes in the same call the open sessions of the deleted key and hands back their ids", async () => {
    const phone = await add("celular");
    const laptop = await add("notebook");
    const phoneOne = await openWith(phone.id);
    const phoneTwo = await openWith(phone.id);
    const laptopOne = await openWith(laptop.id);
    const phoneClosedBefore = await openWith(phone.id);
    await db.update(adminSessions).set({ revokedAt: START }).where(eq(adminSessions.id, phoneClosedBefore));

    const result = await deletePasskeyUnlessLast(db, phone.id, NOW);

    expect(result.outcome).toBe("deleted");
    const closed = result.outcome === "deleted" ? result.closedSessionIds : [];
    expect([...closed].sort()).toEqual([phoneOne, phoneTwo].sort());
    expect(await validateSession(db, phoneOne, LATER)).toBeNull();
    expect(await validateSession(db, phoneTwo, LATER)).toBeNull();
    expect(await validateSession(db, laptopOne, LATER)).not.toBeNull();
  });

  test("also closes a session that was already left without a key, not only the ones of this key", async () => {
    const phone = await add("celular");
    const laptop = await add("notebook");
    await add("tableta");
    // Otro pedido ya le soltó la llave a esta sesión y todavía nadie la cerró: se busca por "sin llave", no por id.
    const orphan = await openWith(laptop.id);
    await db.delete(adminPasskeys).where(eq(adminPasskeys.id, laptop.id));
    expect((await db.select().from(adminSessions).where(eq(adminSessions.id, orphan)))[0].passkeyId).toBeNull();

    const result = await deletePasskeyUnlessLast(db, phone.id, NOW);

    expect(result).toEqual({ outcome: "deleted", closedSessionIds: [orphan] });
    expect(await validateSession(db, orphan, LATER)).toBeNull();
  });

  test("closes no session when the key is the last one or does not exist", async () => {
    const only = await add("unica");
    const session = await openWith(only.id);

    expect(await deletePasskeyUnlessLast(db, only.id, NOW)).toEqual({ outcome: "last" });
    expect(await deletePasskeyUnlessLast(db, randomUUID(), NOW)).toEqual({ outcome: "missing" });

    expect(await validateSession(db, session, LATER)).not.toBeNull();
  });

  test("if closing the sessions fails, the key is not deleted either: the whole deletion can be retried", async () => {
    const phone = await add("celular");
    await add("notebook");
    const session = await openWith(phone.id);
    vi.mocked(revokeKeylessSessions).mockRejectedValueOnce(new Error("la base se cortó"));

    await expect(deletePasskeyUnlessLast(db, phone.id, NOW)).rejects.toThrow("la base se cortó");

    expect(await countPasskeys(db)).toBe(2);
    expect(await validateSession(db, session, LATER)).not.toBeNull();
    const retry = await deletePasskeyUnlessLast(db, phone.id, NOW);
    expect(retry).toEqual({ outcome: "deleted", closedSessionIds: [session] });
  });
});


describe("recordPasskeyUse", () => {
  test("saves the new counter and the moment of use", async () => {
    const key = await add("usada");

    await recordPasskeyUse(db, key.id, 5, START);

    expect(await findPasskeyByCredentialId(db, "usada")).toMatchObject({ counter: 5, lastUsedAt: START });
  });

  test("uses the current time when none is given", async () => {
    const key = await add("usada-ahora");
    const before = Date.now();

    await recordPasskeyUse(db, key.id, 1);

    const saved = await findPasskeyByCredentialId(db, "usada-ahora");
    expect(saved?.lastUsedAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("the counter only goes up: a late write cannot take it back", async () => {
    const key = await add("contador");

    await recordPasskeyUse(db, key.id, 9, START);
    await recordPasskeyUse(db, key.id, 4, new Date(START.getTime() + 1000));

    expect(await findPasskeyByCredentialId(db, "contador")).toMatchObject({ counter: 9, lastUsedAt: START });
  });

  test("a key whose counter stays at zero still gets its last use noted", async () => {
    const key = await add("sin-contador");

    await recordPasskeyUse(db, key.id, 0, START);
    await recordPasskeyUse(db, key.id, 0, new Date(START.getTime() + 60_000));

    expect(await findPasskeyByCredentialId(db, "sin-contador")).toMatchObject({
      counter: 0,
      lastUsedAt: new Date(START.getTime() + 60_000),
    });
  });
});
