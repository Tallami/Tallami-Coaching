// Los mensajes entre el alumno y Tallami: cada valor vive una sola vez, acá. Los lee el esquema de la
// base (restricciones), el dominio (`conversations.ts`) y, más adelante, las páginas.

/** Quién escribe un mensaje: el alumno o Tallami, nadie más. */
export const MESSAGE_SENDERS = ["student", "coach"] as const;
export type MessageSender = (typeof MESSAGE_SENDERS)[number];

/** Un mensaje tiene de 1 a esta cantidad de caracteres (como los cuenta Postgres: puntos de código). */
export const MESSAGE_MAX_LENGTH = 2000;

/** Cuántos mensajes puede mandar el alumno en una hora. Tallami no tiene tope. */
export const STUDENT_MESSAGES_PER_HOUR = 30;

/** El mismo texto del mismo lado dentro de esta ventana se guarda una sola vez. */
export const DUPLICATE_WINDOW_MS = 10_000;

/** Cada cuánto vuelve a pedir los mensajes una pestaña a la vista. */
export const MESSAGES_REFRESH_MS = 20_000;

/** Cuántos caracteres del último mensaje muestra la bandeja de Tallami. */
export const INBOX_SNIPPET_LENGTH = 80;
