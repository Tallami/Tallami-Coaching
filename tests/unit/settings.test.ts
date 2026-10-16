import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import { getMonotributoSettings, getMonotributoUpdatedAt } from "@/admin/settings/read";
import {
  InvalidMonotributoSettingsError,
  MONOTRIBUTO_CATEGORIES,
  saveMonotributoSettings,
} from "@/admin/settings/repository";
import { settings } from "@/db/schema";
import { createTestDb } from "../helpers/db";

const INPUT = { category: "C", annualCapArs: "21.113.697,00", validFrom: "2026-08-01" } as const;

async function rawRow(db: Awaited<ReturnType<typeof createTestDb>>) {
  const rows = await db.select().from(settings).where(eq(settings.key, "monotributo"));
  return rows;
}

describe("saveMonotributoSettings", () => {
  test("saves and reads monotributo settings", async () => {
    const db = await createTestDb();

    await saveMonotributoSettings(db, INPUT);

    expect(await getMonotributoSettings(db)).toEqual({
      category: "C",
      annualCapArsMinor: 2_111_369_700,
      validFrom: "2026-08-01",
    });
  });

  test("stores the cap as integer cents of a peso in one row", async () => {
    const db = await createTestDb();

    await saveMonotributoSettings(db, INPUT);

    const rows = await rawRow(db);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toEqual({
      category: "C",
      annualCapArsMinor: 2_111_369_700,
      validFrom: "2026-08-01",
    });
  });

  test.each([
    ["21113697", 2_111_369_700],
    ["21113697,50", 2_111_369_750],
    ["21113697.5", 2_111_369_750],
    ["  21.113.697  ", 2_111_369_700],
  ])("understands the cap written as %j", async (text, minor) => {
    const db = await createTestDb();

    await saveMonotributoSettings(db, { ...INPUT, annualCapArs: text });

    expect((await getMonotributoSettings(db))?.annualCapArsMinor).toBe(minor);
  });

  test("saving again replaces the values and moves the update time forward", async () => {
    const db = await createTestDb();
    await saveMonotributoSettings(db, INPUT);
    const first = await getMonotributoUpdatedAt(db);

    await new Promise((resolve) => setTimeout(resolve, 15));
    await saveMonotributoSettings(db, {
      category: "h",
      annualCapArs: "40.000.000",
      validFrom: "2027-02-01",
    });

    expect(await rawRow(db)).toHaveLength(1);
    expect(await getMonotributoSettings(db)).toEqual({
      category: "H",
      annualCapArsMinor: 4_000_000_000,
      validFrom: "2027-02-01",
    });
    const second = await getMonotributoUpdatedAt(db);
    expect(first).toBeInstanceOf(Date);
    expect(second!.getTime()).toBeGreaterThan(first!.getTime());
  });

  test("accepts every category from A to K", async () => {
    expect(MONOTRIBUTO_CATEGORIES).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"]);
    const db = await createTestDb();

    for (const category of MONOTRIBUTO_CATEGORIES) {
      await saveMonotributoSettings(db, { ...INPUT, category });
      expect((await getMonotributoSettings(db))?.category).toBe(category);
    }
  });

  test("strips NUL characters from the text it keeps", async () => {
    const db = await createTestDb();

    await saveMonotributoSettings(db, { ...INPUT, category: "D\u0000" });

    expect((await getMonotributoSettings(db))?.category).toBe("D");
  });

  test.each([
    ["a category outside A to K", { category: "Z" }, "category"],
    ["a blank category", { category: "  " }, "category"],
    ["a category with two letters", { category: "AB" }, "category"],
    ["a cap that is not a number", { annualCapArs: "mucho" }, "annualCapArs"],
    ["a blank cap", { annualCapArs: "" }, "annualCapArs"],
    ["a cap of zero", { annualCapArs: "0" }, "annualCapArs"],
    ["a negative cap", { annualCapArs: "-5" }, "annualCapArs"],
    ["a cap that could be thousands or decimals", { annualCapArs: "1.500" }, "annualCapArs"],
    ["a cap too big to be real", { annualCapArs: "99.999.999.999.999" }, "annualCapArs"],
    ["a date that does not exist", { validFrom: "2026-02-30" }, "validFrom"],
    ["a date in another format", { validFrom: "01/08/2026" }, "validFrom"],
    ["a date from the year 26", { validFrom: "0026-08-01" }, "validFrom"],
    ["a blank date", { validFrom: "" }, "validFrom"],
  ])("rejects %s and keeps what was saved", async (_label, change, field) => {
    const db = await createTestDb();
    await saveMonotributoSettings(db, INPUT);

    const attempt = saveMonotributoSettings(db, { ...INPUT, ...change } as never);

    await expect(attempt).rejects.toBeInstanceOf(InvalidMonotributoSettingsError);
    await expect(attempt).rejects.toMatchObject({ fieldErrors: { [field]: expect.any(String) } });
    expect(await getMonotributoSettings(db)).toEqual({
      category: "C",
      annualCapArsMinor: 2_111_369_700,
      validFrom: "2026-08-01",
    });
  });

  test("reports every wrong field at once, in spanish", async () => {
    const db = await createTestDb();

    const error = await saveMonotributoSettings(db, {
      category: "Z",
      annualCapArs: "abc",
      validFrom: "",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidMonotributoSettingsError);
    const { fieldErrors } = error as InvalidMonotributoSettingsError;
    expect(Object.keys(fieldErrors).sort()).toEqual(["annualCapArs", "category", "validFrom"]);
    expect(fieldErrors.category).toBe("Elegí la categoría, de la A a la K.");
    expect(fieldErrors.validFrom).toBe("Cargá desde qué fecha rige el tope.");
  });

  test("nothing is written when the input is wrong", async () => {
    const db = await createTestDb();

    await saveMonotributoSettings(db, { ...INPUT, category: "?" }).catch(() => undefined);

    expect(await rawRow(db)).toHaveLength(0);
    expect(await getMonotributoUpdatedAt(db)).toBeNull();
  });

  test("garbage that is not even text is rejected instead of crashing", async () => {
    const db = await createTestDb();

    const attempt = saveMonotributoSettings(db, {
      category: undefined,
      annualCapArs: 5,
      validFrom: null,
    } as never);

    await expect(attempt).rejects.toBeInstanceOf(InvalidMonotributoSettingsError);
  });
});

describe("getMonotributoUpdatedAt", () => {
  test("is null when nothing was saved", async () => {
    expect(await getMonotributoUpdatedAt(await createTestDb())).toBeNull();
  });
});
