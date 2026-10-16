import { describe, expect, test } from "vitest";
import {
  MIGRATE_WITHOUT_DATABASE_URL_MESSAGE,
  assertDatabaseUrlForMigrate,
} from "@/db/migrate-guard";

const NODE = ["node", "node_modules/drizzle-kit/bin.cjs"];
const URL = "postgres://usuario:clave@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";

describe("assertDatabaseUrlForMigrate", () => {
  test("refuses to migrate without DATABASE_URL and says so in Spanish, naming the variable", () => {
    expect(() => assertDatabaseUrlForMigrate([...NODE, "migrate"], {})).toThrow(
      MIGRATE_WITHOUT_DATABASE_URL_MESSAGE,
    );
    expect(MIGRATE_WITHOUT_DATABASE_URL_MESSAGE).toContain("DATABASE_URL");
    expect(MIGRATE_WITHOUT_DATABASE_URL_MESSAGE).toMatch(/Falta|falta/);
    expect(MIGRATE_WITHOUT_DATABASE_URL_MESSAGE).toContain("db:migrate");
  });

  test.each([["empty", ""], ["only spaces", "   "], ["undefined", undefined]])(
    "treats an %s DATABASE_URL as missing",
    (_label, value) => {
      expect(() =>
        assertDatabaseUrlForMigrate([...NODE, "migrate"], { DATABASE_URL: value }),
      ).toThrow(/DATABASE_URL/);
    },
  );

  test("lets the migration run when DATABASE_URL is there", () => {
    expect(() =>
      assertDatabaseUrlForMigrate([...NODE, "migrate"], { DATABASE_URL: URL }),
    ).not.toThrow();
  });

  test("notices the command wherever the options are", () => {
    expect(() =>
      assertDatabaseUrlForMigrate([...NODE, "migrate", "--config", "drizzle.config.ts"], {}),
    ).toThrow(/DATABASE_URL/);
  });

  test("does not get in the way of the commands that only read the schema", () => {
    for (const command of ["generate", "check", "up"]) {
      expect(() => assertDatabaseUrlForMigrate([...NODE, command], {}), command).not.toThrow();
    }
    expect(() => assertDatabaseUrlForMigrate(NODE, {})).not.toThrow();
  });
});
