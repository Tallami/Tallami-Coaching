import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { count, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, test, vi } from "vitest";
import { DEMO_MONOTRIBUTO_SETTINGS, buildDemoData } from "@/admin/demo-data";
import { DEMO_INTEREST_ID_BASE } from "@/admin/demo-interest";
import { getMonotributoSettings } from "@/admin/settings/read";
import type { Db } from "@/db/client";
import { customers, interestEvents, sales, settings } from "@/db/schema";
import {
  SeedArgumentError,
  clearDemo,
  describeClearResult,
  parseSeedArgs,
  seedDemo,
} from "../../scripts/seed-demo";
import { createTestDb } from "../helpers/db";
import { seedSale } from "../helpers/sales-db";

const SCRIPT = fileURLToPath(new URL("../../scripts/seed-demo.ts", import.meta.url));
const TSX = fileURLToPath(new URL("../../node_modules/tsx/dist/cli.mjs", import.meta.url));
const TODAY = "2026-10-14";

/** Una venta de las que carga Tallami a mano (id al azar) sobre el alumno `customerId`. */
async function addRealSale(db: Db, customerId: string): Promise<string> {
  const [row] = await db
    .insert(sales)
    .values({
      customerId,
      item: "gamePlan",
      currency: "USD",
      amountMinor: 12000,
      arsPerUnit: "1500.0000",
      arsPerUsd: "1500.0000",
      rateSource: "manual",
      amountArsMinor: 18_000_000,
      amountUsdMinor: 12000,
      paymentMethod: "paypal",
      status: "paid",
      paidOn: "2026-10-06",
    })
    .returning({ id: sales.id });
  return row.id;
}

/** Un alumno, una venta y un clic "reales": con ids al azar, como los que carga Tallami o registra el sitio. */
async function addRealRows(db: Db) {
  const [customer] = await db.insert(customers).values({ name: "Una alumna real" }).returning({ id: customers.id });
  const saleId = await addRealSale(db, customer.id);
  const [click] = await db
    .insert(interestEvents)
    .values({ item: "lesson", locale: "es", ipHash: "hash-real" })
    .returning({ id: interestEvents.id });
  return { customerId: customer.id, saleId, clickId: click.id };
}

async function rowCounts(db: Db) {
  const [c] = await db.select({ rows: count() }).from(customers);
  const [s] = await db.select({ rows: count() }).from(sales);
  const [i] = await db.select({ rows: count() }).from(interestEvents);
  return { customers: c.rows, sales: s.rows, interest: i.rows };
}

const NOTHING = { customers: 0, sales: 0, interest: 0, keptCustomers: [] };

describe("parseSeedArgs", () => {
  test("no arguments loads the demo data; --clear takes it out", () => {
    expect(parseSeedArgs([])).toEqual({ clear: false });
    expect(parseSeedArgs(["--clear"])).toEqual({ clear: true });
  });

  test("anything else is refused, in Spanish, saying what is accepted", () => {
    for (const args of [["--borrar"], ["clear"], ["--clear", "--otra"], ["-c"]]) {
      expect(() => parseSeedArgs(args), args.join(" ")).toThrow(SeedArgumentError);
    }
    expect(() => parseSeedArgs(["--borrar"])).toThrow(/--borrar/);
    expect(() => parseSeedArgs(["--borrar"])).toThrow(/--clear/);
  });
});

