"use client";

import { useState } from "react";
import { Notice } from "@/admin/ui/notice";
import { useHydrated } from "@/admin/ui/use-hydrated";
import { deleteConversationAction, type DeleteConversationResult } from "@/app/admin/mensajes/actions";
import { Button } from "@/components/ui/button";

/**
 * Borrar la conversación entera: pide confirmación con la opción segura enfocada. Si se borró, la acción
 * lleva a la bandeja; si no (la base no contestó, o el pedido no llegó), lo dice y se puede probar de nuevo.
 */
export function DeleteConversation({ customerId, studentName }: { customerId: string; studentName: string }) {
  const hydrated = useHydrated();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const questionId = `delete-conversation-${customerId}`;

  async function confirmDelete() {
    setBusy(true);
    setFailed(false);
    // Si se borró, la redirección se lleva la página y esto no sigue (o sigue sin resultado).
    const result: DeleteConversationResult | undefined = await deleteConversationAction(customerId).catch(() => ({ ok: false }) as const);
    if (result?.ok === false) {
      setFailed(true);
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <Button type="button" size="sm" variant="ink-outline" disabled={!hydrated} onClick={() => setAsking(true)}>
        Borrar la conversación
        <span className="sr-only"> con {studentName}</span>
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="info" id={questionId}>
        ¿Borrar la conversación con {studentName}? Se borran todos sus mensajes, los de los dos, y no se puede deshacer.
      </Notice>
      {failed ? <Notice tone="error">No se pudo borrar la conversación. Probá de nuevo.</Notice> : null}
      <div className="flex flex-wrap gap-3">
        <Button type="button" size="sm" disabled={busy} aria-describedby={questionId} onClick={() => void confirmDelete()}>
          {busy ? "Borrando…" : "Sí, borrarla"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ink-outline"
          autoFocus
          disabled={busy}
          aria-describedby={questionId}
          onClick={() => {
            setFailed(false);
            setAsking(false);
          }}
        >
          No, conservarla
        </Button>
      </div>
    </div>
  );
}
