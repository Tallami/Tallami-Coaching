"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DeliveryRow } from "@/admin/sales/delivery-rows";
import { Field } from "@/admin/ui/field";
import { Notice } from "@/admin/ui/notice";
import { useHydrated } from "@/admin/ui/use-hydrated";
import {
  addDeliveryAction,
  deleteDeliveryAction,
  type AddDeliveryActionResult,
} from "@/app/admin/ventas/[id]/delivery-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { DELIVERY_KINDS, DELIVERY_PDF_MAX_BYTES, DELIVERY_TITLE_MAX_LENGTH } from "@/portal/policy";

type DeliveryKind = (typeof DELIVERY_KINDS)[number];
type FieldName = "title" | "url" | "file";

/** Qué salió mal al agregar y en qué campo: `field` es `null` si no es de un campo. */
interface Problem {
  field: FieldName | null;
  message: string;
}

interface DeliveriesCardProps {
  saleId: string;
  /** Las entregas de la venta, en el orden en que se cargaron. */
  deliveries: DeliveryRow[];
}

/** Cómo se llama cada tipo en el desplegable y en la insignia de la lista. */
const KIND_OPTIONS: Record<DeliveryKind, { option: string; badge: string }> = {
  youtube: { option: "Video de YouTube", badge: "YouTube" },
  pdf: { option: "PDF", badge: "PDF" },
  link: { option: "Link (Google Drive u otro sitio)", badge: "Link" },
};

const PDF_MAX_MB = DELIVERY_PDF_MAX_BYTES / (1024 * 1024);

const TITLE_MESSAGE = `Escribí un título de 1 a ${DELIVERY_TITLE_MAX_LENGTH} caracteres, en una sola línea.`;
const YOUTUBE_URL_MESSAGE =
  "Pegá el link de un video de YouTube (youtube.com/watch, youtu.be, youtube.com/live o youtube.com/shorts).";
const LINK_URL_MESSAGE = "Pegá un link completo que empiece con https://";
const NO_FILE_MESSAGE = "Elegí un archivo PDF.";
const NOT_PDF_MESSAGE = "Ese archivo no es un PDF. Elegí un PDF de verdad: no alcanza con cambiarle el nombre.";
const TOO_LARGE_MESSAGE = `El PDF pesa más de ${PDF_MAX_MB} MB. Subilo a Google Drive y cargalo como link.`;
const SALE_NOT_FOUND_MESSAGE = "No encontramos esa venta. Puede que la hayan borrado: volvé a la lista de ventas.";
const UNAVAILABLE_MESSAGE = "No pudimos completarlo. Probá de nuevo en unos minutos.";
const ALREADY_GONE_MESSAGE = "Esa entrega ya no estaba. Actualizamos la lista.";
const ADDED_MESSAGE = "Entrega agregada. El alumno la ve en su portal.";
const DELETED_MESSAGE = "Entrega borrada.";

/** Lo que se dice cuando el servidor rechaza la entrega. */
function problemFor(error: Extract<AddDeliveryActionResult, { ok: false }>["error"], kind: DeliveryKind): Problem {
  switch (error) {
    case "invalid-title":
      return { field: "title", message: TITLE_MESSAGE };
    case "invalid-url":
      return { field: "url", message: kind === "youtube" ? YOUTUBE_URL_MESSAGE : LINK_URL_MESSAGE };
    case "not-pdf":
      return { field: "file", message: NOT_PDF_MESSAGE };
    case "too-large":
      return { field: "file", message: TOO_LARGE_MESSAGE };
    case "sale-not-found":
      return { field: null, message: SALE_NOT_FOUND_MESSAGE };
    case "invalid-kind":
      return { field: null, message: UNAVAILABLE_MESSAGE };
  }
}

/**
 * Lo que se puede ver sin molestar al servidor: un título vacío, un link vacío, un PDF sin elegir
 * o de más de 4 MB (Vercel corta esos pedidos antes de que lleguen a la acción, y la respuesta
 * sería un error poco claro). El servidor vuelve a comprobar todo, y además los bytes del archivo.
 */
function localProblem(kind: DeliveryKind, title: string, url: string, file: File | null): Problem | null {
  if (title.trim() === "") return { field: "title", message: TITLE_MESSAGE };
  if (kind === "pdf") {
    if (!file || file.size === 0) return { field: "file", message: NO_FILE_MESSAGE };
    if (file.size > DELIVERY_PDF_MAX_BYTES) return { field: "file", message: TOO_LARGE_MESSAGE };
    return null;
  }
  if (url.trim() === "") return { field: "url", message: kind === "youtube" ? YOUTUBE_URL_MESSAGE : LINK_URL_MESSAGE };
  return null;
}

