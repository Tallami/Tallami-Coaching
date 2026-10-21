import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { beforeAll, describe, expect, test } from "vitest";
import type { Db } from "@/db/client";
import * as schema from "@/db/schema";
import { createTestDb } from "../helpers/db";

// Las tablas del panel viven en Supabase, y Supabase publica por defecto las
// tablas del esquema `public` en su Data API (PostgREST) para los roles `anon`
// y `authenticated`. Con RLS activada y sin políticas esos roles no ven ni
// escriben nada. La app no usa la Data API: se conecta por `DATABASE_URL` con el
// dueño de las tablas (`postgres`), que se salta la RLS.

const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

/** Las tablas de la seguridad del ingreso al panel: llaves, sesiones, ingresos a medio camino y códigos. */
const LOGIN_SECURITY_TABLES = [
  "admin_passkeys",
  "admin_sessions",
  "admin_pending_logins",
  "admin_enrollment_codes",
];

/** Las tablas que exporta el schema de Drizzle. */
function schemaTables(): PgTable[] {
  const tables: PgTable[] = [];
  for (const value of Object.values(schema)) {
    if (is(value, PgTable)) tables.push(value);
  }
  return tables;
}

/** Las filas que devuelve un `db.execute` de PGlite (el tipo genérico de `Db` no las expone). */
function rowsOf(result: unknown): Record<string, unknown>[] {
  return (result as { rows: Record<string, unknown>[] }).rows;
}

/** El SQL de todas las migraciones, en orden, sin los comentarios de línea. */
function migrationSql(): string {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"))
    .join("\n");
}

describe("row level security", () => {
  test("the six first tables are in the schema", () => {
    const names = schemaTables().map(getTableName);

    expect(names).toEqual(
      expect.arrayContaining([
        "customers",
        "sales",
        "settings",
        "exchange_rates",
        "login_attempts",
        "interest_events",
      ]),
    );
  });

  test("the four tables of the login security are in the schema", () => {
    const names = schemaTables().map(getTableName);

    expect(names).toEqual(
      expect.arrayContaining(LOGIN_SECURITY_TABLES),
    );
  });

  test("every table of the schema declares row level security, so a new table cannot skip it", () => {
    for (const table of schemaTables()) {
      expect(
        getTableConfig(table).enableRLS,
        `La tabla ${getTableName(table)} no activa la RLS: agregale .enableRLS() en src/db/schema.ts`,
      ).toBe(true);
    }
  });

  test("the migrations turn row level security on for every table of the schema", () => {
    const migrations = migrationSql();

    for (const table of schemaTables()) {
      const name = getTableName(table);
      expect(
        migrations,
        `Ninguna migración de drizzle/ activa la RLS de ${name}: corré npm run db:generate`,
      ).toContain(`ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY;`);
    }
  });

  test("the migrations add no policy: without one, the Data API roles see nothing", () => {
    expect(migrationSql()).not.toMatch(/CREATE POLICY/i);
  });
});

