"use client";

import { clearStoredDrafts } from "@/admin/ui/draft-store";
import { Notice } from "@/admin/ui/notice";
import { useHydrated } from "@/admin/ui/use-hydrated";
import { closeAllSessionsAction } from "@/app/admin/configuracion/seguridad/actions";
import { Button } from "@/components/ui/button";
import { useSecurityAction } from "./use-security-action";

interface CloseAllSessionsProps {
  /** El origen configurado de las llaves (para el aviso de "otra dirección"). */
  origin: string;
}

const MESSAGE_ID = "close-all-message";

/**
 * "Cerrar todas las sesiones": cierra las de todos los dispositivos, la de este
 * incluida, y lleva al login. Las llaves no se tocan: se vuelve a entrar con
 * contraseña y llave. Pide confirmar con la llave si hace más de 5 minutos que no se confirma.
 */
export function CloseAllSessions({ origin }: CloseAllSessionsProps) {
  const hydrated = useHydrated();
  const { router, busy, message, confirmed, perform } = useSecurityAction(origin);

  function closeAll() {
    void perform(async () => {
      const result = await confirmed(() => closeAllSessionsAction());
      // Cerrar todo a propósito también borra lo que quedó guardado en la pestaña (borradores de formularios).
      clearStoredDrafts();
      router.replace(result.redirectTo);
      return null;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[0.9375rem] leading-snug text-ink-2">
        Cierra la sesión de todos tus dispositivos, también la de este. Tus llaves siguen registradas: volvés a
        entrar con la contraseña y una llave.
      </p>
      {message ? (
        <Notice tone="error" id={MESSAGE_ID}>
          {message}
        </Notice>
      ) : null}
      <div>
        <Button
          type="button"
          variant="ink-outline"
          disabled={!hydrated || busy}
          onClick={closeAll}
          aria-describedby={message ? MESSAGE_ID : undefined}
        >
          {busy ? "Cerrando…" : "Cerrar todas las sesiones"}
        </Button>
      </div>
    </div>
  );
}
