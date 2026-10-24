"use client";

import { useEffect } from "react";
import { getDraftStorage, markRecovery } from "@/admin/ui/draft-store";

/**
 * Se pone en el login cuando se llegó por una sesión que terminó (`?error=vencida`): deja en el
 * navegador la «marca de recuperación», que es lo que le dice al formulario que se estaba
 * enviando que, al volver a entrar, tiene que recuperar lo que se había escrito. No muestra nada.
 */
export function RecoveryClaim(): null {
  useEffect(() => {
    const storage = getDraftStorage();
    if (storage) markRecovery(storage, Date.now());
  }, []);
  return null;
}
