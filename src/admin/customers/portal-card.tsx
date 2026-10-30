"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { DEFAULT_INVITE_LANGUAGE, INVITE_LANGUAGES } from "@/admin/customers/invite-languages";
import { formatMoment } from "@/admin/dates";
import { Field } from "@/admin/ui/field";
import { Notice } from "@/admin/ui/notice";
import { useHydrated } from "@/admin/ui/use-hydrated";
import {
  createPortalInviteAction,
  deletePortalAccountAction,
  unlinkPortalAccountAction,
  type PortalAccountChangeResult,
} from "@/app/admin/alumnos/[id]/portal-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { Locale } from "@/i18n/routing";
import type { PortalProvider } from "@/portal/config";
import { PORTAL_INVITE_MS } from "@/portal/policy";

/** Lo único que el panel muestra de la cuenta vinculada: con qué ingresa y cómo se llama. */
export interface PortalCardAccount {
  provider: PortalProvider;
  displayName: string;
}

interface PortalCardProps {
  customerId: string;
  /** La cuenta vinculada a este alumno, o `null` si todavía no tiene. */
  account: PortalCardAccount | null;
  /** ¿Está el portal listo para abrir (`isPortalConfigured`)? Si no, un link de invitación no va a funcionar. */
  portalConfigured: boolean;
}

interface ShownInvite {
  url: string;
  expiresAt: Date;
  /** El idioma en que abre el link. */
  locale: Locale;
}

/** Los dos cambios que piden confirmación. */
type Change = "unlink" | "delete";

