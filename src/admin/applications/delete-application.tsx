"use client";

import { useState } from "react";
import { Notice } from "@/admin/ui/notice";
import { useHydrated } from "@/admin/ui/use-hydrated";
import { deleteApplicationAction } from "@/app/admin/aplicaciones/actions";
import { Button } from "@/components/ui/button";

/** Borrar la aplicación: pide confirmación con la opción segura enfocada. Las ventas no se borran. */
export function DeleteApplication({ applicationId }: { applicationId: string }) {
  const hydrated = useHydrated();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!asking) {
    return (
      <Button type="button" size="sm" variant="ink-outline" disabled={!hydrated} onClick={() => setAsking(true)}>
        Borrar aplicación
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <Notice tone="info" id="delete-application-question">
        ¿Borrar esta aplicación? Se borran sus datos y sus links de pago, y no se puede deshacer. Las ventas que ya se cobraron siguen en el panel.
      </Notice>
      <div className="flex flex-wrap gap-3">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          aria-describedby="delete-application-question"
          onClick={() => {
            setBusy(true);
            void deleteApplicationAction(applicationId);
          }}
        >
          {busy ? "Borrando…" : "Sí, borrarla"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ink-outline"
          autoFocus
          disabled={busy}
          aria-describedby="delete-application-question"
          onClick={() => setAsking(false)}
        >
          No, conservarla
        </Button>
      </div>
    </div>
  );
}
