"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type RefObject } from "react";

interface AutoRefreshProps {
  /** Cada cuánto vuelve a pedir la página (`MESSAGES_REFRESH_MS`). */
  intervalMs: number;
  /** Cuántos mensajes del otro lado hay en la conversación que se está mostrando. */
  incoming: number;
  /** Marca la conversación como leída por quien mira. */
  markRead: () => Promise<void>;
}

function isVisible(): boolean {
  return document.visibilityState === "visible";
}

/**
 * Marca como leído si la pestaña está a la vista y hay más mensajes del otro lado que la última vez
 * (`markedUpTo`, `null` antes de la primera). Si falla (sin red, por ejemplo), la acción ya lo anotó en
 * el servidor: se vuelve a marcar cuando llegue el próximo.
 */
function markIfNew(markedUpTo: RefObject<number | null>, incoming: number, markRead: () => Promise<void>): void {
  if (!isVisible()) return;
  if (markedUpTo.current !== null && incoming <= markedUpTo.current) return;
  markedUpTo.current = incoming;
  markRead().catch(() => {});
}

/**
 * Sin tiempo real: mientras la pestaña está a la vista, pide la página de nuevo cada `intervalMs`
 * (`router.refresh()`, que trae lo del servidor sin volver a montar lo del cliente: el formulario conserva
 * lo que se está escribiendo y el foco). Con la pestaña oculta no pide nada; al volver a la vista, pide
 * enseguida.
 *
 * Marca la conversación como leída cuando la página se abre de verdad en el navegador (nunca en una
 * precarga: esto corre al montarse) y cada vez que llegan mensajes del otro lado con la pestaña a la vista.
 * Si la pestaña estaba oculta, lo hace cuando vuelve. No dibuja nada.
 */
export function AutoRefresh({ intervalMs, incoming, markRead }: AutoRefreshProps) {
  const router = useRouter();
  const markedUpTo = useRef<number | null>(null);
  const latest = useRef({ incoming, markRead });

  useEffect(() => {
    latest.current = { incoming, markRead };
    // Hay menos que los ya marcados: la conversación se borró (y quizás se volvió a escribir). Se cuenta
    // desde lo que hay ahora, así el próximo mensaje que llegue se marca.
    if (markedUpTo.current !== null && incoming < markedUpTo.current) markedUpTo.current = incoming;
    markIfNew(markedUpTo, incoming, markRead);
  }, [incoming, markRead]);

  useEffect(() => {
    function onVisibilityChange() {
      if (!isVisible()) return;
      markIfNew(markedUpTo, latest.current.incoming, latest.current.markRead);
      router.refresh();
    }

    const timer = window.setInterval(() => {
      if (isVisible()) router.refresh();
    }, intervalMs);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router, intervalMs]);

  return null;
}
