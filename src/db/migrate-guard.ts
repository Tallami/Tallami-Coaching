// Guarda de `npm run db:migrate` (la usa `drizzle.config.ts`). Sin
// `DATABASE_URL`, drizzle-kit falla con un mensaje en inglés que no dice qué
// variable falta; acá se frena antes, en español y nombrándola. Los demás
// comandos (`generate`, `check`, …) solo leen el schema y no necesitan la base.
//
// No importa nada del proyecto: lo carga drizzle-kit al leer su configuración,
// y ahí no existe el alias `@/`.

const MIGRATE_COMMAND = "migrate";

/**
 * Las opciones de drizzle-kit que llevan un valor. Escritas con espacio
 * (`--config archivo.ts`) el valor es el argumento que sigue y no puede
 * tomarse por el comando; con `=` (`--config=archivo.ts`) ya viene adentro.
 */
const OPTIONS_WITH_VALUE: ReadonlySet<string> = new Set([
  "config",
  "dialect",
  "driver",
  "schema",
  "out",
  "name",
  "prefix",
  "casing",
  "url",
  "host",
  "port",
  "user",
  "password",
  "database",
  "ssl",
  "auth-token",
  "tablesFilter",
  "schemaFilters",
  "extensionsFilters",
  "migrations-table",
  "migrations-schema",
]);

/** El comando: el primer argumento que no es una opción ni el valor de una opción. */
function commandOf(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("-")) return argument;
    const takesNextArgument = !argument.includes("=") && OPTIONS_WITH_VALUE.has(argument.replace(/^-+/, ""));
    if (takesNextArgument) index += 1;
  }
  return undefined;
}

export const MIGRATE_WITHOUT_DATABASE_URL_MESSAGE =
  "Falta DATABASE_URL. `npm run db:migrate` aplica las migraciones a la base de Supabase y necesita la variable de entorno DATABASE_URL con su URL de conexión. Definila en esta terminal y volvé a correr el comando.";

/**
 * Tira un error en español si el comando que corre drizzle-kit es `migrate` y
 * `DATABASE_URL` falta o está vacía. `argv` es `process.argv`; el comando es el
 * primer argumento que no es una opción ni el valor de una (después del
 * ejecutable y del script): `generate --name migrate` no es `migrate`, y
 * `--config archivo.ts migrate` sí lo es.
 */
export function assertDatabaseUrlForMigrate(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): void {
  const isMigrate = commandOf(argv.slice(2)) === MIGRATE_COMMAND;
  if (isMigrate && !env.DATABASE_URL?.trim()) {
    throw new Error(MIGRATE_WITHOUT_DATABASE_URL_MESSAGE);
  }
}
