"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ReauthRequired } from "./results";
import { ReauthError, withReauth } from "./with-reauth";

const UNAVAILABLE_MESSAGE = "No pudimos completarlo. Probá de nuevo en unos minutos.";

/**
 * El estado de un botón de Configuración → Seguridad que llama al servidor: si está
 * en curso (`busy`) y el aviso a mostrar (`message`). `perform` corre la tarea del
 * botón; la tarea devuelve el aviso de error a mostrar, o `null` si salió bien. Lo
 * que tire (la confirmación con la llave que no salió, el servidor que no contesta)
 * también termina en un aviso en español: nunca queda un botón colgado ni un error sin decir.
 *
 * `confirmed` corre una acción delicada pidiendo la confirmación con la llave si hace
 * falta (`withReauth`); `origin` es el origen configurado de las llaves, para el aviso
 * de "otra dirección".
 */
export function useSecurityAction(origin: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function confirmed<T>(run: () => Promise<T | ReauthRequired>): Promise<T> {
    return withReauth(run, origin);
  }

  async function perform(task: () => Promise<string | null>): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      const problem = await task();
      setMessage(problem);
      return problem === null;
    } catch (error) {
      setMessage(error instanceof ReauthError ? error.message : UNAVAILABLE_MESSAGE);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return { router, busy, message, setMessage, confirmed, perform };
}
