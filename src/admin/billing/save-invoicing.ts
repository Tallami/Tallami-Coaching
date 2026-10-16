// Marcar las ventas del formulario de facturación, de punta a punta: leer los
// campos, validar y escribir. Lo usa la acción del servidor; vive acá y no en el
// archivo de acciones para poder probarlo con una base de prueba.

import type { InvoicingFormState } from "@/admin/billing/form-state";
import {
  InvalidInvoiceError,
  InvoiceNotAllowedError,
  markInvoiceNotRequired,
  markInvoiced,
  type InvoiceInput,
} from "@/admin/billing/invoicing";
import type { Db } from "@/db/client";

/** Qué botón se tocó. */
export const INVOICING_INTENTS = ["invoiced", "not_required"] as const;
export type InvoicingIntent = (typeof INVOICING_INTENTS)[number];

export type SaveInvoicingOutcome =
  | { saved: true; intent: InvoicingIntent; updated: number }
  | { saved: false; state: InvoicingFormState };

const CHECK_FIELDS_MESSAGE = "Revisá los campos marcados.";
const UNKNOWN_ACTION_MESSAGE = "No entendimos qué querías hacer. Volvé a intentar.";
const SAVE_FAILED_MESSAGE = "No pudimos marcar las ventas. Probá de nuevo en unos minutos.";

function rejected(state: InvoicingFormState): SaveInvoicingOutcome {
  return { saved: false, state };
}

function isIntent(value: unknown): value is InvoicingIntent {
  return typeof value === "string" && INVOICING_INTENTS.some((intent) => intent === value);
}

/** Un campo de texto del formulario; un archivo o un campo ausente no es texto (la validación lo rechaza). */
function text(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

/**
 * Marca las ventas elegidas (`ids`) como facturadas o como "no requiere
 * factura", según el botón (`intent`). Si algo falla devuelve el estado que el
 * formulario muestra (los errores por campo o el aviso general); nunca marca a
 * medias. Lo inesperado (la base no contesta) se registra en el log y se avisa
 * sin detalles.
 */
export async function saveInvoicing(
  db: Db,
  formData: FormData,
  now: Date = new Date(),
): Promise<SaveInvoicingOutcome> {
  const intent = text(formData, "intent");
  if (!isIntent(intent)) {
    return rejected({ fieldErrors: {}, formError: UNKNOWN_ACTION_MESSAGE });
  }
  // Lo que llega del formulario no es de confiar (un id puede ser un archivo, el
  // tipo cualquier texto): se pasa tal cual y `markInvoiced` lo valida con zod.
  const ids = formData.getAll("ids") as string[];
  const invoice = {
    type: text(formData, "type"),
    number: text(formData, "number"),
    issuedOn: text(formData, "issuedOn"),
  } as unknown as InvoiceInput;

  try {
    const { updated } =
      intent === "invoiced"
        ? await markInvoiced(db, ids, invoice, now)
        : await markInvoiceNotRequired(db, ids, now);
    return { saved: true, intent, updated };
  } catch (error) {
    if (error instanceof InvalidInvoiceError) {
      return rejected({ fieldErrors: error.fieldErrors, formError: CHECK_FIELDS_MESSAGE });
    }
    if (error instanceof InvoiceNotAllowedError) {
      return rejected({ fieldErrors: {}, formError: error.message });
    }
    console.error("Panel: no se pudieron marcar las ventas.", error);
    return rejected({ fieldErrors: {}, formError: SAVE_FAILED_MESSAGE });
  }
}
