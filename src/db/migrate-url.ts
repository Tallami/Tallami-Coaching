// La URL con la que `npm run db:migrate` se conecta a Supabase (la usa
// `drizzle.config.ts`). El panel cifra su conexión desde `REMOTE_DB_OPTIONS`
// (`client.ts`), pero drizzle-kit se conecta aparte, y con una `url` no admite la
// opción `ssl` (solo la admite si se le dan host, usuario y demás por separado):
// el cifrado tiene que ir adentro de la propia URL. Sin esto, postgres.js
// conectaría sin cifrar si la cadena no trae `sslmode`, y la contraseña de la
// base y el esquema irían en claro.
//
// No importa nada del proyecto: lo carga drizzle-kit al leer su configuración,
// y ahí no existe el alias `@/`.

/** Los modos que, además de cifrar, verifican el certificado: no se tocan. */
const VERIFYING_MODES: ReadonlySet<string> = new Set(["verify-ca", "verify-full"]);

/** Cómo se escribe el modo en la URL; postgres.js lee las dos (`sslmode` pisa a `ssl`). */
const SSL_PARAMS = ["sslmode", "ssl"] as const;

const REQUIRE = "require";

/**
 * La misma URL con `sslmode=require`. Si ya pide `verify-ca` o `verify-full` se
 * respeta (es más estricto); cualquier otra cosa (`disable`, `allow`, `prefer`,
 * `ssl=false`, un valor desconocido) pasa a `require`. El resto de la URL, el
 * usuario y la contraseña incluidos, queda exactamente como estaba.
 */
export function withEncryptedConnection(url: string): string {
  const queryStart = url.indexOf("?");
  const base = queryStart === -1 ? url : url.slice(0, queryStart);
  const params = new URLSearchParams(queryStart === -1 ? "" : url.slice(queryStart + 1));

  const requested = SSL_PARAMS.map((name) => params.get(name) ?? "");
  const mode = requested.find((value) => VERIFYING_MODES.has(value)) ?? REQUIRE;
  for (const name of SSL_PARAMS) params.delete(name);
  params.set("sslmode", mode);

  return `${base}?${params}`;
}
