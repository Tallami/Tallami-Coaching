"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { submitSiteRequestAction, type RequestFormState } from "@/app/[locale]/(forms)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Los textos ya traducidos: los componentes de cliente no reciben el catálogo. */
export interface RequestFormLabels {
  label: string;
  name: string;
  email: string;
  emailHint: string;
  orderReference: string;
  orderReferenceHint: string;
  message: string;
  optional: string;
  trap: string;
  summary: string;
  submit: string;
  submitting: string;
  required: string;
  invalid: string;
  /** Con `{max}` donde va el largo. */
  tooLong: string;
  limited: string;
  failed: string;
  sentTitle: string;
  sentBody: string | null;
  codeLabel: string;
  saveCode: string;
  home: string;
}

const INITIAL: RequestFormState = { status: "idle", fieldErrors: {}, values: {} };
const LIMITS = { name: 200, email: 254, orderReference: 200, message: 2000 } as const;
type LimitedField = keyof typeof LIMITS;

function SubmitButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="mt-2 w-full sm:w-auto">
      {pending ? pendingLabel : label}
    </Button>
  );
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
}

function Field({ id, label, hint, error, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-describedby": [errorId, hintId].filter(Boolean).join(" ") || undefined,
        "aria-invalid": error ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-[.9rem] leading-snug text-ink-2">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="font-bold text-danger-ink">
          {error}
        </p>
      ) : null}
    </div>
  );
}

const ALERT_CLASS = "border-l-4 border-danger bg-danger-tint px-4 py-3 font-semibold text-danger-ink";

/**
 * El formulario de arrepentimiento, baja y contacto. Funciona sin JavaScript: es un formulario con una
 * acción del servidor, y el resultado vuelve en la misma página. El campo `website` es la trampa para bots.
 */
export function RequestForm({
  kind,
  locale,
  labels,
  homeHref,
}: {
  kind: "withdrawal" | "cancellation" | "contact";
  locale: string;
  labels: RequestFormLabels;
  homeHref: string;
}) {
  const [state, formAction] = useActionState(submitSiteRequestAction, INITIAL);
  const isContact = kind === "contact";

  if (state.status === "sent") {
    return (
      <section aria-labelledby="request-sent-title" className="stage rounded-[4px] p-[clamp(24px,4vw,36px)]">
        <h2 id="request-sent-title" tabIndex={-1} className="text-[clamp(1.6rem,3.5vw,2.25rem)] font-extrabold font-stretch-72% leading-none">
          {labels.sentTitle}
        </h2>
        {labels.sentBody ? <p className="mt-3 text-on-stage-2">{labels.sentBody}</p> : null}
        <p className="mt-5 text-on-stage-2">{labels.codeLabel}</p>
        <p data-testid="request-code" className="mt-1 mb-3 text-[clamp(1.75rem,5vw,2.5rem)] font-extrabold tracking-[.06em] text-gold">
          {state.code}
        </p>
        <p role="status" className="mb-6 text-on-stage-2">
          {labels.saveCode}
        </p>
        <Button asChild>
          <Link href={homeHref}>{labels.home}</Link>
        </Button>
      </section>
    );
  }

  const errorOf = (field: LimitedField): string | undefined => {
    const code = state.fieldErrors[field];
    if (!code) return undefined;
    if (code === "too-long") return labels.tooLong.replace("{max}", String(LIMITS[field]));
    return code === "invalid" ? labels.invalid : labels.required;
  };
  const banner = state.status === "limited" ? labels.limited : state.status === "failed" ? labels.failed : null;
  const value = (field: LimitedField) => state.values[field] ?? "";

  return (
    <form action={formAction} aria-label={labels.label} className="flex flex-col gap-6">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="kind" value={kind} />
      {state.status === "invalid" ? (
        <p role="alert" className={ALERT_CLASS}>
          {labels.summary}
        </p>
      ) : null}
      {banner ? (
        <p role="alert" className={ALERT_CLASS}>
          {banner}
        </p>
      ) : null}
      <Field id="request-name" label={labels.name} error={errorOf("name")}>
        {(control) => <Input {...control} name="name" required maxLength={LIMITS.name} autoComplete="name" defaultValue={value("name")} />}
      </Field>
      <Field id="request-email" label={labels.email} hint={labels.emailHint} error={errorOf("email")}>
        {(control) => <Input {...control} name="email" type="email" required maxLength={LIMITS.email} autoComplete="email" defaultValue={value("email")} />}
      </Field>
      {isContact ? null : (
        <Field id="request-order" label={`${labels.orderReference} ${labels.optional}`} hint={labels.orderReferenceHint} error={errorOf("orderReference")}>
          {(control) => <Input {...control} name="orderReference" maxLength={LIMITS.orderReference} autoComplete="off" defaultValue={value("orderReference")} />}
        </Field>
      )}
      <Field id="request-message" label={isContact ? labels.message : `${labels.message} ${labels.optional}`} error={errorOf("message")}>
        {(control) => <Textarea {...control} name="message" required={isContact} maxLength={LIMITS.message} rows={5} defaultValue={value("message")} />}
      </Field>
      {/* La trampa: fuera de la vista y de la tabulación. Una persona no la llena. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          {labels.trap}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <SubmitButton label={labels.submit} pendingLabel={labels.submitting} />
    </form>
  );
}
