"use client";

import { useEffect, useState } from "react";
import { dateToArgentinaLocal } from "@/admin/dates";
import { Notice } from "@/admin/ui/notice";
import { useHydrated } from "@/admin/ui/use-hydrated";
import { generateEnrollmentCodeAction } from "@/app/admin/configuracion/seguridad/actions";
import { Button } from "@/components/ui/button";
import { useSecurityAction } from "./use-security-action";

interface EnrollmentCodeProps {
  /** El origen configurado de las llaves (para el aviso de "otra dirección"). */
  origin: string;
}

interface ShownCode {
  /** El código ya escrito en dos mitades ("ABCDE-FGHJK"). */
  code: string;
  expiresAt: Date;
}

const MESSAGE_ID = "enrollment-code-message";

/** La hora a la que vence, en hora de Argentina: "14:40". */
function expiryTime(expiresAt: Date): string {
  return dateToArgentinaLocal(expiresAt).split("T")[1];
}

/**
 * "Código para otro dispositivo": genera un código de un solo uso para registrar la
 * llave de un dispositivo que no puede usar la de otro (la PC sin Bluetooth). Se ve
 * una sola vez, acá, y deja de mostrarse al vencer. Vale mientras la sesión que lo
 * generó siga abierta: por eso el aviso de no cerrarla.
 */
export function EnrollmentCode({ origin }: EnrollmentCodeProps) {
  const hydrated = useHydrated();
  const { busy, message, confirmed, perform } = useSecurityAction(origin);
  const [shown, setShown] = useState<ShownCode | null>(null);
  const [expiredNotice, setExpiredNotice] = useState(false);

  // Al vencer el código se esconde: ya no sirve y no tiene por qué quedar a la vista.
  const expiresAtMs = shown?.expiresAt.getTime();
  useEffect(() => {
    if (expiresAtMs === undefined) return;
    const timer = setTimeout(() => {
      setShown(null);
      setExpiredNotice(true);
    }, Math.max(0, expiresAtMs - Date.now()));
    return () => clearTimeout(timer);
  }, [expiresAtMs]);

  function generate() {
    setExpiredNotice(false);
    void perform(async () => {
      const result = await confirmed(() => generateEnrollmentCodeAction());
      setShown({ code: result.code, expiresAt: new Date(result.expiresAt) });
      return null;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {message ? (
        <Notice tone="error" id={MESSAGE_ID}>
          {message}
        </Notice>
      ) : null}
      {expiredNotice ? <Notice tone="info">El código venció. Generá otro si todavía lo necesitás.</Notice> : null}
      <div aria-live="polite">
        {shown ? (
          <div className="flex flex-col gap-3 border-2 border-ink bg-paper px-5 py-4">
            <p className="text-[0.875rem] font-bold text-ink-2">Tu código</p>
            <p
              data-testid="enrollment-code"
              className="font-mono text-[2rem] leading-none font-extrabold tracking-[0.12em] break-all text-ink narrow:text-[1.625rem]"
            >
              {shown.code}
            </p>
            <p className="text-[0.9375rem] leading-snug font-bold">
              Usalo antes de 10 minutos y no cierres sesión en este dispositivo hasta usarlo.
            </p>
            <p className="text-[0.9375rem] leading-snug text-ink-2">
              Vence a las {expiryTime(shown.expiresAt)}. Es de un solo uso y no vuelve a mostrarse.
            </p>
          </div>
        ) : null}
      </div>
      <div>
        <Button
          type="button"
          variant={shown ? "ink-outline" : "gold"}
          disabled={!hydrated || busy}
          onClick={generate}
          aria-describedby={message ? MESSAGE_ID : undefined}
        >
          {busy ? "Generando…" : shown ? "Generar otro código" : "Generar un código"}
        </Button>
      </div>
    </div>
  );
}
