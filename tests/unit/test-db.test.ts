import { count } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { customers, sales, settings } from "@/db/schema";
import { createTestDb } from "../helpers/db";

describe("createTestDb", () => {
  test("gives a database with the migrations applied and no rows", async () => {
    const db = await createTestDb();

    for (const table of [customers, sales, settings]) {
      const [row] = await db.select({ rows: count() }).from(table);
      expect(row.rows).toBe(0);
    }
  });

  test("every call gives its own database: what one writes the others never see", async () => {
    const first = await createTestDb();
    const second = await createTestDb();

    await first.insert(customers).values({ name: "Solo en la primera" });

    const [inFirst] = await first.select({ rows: count() }).from(customers);
    const [inSecond] = await second.select({ rows: count() }).from(customers);
    const [inThird] = await (await createTestDb()).select({ rows: count() }).from(customers);
    expect([inFirst.rows, inSecond.rows, inThird.rows]).toEqual([1, 0, 0]);
  });

  test("a database that was written to and closed does not touch the next one", async () => {
    const first = await createTestDb();
    await first.insert(settings).values({ key: "monotributo", value: { category: "C" } });
    await (first as unknown as { $client: { close: () => Promise<void> } }).$client.close();

    const [row] = await (await createTestDb()).select({ rows: count() }).from(settings);

    expect(row.rows).toBe(0);
  });
});
