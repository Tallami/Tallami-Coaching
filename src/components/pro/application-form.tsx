"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { applyToProAction, type ApplicationFormState } from "@/app/[locale]/temporada-pro/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Los textos ya traducidos: los componentes de cliente no reciben el catálogo. */
export interface ApplicationFormLabels {
  label: string;
  name: string;
  discord: string;
  discordHint: string;
  teamMembers: string;
  teamMembersHint: string;
  results: string;
  resultsHint: string;
  message: string;
  optional: string;
  messageHint: string;
  privacy: string;
  privacyLink: string;
  submit: string;
  submitting: string;
  trap: string;
  summary: string;
  required: string;
  /** Con `{max}` donde va el largo. */
  tooLong: string;
  privacyError: string;
  limited: string;
  failed: string;
  sentTitle: string;
  sentBody: string;
  home: string;
}

const INITIAL: ApplicationFormState = { status: "idle", fieldErrors: {}, values: {} };
const LIMITS = { name: 200, discord: 200, teamMembers: 2000, results: 2000, message: 2000 } as const;

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

interface ApplicationFormProps {
  locale: string;
  labels: ApplicationFormLabels;
  homeHref: string;
  /** La política de privacidad en el idioma de la página: la casilla dice que se acepta. */
  privacyHref: string;
}

/**
 * La aplicación a la Temporada Pro. Funciona sin JavaScript: es un formulario con una acción del
 * servidor, y el estado vuelve en la misma página. El campo `website` es la trampa para bots.
 */
export function ApplicationForm({ locale, labels, homeHref, privacyHref }: ApplicationFormProps) {
  const [state, formAction] = useActionState(applyToProAction, INITIAL);

  if (state.status === "sent") {
    return (
      <section aria-labelledby="pro-sent-title" className="stage rounded-[4px] p-[clamp(24px,4vw,36px)]">
        <h2 id="pro-sent-title" tabIndex={-1} className="text-[clamp(1.6rem,3.5vw,2.25rem)] font-extrabold font-stretch-72% leading-none">
          {labels.sentTitle}
        </h2>
        <p role="status" className="mt-3 mb-6 text-on-stage-2">
          {labels.sentBody}
        </p>
        <Button asChild>
          <Link href={homeHref}>{labels.home}</Link>
        </Button>
      </section>
    );
  }

  const errorOf = (field: keyof typeof LIMITS): string | undefined => {
    const code = state.fieldErrors[field];
    if (!code) return undefined;
    return code === "too-long" ? labels.tooLong.replace("{max}", String(LIMITS[field])) : labels.required;
  };
  const privacyError = state.fieldErrors.privacy ? labels.privacyError : undefined;
  const hasFieldErrors = state.status === "invalid";
  const banner = state.status === "limited" ? labels.limited : state.status === "failed" ? labels.failed : null;
  const value = (field: keyof typeof LIMITS) => state.values[field] ?? "";

  return (
    <form action={formAction} aria-label={labels.label} className="flex flex-col gap-6">
      <input type="hidden" name="locale" value={locale} />
      {hasFieldErrors ? (
        <p role="alert" className="border-l-4 border-danger bg-danger-tint px-4 py-3 font-semibold text-danger-ink">
          {labels.summary}
        </p>
      ) : null}
      {banner ? (
        <p role="alert" className="border-l-4 border-danger bg-danger-tint px-4 py-3 font-semibold text-danger-ink">
          {banner}
        </p>
      ) : null}
      <Field id="pro-name" label={labels.name} error={errorOf("name")}>
        {(control) => <Input {...control} name="name" required maxLength={LIMITS.name} autoComplete="name" defaultValue={value("name")} />}
      </Field>
      <Field id="pro-discord" label={labels.discord} hint={labels.discordHint} error={errorOf("discord")}>
        {(control) => <Input {...control} name="discord" required maxLength={LIMITS.discord} autoComplete="off" defaultValue={value("discord")} />}
      </Field>
      <Field id="pro-team" label={labels.teamMembers} hint={labels.teamMembersHint} error={errorOf("teamMembers")}>
        {(control) => <Textarea {...control} name="teamMembers" required maxLength={LIMITS.teamMembers} rows={4} defaultValue={value("teamMembers")} />}
      </Field>
      <Field id="pro-results" label={labels.results} hint={labels.resultsHint} error={errorOf("results")}>
        {(control) => <Textarea {...control} name="results" required maxLength={LIMITS.results} rows={4} defaultValue={value("results")} />}
      </Field>
      <Field id="pro-message" label={`${labels.message} ${labels.optional}`} hint={labels.messageHint} error={errorOf("message")}>
        {(control) => <Textarea {...control} name="message" maxLength={LIMITS.message} rows={4} defaultValue={value("message")} />}
      </Field>
      {/* La trampa: fuera de la vista y de la tabulación. Una persona no la llena. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          {labels.trap}
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="flex cursor-pointer items-start gap-3 font-semibold">
          <input
            type="checkbox"
            name="privacy"
            value="yes"
            required
            aria-invalid={privacyError ? true : undefined}
            aria-describedby={privacyError ? "pro-privacy-error" : undefined}
            className="mt-0.5 size-6 shrink-0 cursor-pointer accent-gold"
          />
          <span>{labels.privacy}</span>
        </label>
        {/* Fuera de la etiqueta: tocar el link no marca la casilla. */}
        <a href={privacyHref} className="ml-9 self-start py-1 text-[.95rem] font-medium underline underline-offset-4 hover:text-zone">
          {labels.privacyLink}
        </a>
        {privacyError ? (
          <p id="pro-privacy-error" className="font-bold text-danger-ink">
            {privacyError}
          </p>
        ) : null}
      </div>
      <SubmitButton label={labels.submit} pendingLabel={labels.submitting} />
    </form>
  );
}
