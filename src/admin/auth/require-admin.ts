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

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMissingConfig } from "./config";
import { LOGIN_PATH, SETUP_PATH } from "./redirect";
import { ADMIN_COOKIE, verifySessionToken } from "./session";

/**
 * La cookie de sesión, leída primero de todo. Con `cacheComponents` el build
 * prerenderiza cada página hasta que toca un dato del pedido: si el
 * `redirect` de abajo corriera antes de leer la cookie, el build dejaría
 * guardada la redirección (con las variables de entorno del build) y la
 * página serviría esa redirección para siempre, con sesión o sin ella.
 */
async function readSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(ADMIN_COOKIE)?.value;
}

/** ¿El pedido trae una sesión válida? Sin redirigir: para el login, que decide qué mostrar. */
export async function hasAdminSession(): Promise<boolean> {
  return verifySessionToken(await readSessionToken());
}

/**
 * Deja pasar solo con sesión válida. Si el panel no está configurado va a
 * `/admin/setup`; si no hay sesión (o está vencida o es falsa), a
 * `/admin/login`. `redirect` interrumpe el render o la acción: nada de lo que
 * sigue a esta llamada corre.
 */
export async function requireAdmin(): Promise<void> {
  const token = await readSessionToken();
  if (getMissingConfig().length > 0) redirect(SETUP_PATH);
  if (!(await verifySessionToken(token))) redirect(LOGIN_PATH);
}
