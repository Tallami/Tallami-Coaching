// Los topes del registro de clics (`record.ts`). Viven aparte, sin tocar la base,
// para que la página Servicios escriba en su nota los mismos números que se
// aplican.

/** Eventos que acepta un visitante por ventana. */
export const INTEREST_MAX_PER_WINDOW = 30;
/**
 * Eventos que acepta el sitio entero por ventana. Es generoso (el tráfico real
 * son unos pocos clics por minuto) y tiene un solo trabajo: que quien rote IPs
 * no pueda escribir sin límite. Se lee con el índice de `created_at`.
 */
export const INTEREST_GLOBAL_MAX_PER_WINDOW = 200;
/**
 * Eventos que acepta el sitio entero por hora. El tope por minuto solo permitiría
 * 12.000 por hora; este corta antes a quien reparte un abuso en muchos minutos.
 * También es holgado: el tráfico real es una fracción de esto.
 */
export const INTEREST_GLOBAL_MAX_PER_HOUR = 2000;
/** Largo de la ventana deslizante: un minuto. */
export const INTEREST_WINDOW_MS = 60_000;
/** Largo de la ventana del tope por hora. */
export const INTEREST_HOUR_MS = 60 * INTEREST_WINDOW_MS;
