import { describe, expect, test } from "vitest";
import { getMonotributoSettings } from "@/admin/settings/read";
import { settings } from "@/db/schema";
import { createTestDb } from "../helpers/db";

const VALID = { category: "C", annualCapArsMinor: 2_111_369_700, validFrom: "2026-08-01" };

async function dbWith(value: unknown) {
  const db = await createTestDb();
  await db.insert(settings).values({ key: "monotributo", value });
  return db;
}

describe("getMonotributoSettings", () => {
  test("is null when nothing was loaded", async () => {
    expect(await getMonotributoSettings(await createTestDb())).toBeNull();
  });

  test("reads the category, the annual cap and since when it applies", async () => {
    expect(await getMonotributoSettings(await dbWith(VALID))).toEqual(VALID);
  });

  test("ignores other settings and extra fields", async () => {
    const db = await dbWith({ ...VALID, updatedBy: "someone" });
    await db.insert(settings).values({ key: "other", value: { category: "Z" } });
    expect(await getMonotributoSettings(db)).toEqual(VALID);
  });

  test("trims the category", async () => {
    const db = await dbWith({ ...VALID, category: "  H " });
    expect(await getMonotributoSettings(db)).toEqual({ ...VALID, category: "H" });
  });

  test.each([
    ["a missing category", { annualCapArsMinor: 100, validFrom: "2026-08-01" }],
    ["a blank category", { ...VALID, category: "  " }],
    ["a category that is not text", { ...VALID, category: 3 }],
    ["a missing cap", { category: "C", validFrom: "2026-08-01" }],
    ["a cap with decimals", { ...VALID, annualCapArsMinor: 100.5 }],
    ["a cap of zero", { ...VALID, annualCapArsMinor: 0 }],
    ["a negative cap", { ...VALID, annualCapArsMinor: -5 }],
    ["a cap written as text", { ...VALID, annualCapArsMinor: "2111369700" }],
    ["a cap too big to be exact", { ...VALID, annualCapArsMinor: 1e20 }],
    ["a missing date", { category: "C", annualCapArsMinor: 100 }],
    ["a date that does not exist", { ...VALID, validFrom: "2026-02-30" }],
    ["a date in another format", { ...VALID, validFrom: "01/08/2026" }],
    ["a list", [VALID]],
    ["text", "monotributo"],
    ["a number", 5],
  ])("is null for %s", async (_label, value) => {
    expect(await getMonotributoSettings(await dbWith(value))).toBeNull();
  });
});
