// Qué base usa el panel según el entorno. Vive aparte de `client.ts` para que
// el `proxy` y la página de configuración puedan preguntar "¿hay base?" sin
// cargar los drivers de la base.

/** `DATABASE_URL` sin espacios, o `undefined` si falta o está vacía. */
export function getDatabaseUrl(): string | undefined {
  return process.env.DATABASE_URL?.trim() || undefined;
}

/**
 * Hay una base a la que conectarse: la de `DATABASE_URL` o, fuera de Vercel,
 * la local (PGlite). En Vercel sin `DATABASE_URL` no hay base: el disco de
 * Vercel no persiste y la local perdería los datos sin avisar.
 */
export function isDbConfigured(): boolean {
  return Boolean(getDatabaseUrl()) || !process.env.VERCEL;
}
