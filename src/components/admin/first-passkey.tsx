"use client";

import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { LoginStepFailure, LoginStepSuccess } from "@/admin/auth/login-errors";
import { PASSKEY_NAME_MAX_LENGTH } from "@/admin/auth/policy";
import { Field } from "@/admin/ui/field";
import { Notice } from "@/admin/ui/notice";
import { useHydrated } from "@/admin/ui/use-hydrated";
import { LoginCard } from "@/components/admin/login-card";
import { useLoginCeremony } from "@/components/admin/use-login-ceremony";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface FirstPasskeyProps {
  begin: () => Promise<{ ok: true; options: PublicKeyCredentialCreationOptionsJSON } | LoginStepFailure>;
  finish: (response: unknown, name: string) => Promise<LoginStepSuccess | LoginStepFailure>;
  /** El origen configurado de las llaves (para el aviso de "otra dirección"). */
  origin: string;
  /** El nombre propuesto: el navegador y el sistema de este dispositivo ("Chrome en Windows"). */
  defaultName: string;
  /** El login de nuevo, con el destino guardado: "Volver a empezar". */
  restartHref: string;
  /** El login con el aviso "Tu ingreso venció". */
  expiredHref: string;
  /** El login con el aviso de demasiados intentos. */
  blockedHref: string;
  /** La línea bajo el título. Por defecto, la de la primera llave. */
  subtitle?: string;
  /** El texto de arriba del formulario. Por defecto, el de la primera llave. */
  intro?: string;
  /** Lo que dice el botón. Por defecto, "Registrar mi llave". */
  submitLabel?: string;
}

const DEFAULT_SUBTITLE = "Registrá tu primera llave.";
const DEFAULT_INTRO =
  "Desde ahora el panel pide, además de la contraseña, una llave de acceso: la huella, la cara o el PIN de un dispositivo tuyo. Todavía no hay ninguna: registrá la de este dispositivo.";
const DEFAULT_SUBMIT_LABEL = "Registrar mi llave";
const FAILED_MESSAGE = "No pudimos registrar la llave. Probá de nuevo.";
const MESSAGE_ID = "first-passkey-message";

/**
 * El segundo paso cuando todavía no hay ninguna llave: registrar la de este
 * dispositivo, con un nombre para reconocerla después. Hasta registrarla, el panel
 * no muestra nada. También es la pantalla de registrar la llave de un dispositivo
 * nuevo después de canjear un código (`EnrollmentCodeStep`), con otros textos.
 */
export function FirstPasskey({
  begin,
  finish,
  origin,
  defaultName,
  restartHref,
  expiredHref,
  blockedHref,
  subtitle = DEFAULT_SUBTITLE,
  intro = DEFAULT_INTRO,
  submitLabel = DEFAULT_SUBMIT_LABEL,
}: FirstPasskeyProps) {
  const hydrated = useHydrated();
  const [name, setName] = useState(defaultName);
  const [nameError, setNameError] = useState<string | undefined>();
  const { busy, message, run } = useLoginCeremony<PublicKeyCredentialCreationOptionsJSON>({
    origin,
    expiredHref,
    blockedHref,
    failedMessage: FAILED_MESSAGE,
  });

  function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosenName = name.trim();
    // Antes de crear la llave en el dispositivo: si el nombre no sirve, el servidor no la guardaría.
    if (!chosenName) {
      setNameError("Escribí un nombre para la llave.");
      return;
    }
    setNameError(undefined);
    void run({
      begin,
      ask: (optionsJSON) => startRegistration({ optionsJSON }),
      finish: (response) => finish(response, chosenName),
    });
  }

  return (
    <LoginCard subtitle={subtitle}>
      <form onSubmit={register} className="mt-8 flex flex-col gap-5">
        <p>{intro}</p>
        <Field
          id="passkey-name"
          label="Nombre de la llave"
          hint="Para reconocerla después, por ejemplo Celular, PC o Notebook."
          error={nameError}
        >
          {(control) => (
            <Input
              {...control}
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={PASSKEY_NAME_MAX_LENGTH}
              autoComplete="off"
              disabled={busy}
            />
          )}
        </Field>
        {message ? (
          <Notice tone="error" id={MESSAGE_ID}>
            {message}
          </Notice>
        ) : null}
        <noscript>
          <Notice tone="info">Activá JavaScript para registrar tu llave.</Notice>
        </noscript>
        <Button type="submit" disabled={!hydrated || busy} aria-describedby={message ? MESSAGE_ID : undefined}>
          {busy ? "Esperando tu dispositivo…" : submitLabel}
        </Button>
        <p className="text-[0.9375rem] leading-snug text-ink-2">
          En una PC con Windows, activá antes el PIN de Windows Hello: es la llave de esa PC.
        </p>
        <Link href={restartHref} className="self-start font-bold text-zone underline underline-offset-4">
          Volver a empezar
        </Link>
      </form>
    </LoginCard>
  );
}
