import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { count } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DbNotConfiguredError, getDb, type Db } from "@/db/client";
import { customers } from "@/db/schema";

// `getDb()` decide el driver con las variables de entorno y guarda la base en
// `globalThis`; cada test arranca sin base abierta y sin variables heredadas.

const globalForDb = globalThis as typeof globalThis & {
  __tallamiDb?: Promise<Db>;
};

/** Cierra el cliente de la base que dejó abierta el test, sea del driver que sea. */
async function closeOpenDb(): Promise<void> {
  const opening = globalForDb.__tallamiDb;
  globalForDb.__tallamiDb = undefined;
  const db = await opening?.catch(() => undefined);
  const client = (
    db as unknown as {
      $client?: { close?: () => Promise<void>; end?: () => Promise<void> };
    }
  )?.$client;
  await client?.close?.(); // PGlite
  await client?.end?.(); // postgres.js
}

describe("getDb", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "tallami-pglite-"));
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("PGLITE_DIR", path.join(dataDir, "db"));
  });

  afterEach(async () => {
    await closeOpenDb();
    vi.unstubAllEnvs();
    await rm(dataDir, { recursive: true, force: true });
  });

  test("on Vercel without DATABASE_URL it refuses instead of using PGlite", async () => {
    vi.stubEnv("VERCEL", "1");

    await expect(getDb()).rejects.toBeInstanceOf(DbNotConfiguredError);
    expect(existsSync(path.join(dataDir, "db"))).toBe(false);
  });

  test("after a failed attempt the next call tries again", async () => {
    vi.stubEnv("VERCEL", "1");
    await expect(getDb()).rejects.toBeInstanceOf(DbNotConfiguredError);

    vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:6543/postgres");

    await expect(getDb()).resolves.toBeDefined();
  });

  test("with DATABASE_URL it uses postgres.js without prepared statements", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@localhost:6543/postgres");

    const db = await getDb();

    // postgres.js conecta recién con la primera consulta: no hace falta red.
    const client = (db as unknown as { $client: { options: { prepare: boolean } } })
      .$client;
    expect(client.options.prepare).toBe(false);
    expect(existsSync(path.join(dataDir, "db"))).toBe(false);
  });

  test("locally it opens a migrated PGlite on disk and reuses it", async () => {
    const first = await getDb();
    const second = await getDb();

    expect(second).toBe(first);
    expect(existsSync(path.join(dataDir, "db"))).toBe(true);
    await expect(first.select({ rows: count() }).from(customers)).resolves.toEqual([
      { rows: 0 },
    ]);
  });
});