describe("row level security at work", () => {
  let db: Db;
  // `anon` es el rol de la Data API de Supabase para quien no inició sesión; en la base de
  // prueba hace falta crearlo, con los mismos permisos que Supabase le da sobre las tablas.
  const API_ROLE = "api_role_de_prueba";

  beforeAll(async () => {
    db = await createTestDb();
    await db.execute(sql`create role ${sql.identifier(API_ROLE)} nologin`);
    await db.execute(sql`grant usage on schema public to ${sql.identifier(API_ROLE)}`);
    await db.execute(
      sql`grant select, insert, update, delete on all tables in schema public to ${sql.identifier(API_ROLE)}`,
    );
    await db.execute(
      sql`insert into customers (name) values ('Alumno de la RLS'), ('Otro alumno de la RLS')`,
    );
    // Una fila en cada tabla de la seguridad del ingreso: así, que el rol de la API no lea nada
    // de ellas (más abajo) prueba que la RLS las esconde y no que están vacías.
    await db.execute(
      sql`insert into admin_passkeys (credential_id, public_key, name) values ('credencial-rls', 'clave', 'Celular')`,
    );
    await db.execute(
      sql`insert into admin_sessions (id, device, expires_at) values ('sesion-rls', 'Chrome en Windows', now() + interval '8 hours')`,
    );
    await db.execute(
      sql`insert into admin_pending_logins (id, mode, next_path, ip_hash, device, expires_at)
          values ('ingreso-rls', 'passkey', '/admin', 'hash', 'Chrome en Windows', now() + interval '5 minutes')`,
    );
    await db.execute(
      sql`insert into admin_enrollment_codes (code_hash, created_by_session, expires_at)
          values ('codigo-rls', 'sesion-rls', now() + interval '10 minutes')`,
    );
  });

  async function asApiRole<T>(run: () => Promise<T>): Promise<T> {
    await db.execute(sql`set role ${sql.identifier(API_ROLE)}`);
    try {
      return await run();
    } finally {
      await db.execute(sql`reset role`);
    }
  }

  test("the owner, which is how the app connects, still reads and writes", async () => {
    const before = await db.execute(sql`select count(*)::int as total from customers`);
    await db.execute(sql`insert into customers (name) values ('Escrito por el dueño')`);
    const after = await db.execute(sql`select count(*)::int as total from customers`);

    const totalBefore = Number(rowsOf(before)[0].total);
    expect(totalBefore).toBeGreaterThanOrEqual(2);
    expect(Number(rowsOf(after)[0].total)).toBe(totalBefore + 1);
  });

  test("the table owner is exempt even without being a superuser, as postgres is in Supabase", async () => {
    // Una base aparte: acá se le cambia el dueño a las tablas.
    const other = await createTestDb();
    await other.execute(sql`create role dueno_de_prueba nologin`);
    for (const table of schemaTables()) {
      await other.execute(
        sql`alter table ${sql.identifier(getTableName(table))} owner to dueno_de_prueba`,
      );
    }
    await other.execute(sql`insert into customers (name) values ('Visible para el dueño')`);

    await other.execute(sql`set role dueno_de_prueba`);
    try {
      const rows = await other.execute(sql`select name from customers`);
      expect(rowsOf(rows).map((row) => row.name)).toEqual(["Visible para el dueño"]);
      await other.execute(sql`insert into customers (name) values ('Escrito por el dueño')`);
    } finally {
      await other.execute(sql`reset role`);
    }
  });

  test("the owner sees the rows of the login security tables that the Data API role will not", async () => {
    for (const name of LOGIN_SECURITY_TABLES) {
      const result = await db.execute(sql`select count(*)::int as total from ${sql.identifier(name)}`);

      expect(Number(rowsOf(result)[0].total), name).toBeGreaterThanOrEqual(1);
    }
  });

  test("a role of the Data API reads no row of any table", async () => {
    for (const table of schemaTables()) {
      const name = getTableName(table);
      const result = await asApiRole(() =>
        db.execute(sql`select count(*)::int as total from ${sql.identifier(name)}`),
      );

      expect(Number(rowsOf(result)[0].total), name).toBe(0);
    }
  });

  test("a role of the Data API cannot write either", async () => {
    // Drizzle envuelve el error de Postgres: el motivo está en `cause`.
    const insertError = await asApiRole(() =>
      db.execute(sql`insert into customers (name) values ('Intruso')`),
    ).then(
      () => null,
      (error: { message: string; cause?: { message?: string } }) =>
        `${error.message} ${error.cause?.message ?? ""}`,
    );
    expect(insertError).toMatch(/row-level security/i);

    const updated = await asApiRole(() =>
      db.execute(sql`update customers set name = 'Cambiado' returning id`),
    );
    expect(rowsOf(updated)).toHaveLength(0);

    const deleted = await asApiRole(() => db.execute(sql`delete from customers returning id`));
    expect(rowsOf(deleted)).toHaveLength(0);
  });
});