describe("clearDemo", () => {
  test("takes out the demo students, sales and clicks, and nothing else", async () => {
    const db = await createTestDb();
    const real = await addRealRows(db);
    await seedDemo(db, TODAY);
    await db.insert(settings).values({ key: "otra", value: { algo: 1 } });

    const cleared = await clearDemo(db);

    const expected = buildDemoData(TODAY);
    expect(cleared).toEqual({
      customers: expected.customers.length,
      sales: expected.sales.length,
      interest: expected.interest.length,
      keptCustomers: [],
    });
    expect(await rowCounts(db)).toEqual({ customers: 1, sales: 1, interest: 1 });
    expect((await db.select({ id: customers.id }).from(customers))[0].id).toBe(real.customerId);
    expect((await db.select({ id: sales.id }).from(sales))[0].id).toBe(real.saleId);
    expect((await db.select({ id: interestEvents.id }).from(interestEvents))[0].id).toBe(real.clickId);
    expect(await db.select().from(settings).where(eq(settings.key, "otra"))).toHaveLength(1);
  });

  test("leaves the monotributo setting as it was", async () => {
    const db = await createTestDb();
    await seedDemo(db, TODAY);
    expect(await getMonotributoSettings(db)).toEqual(DEMO_MONOTRIBUTO_SETTINGS);

    await clearDemo(db);
    expect(await getMonotributoSettings(db)).toEqual(DEMO_MONOTRIBUTO_SETTINGS);

    await db.update(settings).set({ value: { category: "A", annualCapArsMinor: 1_000_000_000, validFrom: "2026-02-01" } });
    await seedDemo(db, TODAY);
    await clearDemo(db);
    expect((await getMonotributoSettings(db))?.category).toBe("A");
  });

  test("takes out the clicks of the reserved range and keeps the ones the site recorded", async () => {
    const db = await createTestDb();
    const real = await addRealRows(db);
    await seedDemo(db, TODAY);
    const demoClicks = await db.select({ id: interestEvents.id }).from(interestEvents).where(eq(interestEvents.ipHash, "demo"));
    expect(demoClicks.length).toBeGreaterThan(0);
    expect(demoClicks.every((click) => click.id >= DEMO_INTEREST_ID_BASE)).toBe(true);

    await clearDemo(db);

    expect(await db.select().from(interestEvents).where(eq(interestEvents.ipHash, "demo"))).toHaveLength(0);
    expect(await db.select().from(interestEvents).where(eq(interestEvents.id, real.clickId))).toHaveLength(1);
  });

  test("does not delete a demo student that a real sale is tied to, and says so", async () => {
    const db = await createTestDb();
    await seedDemo(db, TODAY);
    const tied = buildDemoData(TODAY).customers[2];
    const mine = await addRealSale(db, tied.id);

    const cleared = await clearDemo(db);

    const expected = buildDemoData(TODAY);
    expect(cleared.keptCustomers).toEqual([{ id: tied.id, name: tied.name }]);
    expect(cleared.customers).toBe(expected.customers.length - 1);
    expect(cleared.sales).toBe(expected.sales.length);
    // Se quedan el alumno y su venta real, intactos.
    expect(await db.select().from(customers).where(eq(customers.id, tied.id))).toHaveLength(1);
    expect(await db.select().from(sales).where(eq(sales.id, mine))).toHaveLength(1);
    expect(await rowCounts(db)).toEqual({ customers: 1, sales: 1, interest: 0 });
    // Y lo dice en español, nombrando al alumno.
    const message = describeClearResult(cleared);
    expect(message).toContain("1 alumno de ejemplo");
    expect(message).toContain(tied.name);
    expect(message).toMatch(/venta/);
  });

  test("runs in one transaction", async () => {
    const db = await createTestDb();
    await seedDemo(db, TODAY);
    const transaction = vi.spyOn(db, "transaction");

    await clearDemo(db);

    expect(transaction).toHaveBeenCalledTimes(1);
  });

  test("if something fails halfway nothing is deleted", async () => {
    const db = await createTestDb();
    await seedDemo(db, TODAY);
    const before = await rowCounts(db);
    // Un disparador que falla al borrar alumnos, que es el último paso: se deshace todo lo anterior.
    await db.execute(
      sql.raw("create function fail_customer_delete() returns trigger language plpgsql as $$ begin raise exception 'no se borra'; end $$"),
    );
    await db.execute(
      sql.raw("create trigger no_customer_delete before delete on customers for each row execute function fail_customer_delete()"),
    );

    await expect(clearDemo(db)).rejects.toThrow();

    expect(await rowCounts(db)).toEqual(before);
  });

  test("is safe to run twice, and on an empty database", async () => {
    const db = await createTestDb();
    expect(await clearDemo(db)).toEqual(NOTHING);
    await seedDemo(db, TODAY);
    await clearDemo(db);
    expect(await clearDemo(db)).toEqual(NOTHING);
    expect(await rowCounts(db)).toEqual({ customers: 0, sales: 0, interest: 0 });
  });

  test("takes out demo rows left by a run on another day, even when that day had more of them", async () => {
    const db = await createTestDb();
    const later = buildDemoData("2026-10-31");
    const sooner = buildDemoData("2026-11-01");
    expect(later.sales.length).toBeGreaterThan(sooner.sales.length);

    await seedDemo(db, "2026-10-31");
    await seedDemo(db, "2026-11-01");
    // Sin sobras de la corrida anterior: quedan las del día nuevo, ni una más.
    expect((await rowCounts(db)).sales).toBe(sooner.sales.length);

    await clearDemo(db);
    expect(await rowCounts(db)).toEqual({ customers: 0, sales: 0, interest: 0 });
  });

  test("seeding again does not break because a real sale is tied to a demo student", async () => {
    const db = await createTestDb();
    await seedDemo(db, TODAY);
    const tied = buildDemoData(TODAY).customers[0];
    await seedSale(db, { customer: { mode: "existing", id: tied.id } });

    await expect(seedDemo(db, TODAY)).resolves.toBeDefined();

    const expected = buildDemoData(TODAY);
    expect(await db.select().from(customers).where(eq(customers.id, tied.id))).toHaveLength(1);
    expect((await rowCounts(db)).customers).toBe(expected.customers.length);
    expect((await rowCounts(db)).sales).toBe(expected.sales.length + 1);
  });
});

