"use client";

import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import Link from "next/link";
import { useEffect, useRef } from "react";
import type { LoginStepFailure, LoginStepSuccess } from "@/admin/auth/login-errors";
import { Notice } from "@/admin/ui/notice";
import { useHydrated } from "@/admin/ui/use-hydrated";
import { LoginCard } from "@/components/admin/login-card";
import { useLoginCeremony } from "@/components/admin/use-login-ceremony";
import { Button } from "@/components/ui/button";

interface PasskeyStepProps {
  begin: () => Promise<{ ok: true; options: PublicKeyCredentialRequestOptionsJSON } | LoginStepFailure>;
  finish: (response: unknown) => Promise<LoginStepSuccess | LoginStepFailure>;
  /** El origen configurado de las llaves (para el aviso de "otra dirección"). */
  origin: string;
  /** El login de nuevo, con el destino guardado: "Volver a empezar". */
  restartHref: string;
  /** El login con el aviso "Tu ingreso venció". */
  expiredHref: string;
  /** El login con el aviso de demasiados intentos. */
  blockedHref: string;
}

const FAILED_MESSAGE = "No pudimos verificar tu llave. Probá de nuevo, o usá tu celular con el código QR.";
const MESSAGE_ID = "passkey-message";

/**
 * El segundo paso del ingreso: confirmar con una llave ya registrada. El navegador
 * pide la llave recién con el clic (nunca solo al abrir la página), así Tallami
 * elige cuándo, y después de un aviso el mismo botón prueba de nuevo.
 */
export function PasskeyStep({ begin, finish, origin, restartHref, expiredHref, blockedHref }: PasskeyStepProps) {
  const hydrated = useHydrated();
  const { busy, message, run } = useLoginCeremony<PublicKeyCredentialRequestOptionsJSON>({
    origin,
    expiredHref,
    blockedHref,
    failedMessage: FAILED_MESSAGE,
  });
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Tras un aviso, el foco vuelve al botón (estuvo desactivado mientras tanto): Enter prueba de nuevo.
  useEffect(() => {
    if (message) buttonRef.current?.focus();
  }, [message]);

  const confirmWithKey = () => run({ begin, ask: (optionsJSON) => startAuthentication({ optionsJSON }), finish });

  return (
    <LoginCard subtitle="Confirmá que sos vos.">
      <div className="mt-8 flex flex-col gap-5">
        <p>Usá tu llave de acceso: la huella, la cara o el PIN de este dispositivo.</p>
        {message ? (
          <Notice tone="error" id={MESSAGE_ID}>
            {message}
          </Notice>
        ) : null}
        <noscript>
          <Notice tone="info">Activá JavaScript para usar tu llave.</Notice>
        </noscript>
        <Button
          ref={buttonRef}
          type="button"
          onClick={confirmWithKey}
          disabled={!hydrated || busy}
          aria-describedby={message ? MESSAGE_ID : undefined}
        >
          {busy ? "Esperando tu llave…" : message ? "Probar de nuevo" : "Usar mi llave"}
        </Button>
        <div className="flex flex-col gap-2 text-[0.9375rem] leading-snug text-ink-2">
          <p>
            ¿Estás en un dispositivo sin tu llave? Cuando el navegador te lo ofrezca, elegí usar tu celular: te
            muestra un código QR para escanear con él.
          </p>
          <p>¿No tenés ninguno de tus dispositivos? Seguí la guía de recuperación del README del proyecto.</p>
        </div>
        <Link href={restartHref} className="self-start font-bold text-zone underline underline-offset-4">
          Volver a empezar
        </Link>
      </div>
    </LoginCard>
  );
}
