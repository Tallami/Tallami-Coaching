// Guarda de `npm run db:migrate` (la usa `drizzle.config.ts`). Sin
// `DATABASE_URL`, drizzle-kit falla con un mensaje en inglés que no dice qué
// variable falta; acá se frena antes, en español y nombrándola. Los demás
// comandos (`generate`, `check`, …) solo leen el schema y no necesitan la base.
//
// No importa nada del proyecto: lo carga drizzle-kit al leer su configuración,
// y ahí no existe el alias `@/`.

const MIGRATE_COMMAND = "migrate";

export const MIGRATE_WITHOUT_DATABASE_URL_MESSAGE =
  "Falta DATABASE_URL. `npm run db:migrate` aplica las migraciones a la base de Supabase y necesita la variable de entorno DATABASE_URL con su URL de conexión. Definila en esta terminal y volvé a correr el comando.";

/**
 * Tira un error en español si el comando que corre drizzle-kit es `migrate` y
 * `DATABASE_URL` falta o está vacía. `argv` es `process.argv`; el comando es el
 * primer argumento que no es una opción (después del ejecutable y del script),
 * así `generate --name migrate` no se confunde con `migrate`.
 */
export function assertDatabaseUrlForMigrate(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): void {
  const command = argv.slice(2).find((argument) => !argument.startsWith("-"));
  const isMigrate = command === MIGRATE_COMMAND;
  if (isMigrate && !env.DATABASE_URL?.trim()) {
    throw new Error(MIGRATE_WITHOUT_DATABASE_URL_MESSAGE);
  }
}
