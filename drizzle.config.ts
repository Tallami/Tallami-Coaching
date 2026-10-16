import { defineConfig } from "drizzle-kit";
import { assertDatabaseUrlForMigrate } from "./src/db/migrate-guard";

// `npm run db:generate` solo lee el schema. `npm run db:migrate` aplica las
// migraciones de `drizzle/` a la base de `DATABASE_URL` (Supabase): sin esa
// variable se frena acá, con un mensaje que la nombra.
assertDatabaseUrlForMigrate(process.argv, process.env);

const url = process.env.DATABASE_URL?.trim();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  ...(url ? { dbCredentials: { url } } : {}),
});
