// Guarda de `npm run db:migrate` (la usa `drizzle.config.ts`). Sin
// `DATABASE_URL`, drizzle-kit falla con un mensaje en inglés que no dice qué
// variable falta; acá se frena antes, en español y nombrándola. Los demás
// comandos (`generate`, `check`, …) solo leen el schema y no necesitan la base.
//
// No importa nada del proyecto: lo carga drizzle-kit al leer su configuración,
// y ahí no existe el alias `@/`.

const MIGRATE_COMMAND = "migrate";

/**
 * Las opciones de drizzle-kit que llevan un valor y que se conocen. Escritas con
 * espacio (`--name algo`) el valor es el argumento que sigue, y no es un comando;
 * con `=` (`--name=algo`) ya viene adentro. Es lo que deja ponerle `migrate` de
 * nombre a una migración (`generate --name migrate`).
 *
 * Es una lista de excepciones y no la de lo que cuenta: una opción que no esté
 * acá (una de una versión nueva de drizzle-kit) deja su valor entre los
 * argumentos sueltos y, si dice `migrate`, la guarda se activa. Falla del lado
 * seguro: a lo sumo pide `DATABASE_URL` de más, nunca se saltea la verificación.
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

/** Los argumentos sueltos: lo que no es una opción ni el valor de una opción conocida. */
function looseArguments(args: readonly string[]): string[] {
  const loose: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("-")) {
      loose.push(argument);
      continue;
    }
    const takesNextArgument = !argument.includes("=") && OPTIONS_WITH_VALUE.has(argument.replace(/^-+/, ""));
    if (takesNextArgument) index += 1;
  }
  return loose;
}

export const MIGRATE_WITHOUT_DATABASE_URL_MESSAGE =
  "Falta DATABASE_URL. `npm run db:migrate` aplica las migraciones a la base de Supabase y necesita la variable de entorno DATABASE_URL con su URL de conexión. Definila en esta terminal y volvé a correr el comando.";

/**
 * Tira un error en español si drizzle-kit va a correr `migrate` y `DATABASE_URL`
 * falta o está vacía. `argv` es `process.argv`. Cuenta como `migrate` cualquier
 * argumento suelto (después del ejecutable y del script) que sea `migrate`, salvo
 * el valor de una opción conocida: `generate --name migrate` es una migración que
 * se llama así, y `--config archivo.ts migrate` o `--opcion-nueva valor migrate`
 * son el comando.
 */
export function assertDatabaseUrlForMigrate(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): void {
  const isMigrate = looseArguments(argv.slice(2)).includes(MIGRATE_COMMAND);
  if (isMigrate && !env.DATABASE_URL?.trim()) {
    throw new Error(MIGRATE_WITHOUT_DATABASE_URL_MESSAGE);
  }
}
