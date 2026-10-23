"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { runCeremony, type Ceremony } from "./login-ceremony";

interface LoginCeremonyOptions {
  /** El origen configurado de las llaves, para el aviso de "otra dirección". */
  origin: string;
  /** El login con el aviso "Tu ingreso venció" (y el destino guardado). */
  expiredHref: string;
  /** El login con el aviso de demasiados intentos. */
  blockedHref: string;
  /** Qué decir cuando el servidor no pudo verificar la llave. */
  failedMessage: string;
}

/**
 * El estado de una pantalla del segundo paso: si la ceremonia está en curso
 * (`busy`) y el aviso a mostrar (`message`). `run` la corre y hace lo que toca
 * al terminar: ir al panel, volver al login, o quedarse con el aviso para probar de
 * nuevo. Mientras se va a otra página sigue en `busy`, así no se puede repetir.
 */
export function useLoginCeremony<Options>({ origin, expiredHref, blockedHref, failedMessage }: LoginCeremonyOptions) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run(ceremony: Ceremony<Options>): Promise<void> {
    setBusy(true);
    setMessage(null);
    const outcome = await runCeremony(ceremony, origin);
    switch (outcome.kind) {
      case "done":
        router.push(outcome.redirectTo);
        return;
      case "restart":
        router.replace(outcome.error === "blocked" ? blockedHref : expiredHref);
        return;
      case "failed":
        setMessage(failedMessage);
        break;
      case "message":
        setMessage(outcome.message);
        break;
    }
    setBusy(false);
  }

  return { busy, message, run };
}