/** De dónde es la cuenta, para decir "cuenta de Discord" ("cuenta de prueba" es la del proveedor falso de los tests). */
const PROVIDER_NAMES: Record<PortalProvider, string> = {
  discord: "Discord",
  google: "Google",
  test: "prueba",
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** Cuánto dura la invitación, en días enteros, para decirlo en pantalla: sale de la política, no de una copia del número. */
const INVITE_DAYS = Math.round(PORTAL_INVITE_MS / DAY_MS);

const NOT_CONFIGURED_MESSAGE =
  "El portal todavía no está configurado: el link no va a funcionar hasta que cargues las variables.";
const UNAVAILABLE_MESSAGE = "No pudimos completarlo. Probá de nuevo en unos minutos.";
const NOT_FOUND_MESSAGE = "No encontramos a ese alumno. Puede que lo hayan borrado: volvé a la lista de alumnos.";
const ALREADY_LINKED_MESSAGE =
  "Este alumno ya tiene una cuenta vinculada. Si querés invitar a otra, desvinculá primero esta.";
const INVALID_LANGUAGE_MESSAGE = "Elegí uno de los idiomas de la lista.";
const COPY_FAILED_MESSAGE = "No pudimos copiarlo. Seleccioná el link y copialo a mano.";
const MESSAGE_ID = "portal-card-message";
const QUESTION_ID = "portal-card-question";

/** Qué se pregunta, qué dicen los botones, qué se avisa al terminar y qué acción corre cada cambio. */
const CHANGES: Record<
  Change,
  {
    question: (account: string) => string;
    yes: string;
    no: string;
    done: string;
    run: (customerId: string) => Promise<PortalAccountChangeResult>;
  }
> = {
  unlink: {
    question: (account) =>
      `¿Desvincular la ${account}? Se cierran sus sesiones y deja de ver las compras de este alumno. La cuenta sigue existiendo y podés invitarlo de nuevo.`,
    yes: "Sí, desvincular",
    no: "No, dejarla vinculada",
    done: "Cuenta desvinculada. Se cerraron sus sesiones.",
    run: unlinkPortalAccountAction,
  },
  delete: {
    question: (account) =>
      `¿Borrar la ${account} del portal? Se borran la cuenta y sus sesiones. Las ventas y las entregas siguen en el panel.`,
    yes: "Sí, borrar la cuenta",
    no: "No, conservarla",
    done: "Cuenta borrada del portal.",
    run: deletePortalAccountAction,
  },
};

/** El idioma de `locale` escrito en ese idioma ("Português"). */
function languageName(locale: Locale): string {
  return INVITE_LANGUAGES.find(({ value }) => value === locale)?.label ?? locale;
}

/**
 * El link de la invitación, a la vista una sola vez, con su vencimiento y el botón para copiarlo.
 * Al aparecer se lleva el foco al campo del link: quien usa un lector de pantalla oye de qué se
 * trata (y su vencimiento) en el acto, y quien usa el teclado queda a un Tab del botón de copiar.
 */
function InviteLink({ invite }: { invite: ShownInvite }) {
  const hydrated = useHydrated();
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
  }, []);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div data-testid="portal-invite" className="mt-4 flex flex-col gap-3 border-2 border-ink bg-paper px-4 py-4">
      <Field
        id="portal-invite-url"
        label="Link de invitación"
        hint={`Link en ${languageName(invite.locale)}. Vence el ${formatMoment(invite.expiresAt)}. Se ve una sola vez: si lo perdés, generá otro.`}
      >
        {(control) => (
          <Input
            {...control}
            ref={field}
            readOnly
            value={invite.url}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono text-[0.875rem]"
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" disabled={!hydrated} onClick={() => void copyLink()}>
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
 * El aviso de que el cambio se hizo. Los botones que lo pidieron ya no están (la cuenta se fue),
 * así que el foco se lleva al aviso: es lo que hace que se lea.
 */
function DoneNotice({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    box.current?.focus();
  }, []);

  return (
    <div ref={box} tabIndex={-1} className="mt-4 outline-offset-0">
      <Notice tone="ok">{children}</Notice>
    </div>
  );
}

interface ConfirmChangeProps {
  change: Change;
  /** La cuenta como se nombra en la pregunta ("cuenta de Discord «Ana»"). */
  accountName: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * La pregunta antes de desvincular o borrar. Se abre con el foco en la opción segura ("No"), y
 * los dos botones la tienen como descripción: se lee junto con cada uno.
 */
function ConfirmChange({ change, accountName, busy, onConfirm, onCancel }: ConfirmChangeProps) {
  const keepButton = useRef<HTMLButtonElement>(null);
  const text = CHANGES[change];

  useEffect(() => {
    keepButton.current?.focus();
  }, []);

  return (
    <div className="mt-4 flex flex-col gap-3">
      <Notice tone="info" id={QUESTION_ID}>
        {text.question(accountName)}
      </Notice>
      <div className="flex flex-wrap gap-3">
        <Button type="button" size="sm" disabled={busy} aria-describedby={QUESTION_ID} onClick={onConfirm}>
          {busy ? "Un momento…" : text.yes}
        </Button>
        <Button
          ref={keepButton}
          type="button"
          size="sm"
          variant="ink-outline"
          disabled={busy}
          aria-describedby={QUESTION_ID}
          onClick={onCancel}
        >
          {text.no}
        </Button>
      </div>
    </div>
  );
}

/** Lo que cuenta la tarjeta cuando la invitación no se pudo generar. */
const INVITE_ERRORS = {
  "not-found": NOT_FOUND_MESSAGE,
  "already-linked": ALREADY_LINKED_MESSAGE,
  "invalid-language": INVALID_LANGUAGE_MESSAGE,
} as const;

/**
 * La tarjeta "Portal del alumno" de la ficha: si el alumno ya tiene una cuenta vinculada (con
 * qué proveedor y qué nombre) y los botones para invitarlo, desvincularla o borrarla. El
 * link de la invitación se ve una sola vez, acá, en el idioma que se elija: en la base queda
 * solo su hash. Desvincular y borrar piden confirmación, con la opción segura enfocada. Con el portal
 * sin configurar (`portalConfigured` falso) la invitación se genera igual, pero la tarjeta avisa que
 * el link no va a funcionar todavía.
 */
export function PortalCard({ customerId, account, portalConfigured }: PortalCardProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [invite, setInvite] = useState<ShownInvite | null>(null);
  const [language, setLanguage] = useState<Locale>(DEFAULT_INVITE_LANGUAGE);
  const [confirming, setConfirming] = useState<Change | null>(null);
  const [done, setDone] = useState<Change | null>(null);
  const triggers = useRef<Record<Change, HTMLButtonElement | null>>({ unlink: null, delete: null });
  const previousConfirming = useRef<Change | null>(null);

  // Al cerrar la pregunta sin cambiar nada, el foco vuelve al botón que la abrió (al abrirla, lo lleva
  // la propia pregunta; al terminar el cambio, el aviso).
  useEffect(() => {
    if (confirming === null && previousConfirming.current !== null && done === null) {
      triggers.current[previousConfirming.current]?.focus();
    }
    previousConfirming.current = confirming;
  }, [confirming, done]);

  // Si mientras tanto el alumno se vinculó (abrió el link en otro lado), el link ya no tiene sentido.
  const shownInvite = account ? null : invite;

  /** Corre la tarea de un botón; la tarea devuelve el aviso de error a mostrar, o `null` si salió bien. */
  async function perform(task: () => Promise<string | null>) {
    setBusy(true);
    setMessage(null);
    setDone(null);
    try {
      setMessage(await task());
    } catch {
      setMessage(UNAVAILABLE_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  function generateInvite() {
    void perform(async () => {
      const result = await createPortalInviteAction(customerId, language);
      if (result.ok) {
        setInvite({ url: result.url, expiresAt: new Date(result.expiresAt), locale: language });
        return null;
      }
      setInvite(null);
      router.refresh();
      return INVITE_ERRORS[result.error];
    });
  }

  function confirmChange(change: Change) {
    void perform(async () => {
      const result = await CHANGES[change].run(customerId);
      setConfirming(null);
      router.refresh();
      if (!result.ok) return NOT_FOUND_MESSAGE;
      setDone(change);
      return null;
    });
  }

  function ask(change: Change) {
    setMessage(null);
    setDone(null);
    setConfirming(change);
  }

  const headingId = "portal-card-heading";
  const describedBy = message ? MESSAGE_ID : undefined;
  return (
    <section
      aria-labelledby={headingId}
      className="mb-6 border-2 border-ink border-l-[6px] border-l-zone bg-white px-5 py-4"
    >
      <h2 id={headingId} className="text-[1.25rem] leading-tight font-extrabold [font-stretch:75%]">
        Portal del alumno
      </h2>

      {account ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="ok">Vinculado</Badge>
          <span>
            Cuenta de {PROVIDER_NAMES[account.provider]}: <span className="font-bold break-words">{account.displayName}</span>
          </span>
        </p>
      ) : (
        <>
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant="neutral">Sin vincular</Badge>
            <span>Todavía no tiene una cuenta en el portal.</span>
          </p>
          <p className="mt-2 text-[0.9375rem] leading-snug text-ink-2">
            Generá un link de un solo uso y mandáselo por donde hables con él. Al abrirlo entra con Discord o Google y
            queda vinculado. Vence a los {INVITE_DAYS} días; si generás otro, el anterior deja de valer.
          </p>
          {portalConfigured ? null : (
            <Notice tone="warn" className="mt-3">
              {NOT_CONFIGURED_MESSAGE}
            </Notice>
          )}
          <Field
            id="portal-invite-language"
            label="Idioma del link"
            hint="En qué idioma abre el portal el alumno."
            className="mt-3 max-w-[16rem]"
          >
            {(control) => (
              <NativeSelect
                {...control}
                value={language}
                disabled={busy}
                onChange={(event) => setLanguage(event.target.value as Locale)}
              >
                {INVITE_LANGUAGES.map(({ value, label }) => (
                  <NativeSelectOption key={value} value={value}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
        </>
      )}

      {shownInvite ? <InviteLink key={shownInvite.url} invite={shownInvite} /> : null}

      {done ? <DoneNotice key={done}>{CHANGES[done].done}</DoneNotice> : null}

      {message ? (
        <Notice tone="error" id={MESSAGE_ID} className="mt-4">
          {message}
        </Notice>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-3">
        {account ? (
          <>
            <Button
              ref={(element) => {
                triggers.current.unlink = element;
              }}
              type="button"
              size="sm"
              variant="ink-outline"
              disabled={!hydrated || busy || confirming !== null}
              aria-describedby={describedBy}
              onClick={() => ask("unlink")}
            >
              Desvincular
            </Button>
            <Button
              ref={(element) => {
                triggers.current.delete = element;
              }}
              type="button"
              size="sm"
              variant="ink-outline"
              disabled={!hydrated || busy || confirming !== null}
              aria-describedby={describedBy}
              onClick={() => ask("delete")}
            >
              Borrar cuenta del portal
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant={shownInvite ? "ink-outline" : "gold"}
            disabled={!hydrated || busy}
            aria-describedby={describedBy}
            onClick={generateInvite}
          >
            {busy ? "Generando…" : shownInvite ? "Generar otro link" : "Invitar al portal"}
          </Button>
        )}
      </div>

      {account && confirming ? (
        <ConfirmChange
          change={confirming}
          accountName={`cuenta de ${PROVIDER_NAMES[account.provider]} «${account.displayName}»`}
          busy={busy}
          onConfirm={() => confirmChange(confirming)}
          onCancel={() => setConfirming(null)}
        />
      ) : null}
    </section>
  );
}
