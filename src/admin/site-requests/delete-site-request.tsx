"use client";

import { useState } from "react";
import { Notice } from "@/admin/ui/notice";
import { useHydrated } from "@/admin/ui/use-hydrated";
import { deleteSiteRequestAction } from "@/app/admin/pedidos/actions";
import { Button } from "@/components/ui/button";

/** Borrar el pedido: pide confirmación con la opción segura enfocada. */
export function DeleteSiteRequest({ requestId, code }: { requestId: string; code: string }) {
  const hydrated = useHydrated();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const questionId = `delete-request-${requestId}`;

  if (!asking) {
    return (
      <Button type="button" size="sm" variant="ink-outline" disabled={!hydrated} onClick={() => setAsking(true)}>
        Borrar
        <span className="sr-only"> el pedido {code}</span>
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="info" id={questionId}>
        ¿Borrar el pedido {code}? No se puede deshacer.
      </Notice>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          aria-describedby={questionId}
          onClick={() => {
            setBusy(true);
            void deleteSiteRequestAction(requestId);
          }}
        >
          {busy ? "Borrando…" : "Sí, borrarlo"}
        </Button>
        <Button type="button" size="sm" variant="ink-outline" autoFocus disabled={busy} aria-describedby={questionId} onClick={() => setAsking(false)}>
          No, conservarlo
        </Button>
      </div>
    </div>
  );
}
