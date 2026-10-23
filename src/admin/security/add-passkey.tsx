"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useState, type FormEvent } from "react";
import { PASSKEY_NAME_MAX_LENGTH } from "@/admin/auth/policy";
import { Field } from "@/admin/ui/field";
import { Notice } from "@/admin/ui/notice";
import { useHydrated } from "@/admin/ui/use-hydrated";
import { beginAddPasskeyAction, finishAddPasskeyAction } from "@/app/admin/configuracion/seguridad/actions";
import { describeWebAuthnError } from "@/components/admin/webauthn-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { INVALID_NAME_MESSAGE } from "./messages";
import { useSecurityAction } from "./use-security-action";

interface AddPasskeyProps {
  /** El nombre propuesto: el navegador y el sistema de este dispositivo ("Chrome en Windows"). */
  defaultName: string;
  /** El origen configurado de las llaves (para el aviso de "otra dirección"). */
  origin: string;
}

const ADD_FAILED_MESSAGE = "No pudimos registrar la llave. Probá de nuevo.";
const ADD_EXPIRED_MESSAGE = "Se venció el pedido de la llave. Probá de nuevo.";
const MESSAGE_ID = "add-passkey-message";

/**
 * "Agregar una llave en este dispositivo": el navegador crea una llave nueva (huella,
 * cara o PIN de este dispositivo) y el servidor la guarda con el nombre elegido. Pide
 * confirmar con otra llave si hace más de 5 minutos que no se confirma. Un aviso de
 * error se queda hasta el próximo intento; un éxito se avisa y la lista de arriba se
 * actualiza sola.
 */
export function AddPasskey({ defaultName, origin }: AddPasskeyProps) {
  const hydrated = useHydrated();
  const { router, busy, message, confirmed, perform } = useSecurityAction(origin);
  const [name, setName] = useState(defaultName);
  const [nameError, setNameError] = useState<string | undefined>();
  const [addedName, setAddedName] = useState<string | null>(null);

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const chosenName = name.trim();
    // Antes de crear la llave en el dispositivo: si el nombre no sirve, el servidor no la guardaría.
    if (!chosenName) {
      setNameError("Escribí un nombre para la llave.");
      return;
    }
    setNameError(undefined);
    setAddedName(null);
    void perform(async () => {
      const begun = await confirmed(() => beginAddPasskeyAction());
      if (!begun.ok) return ADD_FAILED_MESSAGE;

      let response: unknown;
      try {
        response = await startRegistration({ optionsJSON: begun.options });
      } catch (error) {
        // Lo que falla en el navegador (Tallami cancela, esta dirección no es la configurada) no llega al servidor.
        return describeWebAuthnError(error, origin);
      }

      const finished = await confirmed(() => finishAddPasskeyAction(response, chosenName));
      if (finished.ok) {
        setAddedName(chosenName);
        setName(defaultName);
        router.refresh();
        return null;
      }
      switch (finished.error) {
        case "invalid-name":
          return INVALID_NAME_MESSAGE;
        case "expired":
          return ADD_EXPIRED_MESSAGE;
        case "failed":
          return ADD_FAILED_MESSAGE;
      }
    });
  }

  return (
    <form onSubmit={add} noValidate className="flex flex-col gap-4">
      <Field
        id="add-passkey-name"
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
            maxLength={PASSKEY_NAME_MAX_LENGTH}
            autoComplete="off"
            disabled={busy}
            className="max-w-[20rem]"
          />
        )}
      </Field>
      {message ? (
        <Notice tone="error" id={MESSAGE_ID}>
          {message}
        </Notice>
      ) : null}
      {addedName ? <Notice tone="ok">Agregaste la llave «{addedName}».</Notice> : null}
      <div>
        <Button type="submit" disabled={!hydrated || busy} aria-describedby={message ? MESSAGE_ID : undefined}>
          {busy ? "Esperando tu dispositivo…" : "Agregar una llave en este dispositivo"}
        </Button>
      </div>
    </form>
  );
}