describe("describeClearResult", () => {
  test("says how many rows went, in the singular and the plural", () => {
    expect(describeClearResult({ customers: 25, sales: 120, interest: 750, keptCustomers: [] })).toBe(
      "Listo: se borraron 120 ventas, 25 alumnos y 750 clics de ejemplo de la base local.",
    );
    expect(describeClearResult({ customers: 1, sales: 1, interest: 1, keptCustomers: [] })).toBe(
      "Listo: se borraron 1 venta, 1 alumno y 1 clic de ejemplo de la base local.",
    );
  });

  test("with nothing to take out it says so", () => {
    expect(describeClearResult(NOTHING)).toBe("No había datos de ejemplo en la base local: no se borró nada.");
  });

  test("names the students that stayed and says why", () => {
    const message = describeClearResult({
      customers: 3,
      sales: 10,
      interest: 5,
      keptCustomers: [
        { id: "a", name: "Alumno de prueba 3" },
        { id: "b", name: "Alumno de prueba 7" },
      ],
    });

    expect(message).toContain("2 alumnos de ejemplo");
    expect(message).toContain("«Alumno de prueba 3»");
    expect(message).toContain("«Alumno de prueba 7»");
    expect(message).toContain("ventas tuyas");
  });
});

describe("the script with --clear", () => {
  let dir: string | undefined;
  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  function run(args: string[], env: Record<string, string>) {
    return spawnSync(process.execPath, [TSX, SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
  }

  test("still refuses to run with DATABASE_URL", () => {
    const result = run(["--clear"], { DATABASE_URL: "postgres://user:clave@127.0.0.1:1/none" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL");
    expect(result.stdout).toBe("");
  });

  test("refuses an option it does not know, before touching anything", () => {
    const result = run(["--borrar"], { DATABASE_URL: "" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--clear");
    expect(result.stdout).toBe("");
  });

  test("loads the demo data into the local database and takes it out again", async () => {
    dir = await mkdtemp(path.join(tmpdir(), "tallami-seed-clear-"));
    const env = { DATABASE_URL: "", PGLITE_DIR: path.join(dir, "db") };

    const seeded = run([], env);
    expect(seeded.status, seeded.stderr).toBe(0);
    expect(seeded.stdout).toContain("alumnos");

    const cleared = run(["--clear"], env);
    expect(cleared.status, cleared.stderr).toBe(0);
    expect(cleared.stdout).toMatch(/Listo: se borraron \d+ ventas, \d+ alumnos y \d+ clics de ejemplo/);

    // Una segunda vez no encuentra nada y lo dice.
    const again = run(["--clear"], env);
    expect(again.status, again.stderr).toBe(0);
    expect(again.stdout).toContain("No había datos de ejemplo");
  });
});
