import { defineConfig } from "drizzle-kit";

// `npm run db:generate` solo lee el schema. `npm run db:migrate` aplica las
// migraciones de `drizzle/` a la base de `DATABASE_URL` (Supabase).
const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  ...(url ? { dbCredentials: { url } } : {}),
});
