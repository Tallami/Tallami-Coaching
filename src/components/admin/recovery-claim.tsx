"use client";

import { useEffect } from "react";
import { getDraftStorage, markRecovery } from "@/admin/ui/draft-store";

/**
 * Se pone en el login cuando se llegó por una sesión que terminó (`?error=vencida`): deja en el
 * navegador la «marca de recuperación», que es lo que le dice al formulario que se estaba
 * enviando que, al volver a entrar, tiene que recuperar lo que se había escrito. La marca lleva la
 * página a la que se vuelve (`next`): solo recupera el formulario de esa página. No muestra nada.
 */
export function RecoveryClaim({ next }: { next: string }): null {
  useEffect(() => {
    const storage = getDraftStorage();
    if (storage) markRecovery(storage, Date.now(), next);
  }, [next]);
  return null;
}
