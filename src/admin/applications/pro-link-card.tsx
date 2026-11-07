"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_INVITE_LANGUAGE, INVITE_LANGUAGES } from "@/admin/customers/invite-languages";
import { formatMoment } from "@/admin/dates";
import { Field } from "@/admin/ui/field";
import { Notice } from "@/admin/ui/notice";
import { useHydrated } from "@/admin/ui/use-hydrated";
import { createProLinkAction } from "@/app/admin/aplicaciones/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { Locale } from "@/i18n/routing";

/** El monto que viene escrito: lo que vale la Temporada Pro por equipo. */
const DEFAULT_DOLLARS = "2500";

const ERRORS = {
  "not-found": "No encontramos esa aplicación. Puede que la hayan borrado: volvé a la lista.",
  "invalid-amount": "Escribí los dólares con números enteros, por ejemplo 2500.",
  "invalid-language": "Elegí uno de los idiomas de la lista.",
} as const;
const UNAVAILABLE_MESSAGE = "No pudimos completarlo. Probá de nuevo en unos minutos.";
const COPY_FAILED_MESSAGE = "No pudimos copiarlo. Seleccioná el link y copialo a mano.";

interface ShownLink {
  url: string;
  expiresAt: Date;
  dollars: string;
}

function LinkBox({ link }: { link: ShownLink }) {
  const hydrated = useHydrated();
  const field = useRef<HTMLInputElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    field.current?.focus();
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link.url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div data-testid="pro-link" className="mt-4 flex flex-col gap-3 border-2 border-ink bg-paper px-4 py-4">
      <Field
        id="pro-link-url"
        label={`Link de pago por USD ${link.dollars}`}
        hint={`Vence el ${formatMoment(link.expiresAt)}. Se usa una sola vez y se ve una sola vez: si lo perdés, generá otro.`}
      >
        {(control) => (
          <Input
            {...control}
            ref={field}
            readOnly
            value={link.url}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono text-[0.875rem]"
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={!hydrated} onClick={() => void copy()}>
          Copiar link
        </Button>
        <span role="status" className="text-[0.9375rem] font-bold text-ink-2">
          {copyState === "copied" ? "Link copiado." : copyState === "failed" ? COPY_FAILED_MESSAGE : ""}
        </span>
      </div>
    </div>
  );
}

/**
 * "Generar link de pago" de la ficha: el monto en dólares (2.500 por defecto) y el idioma en que abre. El
 * link se ve una sola vez, acá; al generarlo se refresca la ficha para que aparezca en la lista.
 */
export function ProLinkCard({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [dollars, setDollars] = useState(DEFAULT_DOLLARS);
  const [language, setLanguage] = useState<Locale>(DEFAULT_INVITE_LANGUAGE);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<ShownLink | null>(null);

  async function generate() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await createProLinkAction(applicationId, dollars, language);
      if (result.ok) {
        setLink({ url: result.url, expiresAt: new Date(result.expiresAt), dollars: dollars.trim() });
        router.refresh();
      } else {
        setLink(null);
        setMessage(ERRORS[result.error]);
      }
    } catch {
      setMessage(UNAVAILABLE_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="pro-link-heading" className="mb-6 border-2 border-ink border-l-[6px] border-l-zone bg-white px-5 py-4">
      <h2 id="pro-link-heading" className="text-[1.25rem] leading-tight font-extrabold [font-stretch:75%]">
        Generar link de pago
      </h2>
      <p className="mt-2 text-[0.9375rem] leading-snug text-ink-2">
        Un link por pago, con el monto que acordaron. Mandáselo por donde hables con el equipo: quien lo abre entra con
        Discord o Google y paga. Cada link se usa una vez y vence a los 14 días; los anteriores siguen valiendo.
      </p>
      <div className="mt-3 flex flex-wrap items-start gap-4">
        <Field id="pro-link-dollars" label="Monto en dólares" hint="Números enteros." className="w-40">
          {(control) => (
            <Input {...control} inputMode="numeric" value={dollars} disabled={busy} onChange={(event) => setDollars(event.target.value)} />
          )}
        </Field>
        <Field id="pro-link-language" label="Idioma del link" className="w-44">
          {(control) => (
            <NativeSelect {...control} value={language} disabled={busy} onChange={(event) => setLanguage(event.target.value as Locale)}>
              {INVITE_LANGUAGES.map(({ value, label }) => (
                <NativeSelectOption key={value} value={value}>
                  {label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      {link ? <LinkBox key={link.url} link={link} /> : null}
      {message ? (
        <Notice tone="error" className="mt-4">
          {message}
        </Notice>
      ) : null}
      <div className="mt-4">
        <Button type="button" size="sm" variant={link ? "ink-outline" : "gold"} disabled={!hydrated || busy} onClick={() => void generate()}>
          {busy ? "Generando…" : link ? "Generar otro link" : "Generar link"}
        </Button>
      </div>
    </section>
  );
}
