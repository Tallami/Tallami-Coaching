// La protección real del panel. Cada página y cada Server Action de `/admin`
// llama a `requireAdmin()` antes de leer o cambiar nada; el `proxy` es solo un
// filtro previo (ver `guard.ts`).
//
//   export default async function Page() {
//     await requireAdmin();
//     …
//   }
//
//   export async function saveSale(formData: FormData) {
//     "use server";
//     await requireAdmin();
//     …
//   }
//
// El `proxy` solo verifica la cookie (firma, vencimiento, contraseña). Acá se
// verifica además en la base que la sesión exista, no esté cerrada y no lleve
// más de 30 minutos sin uso (`sessions.ts`), y cada pedido anota su uso.

import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../../db/client";
import { getMissingConfig } from "./config";
import { SESSION_ENDED_ERROR } from "./login-errors";
import { SETUP_PATH, loginPath } from "./redirect";
import { sameOriginReferer } from "./referer";
import { ADMIN_COOKIE, readSessionClaims } from "./session";
import { validateSession, type AdminSession } from "./sessions";

/**
 * Lo que dice la cookie de sesión, leída primero de todo. Con `cacheComponents`
 * el build prerenderiza cada página hasta que toca un dato del pedido: si el
 * `redirect` de abajo corriera antes de leer la cookie, el build dejaría
 * guardada la redirección (con las variables de entorno del build) y la
 * página serviría esa redirección para siempre, con sesión o sin ella.
 */
async function readCookieClaims(): Promise<{ sessionId: string } | null> {
  return readSessionClaims((await cookies()).get(ADMIN_COOKIE)?.value);
}

/**
 * Al login, avisando que la sesión se cerró y con la página de la que vino el pedido (el `Referer`
 * de un Server Action es la página del formulario) para volver ahí. Se lee recién acá, ya leída la
 * cookie: solo hace falta cuando se va a redirigir.
 */
async function redirectToLogin(): Promise<never> {
  const next = sameOriginReferer(await headers());
  redirect(loginPath({ next, error: SESSION_ENDED_ERROR }));
}

/** ¿El pedido trae una sesión válida? Sin redirigir: para el login, que decide qué mostrar. */
export async function hasAdminSession(): Promise<boolean> {
  const claims = await readCookieClaims();
  if (claims === null) return false;
  try {
    return (await validateSession(await getDb(), claims.sessionId)) !== null;
  } catch (error) {
    // Con la base caída el login igual tiene que mostrarse: ahí se avisa que no se puede ingresar.
    console.error("Panel: no se pudo verificar la sesión.", error);
    return false;
  }
}

/**
 * La sesión del pedido, en la base. Si el panel no está configurado va a
 * `/admin/setup`; si no hay sesión válida (sin cookie, falsa, vencida, cerrada o
 * sin uso por más de 30 minutos), a `/admin/login?error=vencida`, con `next`
 * si se sabe de qué página venía. `redirect` interrumpe el render o la acción:
 * nada de lo que sigue a esta llamada corre. Si la base no responde, tira: sin
 * poder verificar no se deja pasar a nadie.
 *
 * Envuelta en `cache()` de React: `requireAdmin()` y los que piden la sesión en el
 * mismo render comparten una sola consulta. (Fuera de un render de React, por
 * ejemplo en una ruta, simplemente corre de nuevo.)
 */
export const getAdminSession = cache(async (): Promise<AdminSession> => {
  const claims = await readCookieClaims();
  if (getMissingConfig().length > 0) redirect(SETUP_PATH);
  if (claims === null) return redirectToLogin();
  const session = await validateSession(await getDb(), claims.sessionId);
  if (session === null) return redirectToLogin();
  return session;
});

/** Deja pasar solo con sesión válida (ver `getAdminSession`). Primera línea de cada página, acción y ruta del panel. */
export async function requireAdmin(): Promise<void> {
  await getAdminSession();
}
