"use client";

import { useActionState } from "react";
import { submitReplayCodesAction, type ReplayFormState } from "@/app/[locale]/portal/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** Los textos ya traducidos: el cliente no carga el catálogo de mensajes. */
export interface ReplayFormLabels {
  label: string;
  submit: string;
  submitting: string;
  saved: string;
  corrected: string;
  invalid: string;
  closed: string;
  notFound: string;
  failed: string;
}

interface ReplayCodesFormProps {
  saleId: string;
  /** Los códigos que ya mandó, para corregirlos. */
  initialCodes?: string;
  maxLength: number;
  labels: ReplayFormLabels;
}

const IDLE: ReplayFormState = { outcome: "idle" };

function messageFor(state: ReplayFormState, labels: ReplayFormLabels): { text: string; isError: boolean } | null {
  switch (state.outcome) {
    case "saved":
      return { text: labels.saved, isError: false };
    case "corrected":
      return { text: labels.corrected, isError: false };
    case "invalid":
      return { text: labels.invalid, isError: true };
    case "closed":
      return { text: labels.closed, isError: true };
    case "not-found":
      return { text: labels.notFound, isError: true };
    case "failed":
      return { text: labels.failed, isError: true };
    default:
      return null;
  }
}

/** Pegar o corregir los códigos de replay de una compra. */
export function ReplayCodesForm({ saleId, initialCodes = "", maxLength, labels }: ReplayCodesFormProps) {
  const [state, action, pending] = useActionState(submitReplayCodesAction, IDLE);
  const message = messageFor(state, labels);
  const fieldId = `codes-${saleId}`;

  return (
    <form action={action} className="flex flex-col items-start gap-3">
      <input type="hidden" name="saleId" value={saleId} />
      <label htmlFor={fieldId} className="text-[.95rem] font-bold">
        {labels.label}
      </label>
      <Textarea
        id={fieldId}
        name="codes"
        required
        maxLength={maxLength}
        defaultValue={initialCodes}
        rows={4}
        spellCheck={false}
        autoComplete="off"
        className="w-full font-mono"
      />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? labels.submitting : labels.submit}
      </Button>
      {message ? (
        <p role={message.isError ? "alert" : "status"} className={message.isError ? "m-0 text-danger-ink" : "m-0 text-ok-ink"}>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
