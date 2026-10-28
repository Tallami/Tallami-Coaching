// La cuenta del alumno que hizo el pedido. Cada página, acción y ruta del portal
// pregunta acá antes de devolver nada; sin cuenta, no devuelve nada.
//
//   const student = await getCurrentStudent();
//   if (!student) return <SignIn />;
//
// Lee la cookie `tallami_alumno` y verifica en la base que la sesión exista, no esté
// cerrada y no haya vencido (`sessions.ts`).

import { cache } from "react";
import { cookies } from "next/headers";
import { getDb } from "../db/client";
import { getAccount, type PortalAccount } from "./accounts";
import { PORTAL_COOKIE, readPortalSession } from "./sessions";

/**
 * La cuenta de la sesión del pedido, o `null` si no hay cookie o la sesión no vale
 * (falsa, cerrada, vencida). Si la base no responde, tira: no poder verificar no es
 * lo mismo que no haber ingresado.
 *
 * La cookie se lee primero de todo: con `cacheComponents` el build prerenderiza cada
 * página hasta que toca un dato del pedido. Sin cookie ni siquiera se abre la base.
 *
 * Envuelta en `cache()` de React: los que piden la cuenta en el mismo render
 * comparten una sola consulta. (Fuera de un render de React, por ejemplo en una
 * ruta, simplemente corre de nuevo.)
 */
export const getCurrentStudent = cache(async (): Promise<PortalAccount | null> => {
  const token = (await cookies()).get(PORTAL_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const session = await readPortalSession(db, token);
  if (!session) return null;
  return getAccount(db, session.accountId);
});
