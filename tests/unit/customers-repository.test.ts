import { count } from "drizzle-orm";
import { beforeAll, describe, expect, test } from "vitest";
import { createCustomer, searchCustomers } from "@/admin/customers/repository";
import type { Db } from "@/db/client";
import { customers } from "@/db/schema";
import { createTestDb } from "../helpers/db";

describe("customers repository", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
    await createCustomer(db, { name: "Ana Pérez", discord: "ana.fn", country: "AR" });
    await createCustomer(db, { name: "Bruno Souza", discord: "Bruninho", country: "BR" });
    await createCustomer(db, { name: "Carla 100%", country: "MX" });
    await createCustomer(db, { name: "Diego_Ruiz" });
    for (let index = 1; index <= 10; index += 1) {
      await createCustomer(db, { name: `Lote ${String(index).padStart(2, "0")}` });
    }
  });

  test("creates a student and gives back its id", async () => {
    const before = await db.select({ total: count() }).from(customers);

    const { id } = await createCustomer(db, { name: "Elena", discord: "elena", country: "ar" });

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const after = await db.select({ total: count() }).from(customers);
    expect(after[0].total).toBe(before[0].total + 1);
    const [found] = await searchCustomers(db, "Elena");
    expect(found).toEqual({ id, name: "Elena", discord: "elena", country: "AR" });
  });

  test("searches by name or discord without caring about case", async () => {
    expect((await searchCustomers(db, "ana")).map((c) => c.name)).toContain("Ana Pérez");
    expect((await searchCustomers(db, "ANA PÉREZ")).map((c) => c.name)).toEqual(["Ana Pérez"]);
    // Las mayúsculas se igualan también con acentos; los acentos en sí, no.
    expect(await searchCustomers(db, "perez")).toEqual([]);
    expect((await searchCustomers(db, "bruninho")).map((c) => c.name)).toEqual(["Bruno Souza"]);
    expect((await searchCustomers(db, "  souza  ")).map((c) => c.name)).toEqual(["Bruno Souza"]);
  });

  test("treats % and _ in the text as plain characters", async () => {
    expect((await searchCustomers(db, "100%")).map((c) => c.name)).toEqual(["Carla 100%"]);
    expect((await searchCustomers(db, "%")).map((c) => c.name)).toEqual(["Carla 100%"]);
    expect((await searchCustomers(db, "o_r")).map((c) => c.name)).toEqual(["Diego_Ruiz"]);
    expect(await searchCustomers(db, "\\")).toEqual([]);
  });

  test("answers at most eight students by default, ordered by name", async () => {
    const found = await searchCustomers(db, "Lote");

    expect(found).toHaveLength(8);
    expect(found.map((c) => c.name)).toEqual([
      "Lote 01",
      "Lote 02",
      "Lote 03",
      "Lote 04",
      "Lote 05",
      "Lote 06",
      "Lote 07",
      "Lote 08",
    ]);
    expect(await searchCustomers(db, "Lote", 3)).toHaveLength(3);
  });

  test("an empty search lists the first students instead of everybody", async () => {
    const found = await searchCustomers(db, "   ");

    expect(found.length).toBeLessThanOrEqual(8);
    expect(found.length).toBeGreaterThan(0);
  });

  test("a missing discord or country stays empty", async () => {
    const [found] = await searchCustomers(db, "Diego_Ruiz");

    expect(found.discord).toBeNull();
    expect(found.country).toBeNull();
  });
});
