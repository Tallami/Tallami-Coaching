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

  test("looks only at the command, not at the value of an option that happens to say migrate", () => {
    for (const args of [
      ["generate", "--name", "migrate"],
      ["generate", "--name=migrate"],
      ["generate", "--custom", "--name", "migrate"],
      ["check", "migrate"],
    ]) {
      expect(() => assertDatabaseUrlForMigrate([...NODE, ...args], {}), args.join(" ")).not.toThrow();
    }
  });

  test("the command is the first argument that is not an option, and options before it do not hide it", () => {
    expect(() => assertDatabaseUrlForMigrate([...NODE, "--verbose", "migrate"], {})).toThrow(/DATABASE_URL/);
    expect(() => assertDatabaseUrlForMigrate([...NODE, "--config=drizzle.config.ts", "migrate"], {})).toThrow(/DATABASE_URL/);
    expect(() => assertDatabaseUrlForMigrate([...NODE, "migrate", "--name", "generate"], {})).toThrow(/DATABASE_URL/);
  });

  test("sees the command after an option whose value is a separate argument", () => {
    // `--config archivo.ts migrate`: el primer argumento sin guion es el archivo, no el comando.
    for (const args of [
      ["--config", "drizzle.config.ts", "migrate"],
      ["--config", "otra/ruta/drizzle.ts", "--verbose", "migrate"],
      ["--out", "drizzle", "migrate"],
      ["--dialect", "postgresql", "--schema", "src/db/schema.ts", "migrate"],
      ["--name", "algo", "migrate"],
    ]) {
      expect(() => assertDatabaseUrlForMigrate([...NODE, ...args], {}), args.join(" ")).toThrow(/DATABASE_URL/);
      expect(() => assertDatabaseUrlForMigrate([...NODE, ...args], { DATABASE_URL: URL }), args.join(" ")).not.toThrow();
    }
  });

  test("skips the value of an option, even when the value says migrate", () => {
    for (const args of [
      ["--config", "migrate", "generate"],
      ["--out", "migrate", "check"],
      ["--prefix", "migrate", "generate"],
      ["generate", "--config", "migrate"],
    ]) {
      expect(() => assertDatabaseUrlForMigrate([...NODE, ...args], {}), args.join(" ")).not.toThrow();
    }
  });

  test("an option with its value inside (--config=file.ts) does not swallow the next argument", () => {
    expect(() => assertDatabaseUrlForMigrate([...NODE, "--config=drizzle.config.ts", "migrate"], {})).toThrow(/DATABASE_URL/);
    expect(() => assertDatabaseUrlForMigrate([...NODE, "--out=drizzle", "generate"], {})).not.toThrow();
  });

  test("does not get in the way of the commands that only read the schema", () => {
    for (const command of ["generate", "check", "up"]) {
      expect(() => assertDatabaseUrlForMigrate([...NODE, command], {}), command).not.toThrow();
    }
    expect(() => assertDatabaseUrlForMigrate(NODE, {})).not.toThrow();
  });
});