function isDeliveryKind(value: string): value is DeliveryKind {
  return (DELIVERY_KINDS as readonly string[]).includes(value);
}

/**
 * El aviso de que se borró una entrega. El botón que la borró ya no está (la fila se fue),
 * así que el foco se lleva al aviso: es lo que hace que se lea.
 */
function DoneNotice({ children }: { children: string }) {
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

interface DeliveryItemProps {
  delivery: DeliveryRow;
  /** Avisa a la tarjeta que la entrega se borró, para que lo anuncie. */
  onDeleted: () => void;
}

/** Una entrega de la lista, con "Abrir" y "Borrar" (que pregunta antes, con el "No" enfocado). */
function DeliveryItem({ delivery, onDeleted }: DeliveryItemProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);

  // La pregunta se abre con el foco en la opción segura; al cerrarla sin borrar, el foco vuelve al botón que la abrió.
  useEffect(() => {
    if (confirming) keepButton.current?.focus();
    else if (wasConfirming.current) deleteButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  async function remove() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await deleteDeliveryAction(delivery.id);
      router.refresh();
      if (result.ok) {
        onDeleted();
      } else {
        setConfirming(false);
        setMessage(ALREADY_GONE_MESSAGE);
      }
    } catch {
      setConfirming(false);
      setMessage(UNAVAILABLE_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  const questionId = `delivery-question-${delivery.id}`;
  return (
    <li className="border-b border-rule py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant="neutral">{KIND_OPTIONS[delivery.kind].badge}</Badge>
            <span className="font-bold break-words">{delivery.title}</span>
          </p>
          <p className="mt-1 text-[0.9375rem] leading-snug text-ink-2">Cargada el {delivery.createdAt}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="ink-outline">
            <a href={delivery.href} target="_blank" rel="noopener noreferrer">
              Abrir<span className="sr-only"> {delivery.title} (se abre en otra pestaña)</span>
            </a>
          </Button>
          <Button
            ref={deleteButton}
            type="button"
            size="sm"
            variant="ink-outline"
            disabled={!hydrated || busy || confirming}
            onClick={() => {
              setMessage(null);
              setConfirming(true);
            }}
          >
            Borrar<span className="sr-only"> {delivery.title}</span>
          </Button>
        </div>
      </div>
      {confirming ? (
        <div className="mt-3 flex flex-col gap-3">
          <Notice tone="info" id={questionId}>
            ¿Borrar «{delivery.title}»? El alumno deja de verla en su portal
            {delivery.kind === "pdf" ? " y se borra el archivo" : ""}. No se puede deshacer.
          </Notice>
          <div className="flex flex-wrap gap-3">
            <Button type="button" size="sm" disabled={busy} aria-describedby={questionId} onClick={() => void remove()}>
              {busy ? "Borrando…" : "Sí, borrar"}
            </Button>
            <Button
              ref={keepButton}
              type="button"
              size="sm"
              variant="ink-outline"
              disabled={busy}
              aria-describedby={questionId}
              onClick={() => setConfirming(false)}
            >
              No, conservarla
            </Button>
          </div>
        </div>
      ) : null}
      {message ? (
        <Notice tone="error" className="mt-3">
          {message}
        </Notice>
      ) : null}
    </li>
  );
}

/**
 * La tarjeta "Entregas" de la ficha de la venta: lo que Tallami le cargó al alumno por esta
 * compra (video de YouTube, PDF de hasta 4 MB o un link `https://`), el formulario para cargar
 * otra y "Borrar" en cada una, con confirmación. El alumno las ve en su portal. El servidor
 * valida todo de nuevo (el tipo del archivo se reconoce por sus bytes, no por su nombre).
 */
export function DeliveriesCard({ saleId, deliveries }: DeliveriesCardProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [kind, setKind] = useState<DeliveryKind>("youtube");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [added, setAdded] = useState(false);
  const [deleted, setDeleted] = useState(0);
  const titleInput = useRef<HTMLInputElement>(null);
  const urlInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Con un problema en un campo, el foco va a ese campo: es lo que hace que el error se lea.
  useEffect(() => {
    if (!problem?.field) return;
    const inputs = { title: titleInput, url: urlInput, file: fileInput };
    inputs[problem.field].current?.focus();
  }, [problem]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAdded(false);
    setDeleted(0);

    const found = localProblem(kind, title, url, fileInput.current?.files?.[0] ?? null);
    if (found) {
      setProblem(found);
      return;
    }

    // Los datos se leen antes de marcar "ocupado": con los campos deshabilitados no viajarían.
    const data = new FormData(event.currentTarget);
    setProblem(null);
    setBusy(true);
    try {
      const result = await addDeliveryAction(saleId, data);
      if (result.ok) {
        setTitle("");
        setUrl("");
        if (fileInput.current) fileInput.current.value = "";
        setAdded(true);
      } else {
        setProblem(problemFor(result.error, kind));
      }
      router.refresh();
    } catch {
      setProblem({ field: null, message: UNAVAILABLE_MESSAGE });
    } finally {
      setBusy(false);
    }
  }

  const headingId = "deliveries-card-heading";
  const fieldError = (field: FieldName) => (problem?.field === field ? problem.message : undefined);
  return (
    <section
      aria-labelledby={headingId}
      className="mb-6 border-2 border-ink border-l-[6px] border-l-zone bg-white px-5 py-4"
    >
      <h2 id={headingId} className="text-[1.25rem] leading-tight font-extrabold [font-stretch:75%]">
        Entregas
      </h2>
      <p className="mt-2 text-[0.9375rem] leading-snug text-ink-2">
        Lo que cargues acá lo ve el alumno en su portal, dentro de esta compra. Un video de YouTube (mejor no listado),
        un PDF de hasta {PDF_MAX_MB} MB o un link a lo que pase de ese tamaño, como Google Drive.
      </p>

      {deliveries.length > 0 ? (
        <ul className="mt-4 flex flex-col" aria-label="Entregas de esta venta">
          {deliveries.map((delivery) => (
            <DeliveryItem
              key={delivery.id}
              delivery={delivery}
              onDeleted={() => {
                setAdded(false);
                setDeleted((count) => count + 1);
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-4 font-semibold">Todavía no hay entregas en esta venta.</p>
      )}

      {deleted > 0 ? <DoneNotice key={deleted}>{DELETED_MESSAGE}</DoneNotice> : null}

      <form
        onSubmit={(event) => void submit(event)}
        noValidate
        aria-label="Agregar una entrega"
        className="mt-5 flex flex-col gap-4 border-t-2 border-rule pt-5"
      >
        <Field id="delivery-kind" label="Tipo" className="max-w-[20rem]">
          {(control) => (
            <NativeSelect
              {...control}
              name="kind"
              value={kind}
              disabled={busy}
              onChange={(event) => {
                if (isDeliveryKind(event.target.value)) {
                  setKind(event.target.value);
                  setProblem(null);
                }
              }}
            >
              {DELIVERY_KINDS.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {KIND_OPTIONS[value].option}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field
          id="delivery-title"
          label="Título"
          hint="Lo que lee el alumno. Por ejemplo, «Review de tu partida del sábado»."
          error={fieldError("title")}
          className="max-w-[32rem]"
        >
          {(control) => (
            <Input
              {...control}
              ref={titleInput}
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={DELIVERY_TITLE_MAX_LENGTH}
              autoComplete="off"
              disabled={busy}
            />
          )}
        </Field>
        {kind === "pdf" ? (
          <Field
            id="delivery-file"
            label="Archivo PDF"
            hint={`Hasta ${PDF_MAX_MB} MB. Si pesa más, subilo a Google Drive y cargalo como link.`}
            error={fieldError("file")}
            className="max-w-[32rem]"
          >
            {(control) => (
              <Input
                {...control}
                ref={fileInput}
                type="file"
                name="file"
                accept="application/pdf,.pdf"
                disabled={busy}
                className="py-2 file:mr-3 file:border-0 file:bg-transparent file:font-bold file:text-ink"
              />
            )}
          </Field>
        ) : (
          <Field
            id="delivery-url"
            label="Link"
            hint={
              kind === "youtube"
                ? "El link del video, como lo copiás de YouTube."
                : "Tiene que empezar con https://. Si es de Google Drive, compartilo con «cualquiera con el link»."
            }
            error={fieldError("url")}
            className="max-w-[32rem]"
          >
            {(control) => (
              <Input
                {...control}
                ref={urlInput}
                name="url"
                inputMode="url"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://"
                autoComplete="off"
                disabled={busy}
              />
            )}
          </Field>
        )}
        {problem && problem.field === null ? <Notice tone="error">{problem.message}</Notice> : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={!hydrated || busy}>
            {busy ? (kind === "pdf" ? "Subiendo…" : "Guardando…") : "Agregar entrega"}
          </Button>
          <span role="status" className="text-[0.9375rem] font-bold text-ok-ink">
            {added ? ADDED_MESSAGE : ""}
          </span>
        </div>
      </form>
    </section>
  );
}
