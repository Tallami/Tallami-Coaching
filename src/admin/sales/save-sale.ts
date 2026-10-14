// Guardar el formulario de venta, de punta a punta: validar, resolver el tipo
// de cambio y escribir. Lo usan las acciones de alta y de edición; vive acá y no
// en el archivo de acciones para poder probarlo con una base de prueba.

import { RATE_UNAVAILABLE_MESSAGE, type SaleFormState } from "@/admin/sales/form-state";
import { readSaleForm } from "@/admin/sales/form-data";
import { resolveSaleRates } from "@/admin/sales/rates";
import {
  CustomerNotFoundError,
  SaleNotFoundError,
  createSale,
  getSale,
  updateSale,
  type SaleRow,
} from "@/admin/sales/repository";
import { saleFieldErrors, saleInputSchema } from "@/admin/sales/schema";
import type { Db } from "@/db/client";

export type SaveSaleOutcome =
  | { saved: true; id: string }
  | { saved: false; state: SaleFormState };

const CHECK_FIELDS_MESSAGE = "Revisá los campos marcados.";
const SAVE_FAILED_MESSAGE = "No pudimos guardar la venta. Probá de nuevo en unos minutos.";

function rejected(state: Partial<SaleFormState>): SaveSaleOutcome {
  return { saved: false, state: { fieldErrors: {}, needsManualRate: false, ...state } };
}

/**
 * Guarda la venta del formulario: una nueva, o la `saleId` si se está editando.
 * Si algo falla devuelve el estado que el formulario muestra (los errores por
 * campo, o la orden de pedir el tipo de cambio a mano); nunca guarda a medias.
 * Lo inesperado (la base no contesta) se registra en el log y se avisa sin detalles.
 */
export async function saveSale(db: Db, formData: FormData, saleId?: string): Promise<SaveSaleOutcome> {
  const parsed = saleInputSchema.safeParse(readSaleForm(formData));
  if (!parsed.success) {
    return rejected({
      fieldErrors: saleFieldErrors(parsed.error),
      formError: CHECK_FIELDS_MESSAGE,
    });
  }
  const input = parsed.data;

  try {
    let previous: SaleRow | null = null;
    if (saleId) {
      previous = await getSale(db, saleId);
      if (!previous) return rejected({ formError: new SaleNotFoundError().message });
    }

    const resolution = await resolveSaleRates(db, input, previous ? { previous } : {});
    if (!resolution.ok) {
      return rejected({
        fieldErrors: { rateMode: RATE_UNAVAILABLE_MESSAGE },
        needsManualRate: true,
      });
    }

    const { id } = saleId
      ? await updateSale(db, saleId, input, resolution.rates)
      : await createSale(db, input, resolution.rates);
    return { saved: true, id };
  } catch (error) {
    if (error instanceof CustomerNotFoundError) {
      return rejected({ fieldErrors: { customerId: error.message }, formError: CHECK_FIELDS_MESSAGE });
    }
    if (error instanceof SaleNotFoundError) {
      return rejected({ formError: error.message });
    }
    console.error("Panel: no se pudo guardar la venta.", error);
    return rejected({ formError: SAVE_FAILED_MESSAGE });
  }
}
