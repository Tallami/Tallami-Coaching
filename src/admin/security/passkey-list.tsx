"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { PASSKEY_NAME_MAX_LENGTH } from "@/admin/auth/policy";
import { Field } from "@/admin/ui/field";
import { Notice } from "@/admin/ui/notice";
import { useHydrated } from "@/admin/ui/use-hydrated";
import { deletePasskeyAction, renamePasskeyAction } from "@/app/admin/configuracion/seguridad/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { INVALID_NAME_MESSAGE, LAST_KEY_MESSAGE, MISSING_KEY_MESSAGE } from "./messages";
import { useSecurityAction } from "./use-security-action";

/** Una llave tal como se muestra: las fechas ya vienen escritas en hora de Argentina. */
export interface PasskeyRow {
  id: string;
  name: string;
  createdAt: string;
  /** Cuándo se usó por última vez, o `null` si todavía no se usó para ingresar o confirmar. */
  lastUsedAt: string | null;
}

interface PasskeyListProps {
  passkeys: PasskeyRow[];
  /** El origen configurado de las llaves (para el aviso de "otra dirección"). */
  origin: string;
}

type Mode = "view" | "renaming" | "confirming-delete";

/** Las llaves registradas, cada una con "Renombrar" y "Borrar". */
export function PasskeyList({ passkeys, origin }: PasskeyListProps) {
  return (
    <ul className="flex flex-col">
      {passkeys.map((passkey) => (
        <PasskeyItem key={passkey.id} passkey={passkey} origin={origin} />
      ))}
    </ul>
  );
}

function PasskeyItem({ passkey, origin }: { passkey: PasskeyRow; origin: string }) {
  const hydrated = useHydrated();
  const { router, busy, message, setMessage, confirmed, perform } = useSecurityAction(origin);
  const [mode, setMode] = useState<Mode>("view");
  const [name, setName] = useState(passkey.name);
  const nameInput = useRef<HTMLInputElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const previousMode = useRef<Mode>("view");

  // El foco acompaña al cambio: al campo del nombre, al "No" de borrar (la opción segura), y de
  // vuelta al botón que abrió cada cosa.
  useEffect(() => {
    if (mode === "renaming") nameInput.current?.focus();
    else if (mode === "confirming-delete") keepButton.current?.focus();
    else if (previousMode.current === "renaming") renameButton.current?.focus();
    else if (previousMode.current === "confirming-delete") deleteButton.current?.focus();
    previousMode.current = mode;
  }, [mode]);

  function startRenaming() {
    setName(passkey.name);
    setMessage(null);
    setMode("renaming");
  }

  function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosenName = name.trim();
    if (!chosenName) {
      setMessage("Escribí un nombre para la llave.");
      return;
    }
    void perform(async () => {
      const result = await confirmed(() => renamePasskeyAction(passkey.id, chosenName));
      if (result.ok) {
        setMode("view");
        router.refresh();
        return null;
      }
      if (result.error === "invalid-name") return INVALID_NAME_MESSAGE;
      router.refresh();
      return MISSING_KEY_MESSAGE;
    });
  }

  function remove() {
    void perform(async () => {
      const result = await confirmed(() => deletePasskeyAction(passkey.id));
      if (result.ok) {
        // Si era la llave de esta sesión, la sesión también se cerró: hay que volver a entrar.
        if (result.redirectTo) router.replace(result.redirectTo);
        else router.refresh();
        return null;
      }
      setMode("view");
      if (result.error === "last") return LAST_KEY_MESSAGE;
      router.refresh();
      return MISSING_KEY_MESSAGE;
    });
  }

  const nameInputId = `rename-${passkey.id}`;
  const messageId = `passkey-message-${passkey.id}`;
  return (
    <li className="border-b border-rule py-4 first:pt-0 last:border-b-0 last:pb-0">
      {mode === "renaming" ? (
        <form
          onSubmit={rename}
          noValidate
          aria-label={`Renombrar ${passkey.name}`}
          className="flex flex-col gap-3"
        >
          <Field id={nameInputId} label="Nombre de la llave">
            {(control) => (
              <Input
                {...control}
                ref={nameInput}
                name="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={PASSKEY_NAME_MAX_LENGTH}
                autoComplete="off"
                disabled={busy}
                className="max-w-[20rem]"
              />
            )}
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button type="submit" size="sm" disabled={!hydrated || busy}>
              {busy ? "Guardando…" : "Guardar nombre"}
            </Button>
            <Button type="button" size="sm" variant="ink-outline" disabled={busy} onClick={() => setMode("view")}>
              Cancelar
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <p className="font-bold break-words">{passkey.name}</p>
            <p className="text-[0.9375rem] leading-snug text-ink-2">Agregada el {passkey.createdAt}</p>
            <p className="text-[0.9375rem] leading-snug text-ink-2">
              {passkey.lastUsedAt ? `Último uso: ${passkey.lastUsedAt}` : "Todavía no la usaste para ingresar"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              ref={renameButton}
              type="button"
              size="sm"
              variant="ink-outline"
              disabled={!hydrated || busy || mode !== "view"}
              onClick={startRenaming}
            >
              Renombrar<span className="sr-only"> {passkey.name}</span>
            </Button>
            <Button
              ref={deleteButton}
              type="button"
              size="sm"
              variant="ink-outline"
              disabled={!hydrated || busy || mode !== "view"}
              onClick={() => {
                setMessage(null);
                setMode("confirming-delete");
              }}
            >
              Borrar<span className="sr-only"> {passkey.name}</span>
            </Button>
          </div>
        </div>
      )}
      {mode === "confirming-delete" ? (
        <div className="mt-3 flex flex-col gap-3">
          <Notice tone="info">
            ¿Borrar la llave «{passkey.name}»? Las sesiones que se abrieron con ella se cierran en el acto.
          </Notice>
          <div className="flex flex-wrap gap-3">
            <Button type="button" size="sm" disabled={busy} onClick={remove}>
              {busy ? "Borrando…" : "Sí, borrar"}
            </Button>
            <Button
              ref={keepButton}
              type="button"
              size="sm"
              variant="ink-outline"
              disabled={busy}
              onClick={() => setMode("view")}
            >
              No, conservarla
            </Button>
          </div>
        </div>
      ) : null}
      {message ? (
        <Notice tone="error" id={messageId} className="mt-3">
          {message}
        </Notice>
      ) : null}
    </li>
  );
}
