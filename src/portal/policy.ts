// Los tiempos y los límites del portal del alumno, en un solo lugar. El resto del
// código (sesiones, ingreso con Discord o Google, invitaciones, entregas) los lee
// de acá: cambiar uno es cambiar una línea. El portal es un sistema aparte del
// panel (`src/admin/auth/policy.ts`): ninguno de estos valores se comparte con él.

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** La sesión de un alumno dura 30 días desde el ingreso, se use o no. */
export const PORTAL_SESSION_MS = 30 * DAY_MS;
/** Tiempo para volver de Discord o Google (la cookie de `state` y PKCE); de un solo uso. */
export const PORTAL_OAUTH_FLOW_MS = 10 * MINUTE_MS;
/** Una invitación al portal vence a los 14 días (un solo uso). */
export const PORTAL_INVITE_MS = 14 * DAY_MS;

/** Con quién puede ingresar un alumno. `test` es el proveedor falso de los tests y del desarrollo. */
export const PORTAL_PROVIDERS = ["discord", "google", "test"] as const;

/** Qué se le puede entregar a un alumno: un video de YouTube, un PDF o un link. */
export const DELIVERY_KINDS = ["youtube", "pdf", "link"] as const;
/** Un PDF pesa 4 MB como máximo (Vercel corta los pedidos de más de 4,5 MB). */
export const DELIVERY_PDF_MAX_BYTES = 4 * 1024 * 1024;
/** El título de una entrega tiene de 1 a 120 caracteres. */
export const DELIVERY_TITLE_MAX_LENGTH = 120;
