"use client";

import { useState } from "react";
import { Notice } from "@/admin/ui/notice";
import { useHydrated } from "@/admin/ui/use-hydrated";
import { deleteConversationAction } from "@/app/admin/mensajes/actions";
import { Button } from "@/components/ui/button";

/** Borrar la conversación entera: pide confirmación con la opción segura enfocada. */
export function DeleteConversation({ customerId, studentName }: { customerId: string; studentName: string }) {
  const hydrated = useHydrated();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const questionId = `delete-conversation-${customerId}`;

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
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          aria-describedby={questionId}
          onClick={() => {
            setBusy(true);
            void deleteConversationAction(customerId);
          }}
        >
          {busy ? "Borrando…" : "Sí, borrarla"}
        </Button>
        <Button type="button" size="sm" variant="ink-outline" autoFocus disabled={busy} aria-describedby={questionId} onClick={() => setAsking(false)}>
          No, conservarla
        </Button>
      </div>
    </div>
  );
}
