"use client";

import type { PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { LoginCodeRedeemed, LoginStepFailure, LoginStepSuccess } from "@/admin/auth/login-errors";
import { Field } from "@/admin/ui/field";
import { Notice } from "@/admin/ui/notice";
import { useHydrated } from "@/admin/ui/use-hydrated";
import { FirstPasskey } from "@/components/admin/first-passkey";
import { UNAVAILABLE_MESSAGE } from "@/components/admin/login-ceremony";
import { LoginCard } from "@/components/admin/login-card";
import { originMismatchMessage } from "@/components/admin/webauthn-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Lo que cada pantalla del código le pide al servidor (las acciones de `login/llave/code-actions.ts`). */
export interface EnrollmentCodeActions {
  redeem: (code: string) => Promise<LoginCodeRedeemed | LoginStepFailure>;
  begin: () => Promise<{ ok: true; options: PublicKeyCredentialCreationOptionsJSON } | LoginStepFailure>;
  finish: (response: unknown, name: string) => Promise<LoginStepSuccess | LoginStepFailure>;
}

interface EnrollmentCodeStepProps extends EnrollmentCodeActions {
  /** `enter`: escribir el código. `register`: el código ya se canjeó y falta la llave de este dispositivo. */
  initialPhase: "enter" | "register";
  /** El origen configurado de las llaves (para el aviso de "otra dirección"). */
  origin: string;
  /** El nombre propuesto para la llave: el navegador y el sistema de este dispositivo ("Chrome en Windows"). */
  defaultName: string;
  /** El login de nuevo, con el destino guardado: "Volver a empezar". */
  restartHref: string;
  /** El login con el aviso "Tu ingreso venció". */
  expiredHref: string;
  /** El login con el aviso de demasiados intentos. */
  blockedHref: string;
  /** Volver a pedir la llave en lugar del código. Solo antes de canjearlo: después el ingreso ya no es de llave. */
  onBack?: () => void;
}

const WRONG_CODE_MESSAGE = "El código no es correcto o ya venció. Revisalo y probá de nuevo, o generá otro.";
const MESSAGE_ID = "enrollment-code-step-message";

/**
 * El camino de "Tengo un código", después de la contraseña: escribir el código que se
 * generó en Configuración → Seguridad desde un dispositivo donde ya se entró y, si
 * sirve, registrar la llave de este dispositivo (`FirstPasskey`, con otros textos).
 * Un código incorrecto cuenta como intento fallido, igual que una llave inválida.
 */
export function EnrollmentCodeStep({
  initialPhase,
  redeem,
  begin,
  finish,
  origin,
  defaultName,
  restartHref,
  expiredHref,
  blockedHref,
  onBack,
}: EnrollmentCodeStepProps) {
  const [phase, setPhase] = useState(initialPhase);

  if (phase === "register") {
    return (
      <FirstPasskey
        begin={begin}
        finish={finish}
        origin={origin}
        defaultName={defaultName}
        restartHref={restartHref}
        expiredHref={expiredHref}
        blockedHref={blockedHref}
        subtitle="Registrá la llave de este dispositivo."
        intro="El código sirvió. Registrá la llave de este dispositivo: desde ahora entrás con la contraseña y esta llave."
        submitLabel="Registrar la llave de este dispositivo"
      />
    );
  }
  return (
    <CodeEntry
      redeem={redeem}
      origin={origin}
      restartHref={restartHref}
      expiredHref={expiredHref}
      blockedHref={blockedHref}
      onRedeemed={() => setPhase("register")}
      onBack={onBack}
    />
  );
}

interface CodeEntryProps {
  redeem: EnrollmentCodeActions["redeem"];
  /** El origen configurado de las llaves: en otra dirección el código no se canjea (se gastaría y la llave no se podría registrar). */
  origin: string;
  restartHref: string;
  expiredHref: string;
  blockedHref: string;
  onRedeemed: () => void;
  onBack?: () => void;
}

/** El campo del código. Lo escrito se borra al canjearlo: el código no queda en pantalla ni en el estado. */
function CodeEntry({ redeem, origin, restartHref, expiredHref, blockedHref, onRedeemed, onBack }: CodeEntryProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [code, setCode] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function redeemTypedCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const typed = code.trim();
    if (!typed) {
      setFieldError("Escribí el código.");
      return;
    }
    setFieldError(undefined);
    // Canjearlo en otra dirección gastaría el código y el ingreso (la cookie no viaja entre dominios) sin poder registrar la llave.
    const mismatch = originMismatchMessage(origin);
    if (mismatch !== null) {
      setMessage(mismatch);
      return;
    }
    setMessage(null);
    setBusy(true);
    try {
      const result = await redeem(typed);
      if (result.ok) {
        setCode("");
        onRedeemed();
        return;
      }
      if (result.error === "failed") setMessage(WRONG_CODE_MESSAGE);
      else router.replace(result.error === "blocked" ? blockedHref : expiredHref);
    } catch {
      setMessage(UNAVAILABLE_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <LoginCard subtitle="Sumá este dispositivo con un código.">
      <form onSubmit={redeemTypedCode} noValidate className="mt-8 flex flex-col gap-5">
        <p>
          Escribí el código que generaste en Configuración → Seguridad desde un dispositivo donde ya entraste.
          Después registrás la llave de este dispositivo.
        </p>
        <Field id="enrollment-code" label="Código" hint="Diez letras y números, con o sin guion." error={fieldError}>
          {(control) => (
            <Input
              {...control}
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              disabled={busy}
              className="font-mono uppercase tracking-widest"
            />
          )}
        </Field>
        {message ? (
          <Notice tone="error" id={MESSAGE_ID}>
            {message}
          </Notice>
        ) : null}
        <noscript>
          <Notice tone="info">Activá JavaScript para usar el código.</Notice>
        </noscript>
        <Button type="submit" disabled={!hydrated || busy} aria-describedby={message ? MESSAGE_ID : undefined}>
          {busy ? "Verificando…" : "Continuar"}
        </Button>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              disabled={busy}
              className="cursor-pointer font-bold text-zone underline underline-offset-4"
            >
              Mejor uso mi llave
            </button>
          ) : null}
          <Link href={restartHref} className="font-bold text-zone underline underline-offset-4">
            Volver a empezar
          </Link>
        </div>
      </form>
    </LoginCard>
  );
}
