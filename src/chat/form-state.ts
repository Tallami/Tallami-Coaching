// Cómo quedó el último envío del formulario de un mensaje. Lo comparten la acción del alumno
// (`src/app/[locale]/portal/mensajes/actions.ts`), la de Tallami en el panel y el formulario
// (`ComposeForm`). Vive fuera de los archivos `"use server"`, que solo pueden exportar acciones.

/**
 * `sent`: se guardó (o ya estaba: un doble clic). `invalid`: vacío o de más de 2.000 caracteres.
 * `rate-limited`: el alumno pasó su tope de la hora. `signed-out`: no hay sesión, o la cuenta no
 * está vinculada. `no-account`: Tallami le escribe a un alumno sin cuenta vinculada. `failed`: la
 * base no contestó.
 */
export type ChatOutcome = "idle" | "sent" | "invalid" | "rate-limited" | "signed-out" | "failed" | "no-account";

/** `body`: lo que escribió, de vuelta cuando el envío no salió; vacío cuando salió. */
export type ChatFormState = { outcome: ChatOutcome; body: string };

/** El formulario antes del primer envío. */
export const CHAT_IDLE: ChatFormState = { outcome: "idle", body: "" };
