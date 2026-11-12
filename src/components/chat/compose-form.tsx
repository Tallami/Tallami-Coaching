"use client";

import { useActionState, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useHydrated } from "@/admin/ui/use-hydrated";
import type { ChatFormState } from "@/chat/form-state";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Los textos ya traducidos: el cliente no carga el catálogo de mensajes. */
export interface ComposeLabels {
  label: string;
  /** Una línea debajo del cuadro, opcional. */
  hint?: string;
  submit: string;
  submitting: string;
  sent: string;
  invalid: string;
  rateLimited: string;
  signedOut: string;
  failed: string;
  /** Solo en el panel: el alumno no tiene una cuenta vinculada. Sin él, se dice `failed`. */
  noAccount?: string;
  /** Adónde entrar de nuevo cuando la sesión se cerró; se abre en otra pestaña, así lo escrito sigue acá. */
  signIn?: { text: string; href: string; opensInNewTab: string };
}

interface ComposeFormProps {
  action: (previous: ChatFormState, formData: FormData) => Promise<ChatFormState>;
  initialState: ChatFormState;
  labels: ComposeLabels;
  maxLength: number;
}

function noticeFor(state: ChatFormState, labels: ComposeLabels): { text: string; isError: boolean } | null {
  switch (state.outcome) {
    case "sent":
      return { text: labels.sent, isError: false };
    case "invalid":
      return { text: labels.invalid, isError: true };
    case "rate-limited":
      return { text: labels.rateLimited, isError: true };
    case "signed-out":
      return { text: labels.signedOut, isError: true };
    case "no-account":
      return { text: labels.noAccount ?? labels.failed, isError: true };
    case "failed":
      return { text: labels.failed, isError: true };
    case "idle":
      return null;
  }
}

/**
 * Un cuadro de texto y el botón Enviar. Funciona sin JavaScript (la acción del servidor responde con la
 * página); con JavaScript, el mensaje aparece sin recargar.
 *
 * El cuadro es controlado: lo que tiene sale de `draft`, y solo cambia cuando la persona escribe o cuando
 * llega el resultado de un envío (vacío si salió, lo que mandó si no). Por eso el refresco de la página
 * (`AutoRefresh`, que no vuelve a montar este componente) no borra lo que se está escribiendo. Mientras
 * envía, el botón queda ocupado y el cuadro de solo lectura: lo que se escriba en ese momento no se pierde
 * cuando el envío lo vacía. Un segundo clic que llegue igual manda el mismo texto, y el servidor lo toma
 * como repetido.
 */
export function ComposeForm({ action, initialState, labels, maxLength }: ComposeFormProps) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const [draft, setDraft] = useState(state.body);
  const [shown, setShown] = useState(state);
  const hydrated = useHydrated();
  const box = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const isFirstState = useRef(true);
  const fieldId = useId();
  const hintId = useId();
  const noticeId = useId();

  // Llegó el resultado de un envío: el cuadro pasa a tener lo que dice el servidor.
  if (state !== shown) {
    setShown(state);
    setDraft(state.body);
  }

  useEffect(() => {
    if (isFirstState.current) {
      isFirstState.current = false;
      return;
    }
    // Después de enviar, el foco vuelve al cuadro (el botón lo tuvo, y mientras enviaba estuvo deshabilitado).
    if (state.outcome === "sent") box.current?.focus();
  }, [state]);

  useEffect(() => {
    // Al abrir la página, el formulario y lo último de la conversación, que está justo arriba, quedan a la vista.
    formRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  function sendWithKeyboard(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!pending) formRef.current?.requestSubmit();
    }
  }

  const notice = noticeFor(state, labels);
  const describedBy = [labels.hint ? hintId : null, notice?.isError ? noticeId : null].filter(Boolean).join(" ") || undefined;

  return (
    <form ref={formRef} action={formAction} data-hydrated={hydrated} aria-busy={pending} className="flex flex-col gap-2.5">
      <label htmlFor={fieldId} className="text-[.95rem] font-bold">
        {labels.label}
      </label>
      <Textarea
        ref={box}
        id={fieldId}
        name="body"
        required
        maxLength={maxLength}
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={sendWithKeyboard}
        readOnly={pending}
        aria-describedby={describedBy}
        aria-invalid={state.outcome === "invalid" || undefined}
        className="w-full resize-y bg-white"
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {labels.hint ? (
          <p id={hintId} className="m-0 max-w-[52ch] flex-1 basis-60 text-[.85rem] text-ink-2">
            {labels.hint}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="ml-auto min-w-32">
          {pending ? labels.submitting : labels.submit}
        </Button>
      </div>
      {notice?.isError ? (
        <p id={noticeId} role="alert" className="m-0 border-l-4 border-danger bg-danger-tint px-3 py-2 text-danger-ink">
          {notice.text}
          {state.outcome === "signed-out" && labels.signIn ? (
            <>
              {" "}
              <a href={labels.signIn.href} target="_blank" rel="noopener" className="font-bold underline underline-offset-2">
                {labels.signIn.text}
                <span className="sr-only"> {labels.signIn.opensInNewTab}</span>
              </a>
            </>
          ) : null}
        </p>
      ) : (
        <p role="status" className="sr-only">
          {notice?.text ?? ""}
        </p>
      )}
    </form>
  );
}
