import { RATE_SOURCE_LABELS, needsOwnRate } from "@/admin/catalog";
import { formatDay } from "@/admin/dates";
import type { SaleRow } from "@/admin/sales/repository";
import { formatMoney, formatRate } from "@/lib/money";

interface SavedValuesProps {
  sale: SaleRow;
}

/** "BCRA (oficial), cotización del 09/10/2026" o "cargado a mano": de dónde salió el tipo de cambio. */
function rateOrigin(sale: SaleRow): string {
  const source = RATE_SOURCE_LABELS[sale.rateSource];
  return sale.rateQuotedOn ? `${source}, cotización del ${formatDay(sale.rateQuotedOn)}` : source;
}

/**
 * Lo que quedó guardado de la venta al convertirla: cuánto es en pesos y en
 * dólares y con qué tipo de cambio. Se recalcula al guardar si cambia la
 * moneda, el monto o el día de cobro.
 */
export function SavedValues({ sale }: SavedValuesProps) {
  const headingId = "saved-values-heading";
  return (
    <section
      aria-labelledby={headingId}
      className="mb-6 border-2 border-ink border-l-[6px] border-l-zone bg-white px-5 py-4"
    >
      <h2 id={headingId} className="text-[1.25rem] leading-tight font-extrabold [font-stretch:75%]">
        Valores guardados
      </h2>
      <dl className="mt-3 grid grid-cols-[repeat(3,minmax(0,auto))] justify-start gap-x-10 gap-y-3 narrow:grid-cols-1">
        <div>
          <dt className="text-[0.875rem] text-ink-2">Cobrado</dt>
          <dd className="text-[1.125rem] font-bold tabular-nums">
            {formatMoney(sale.amountMinor, sale.currency)}
          </dd>
        </div>
        <div>
          <dt className="text-[0.875rem] text-ink-2">En pesos</dt>
          <dd className="text-[1.125rem] font-bold tabular-nums">
            {formatMoney(sale.amountArsMinor, "ARS")}
          </dd>
        </div>
        <div>
          <dt className="text-[0.875rem] text-ink-2">En dólares</dt>
          <dd className="text-[1.125rem] font-bold tabular-nums">
            {formatMoney(sale.amountUsdMinor, "USD")}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[0.9375rem] text-ink-2">
        {needsOwnRate(sale.currency) ? `${sale.currency} a $ ${formatRate(sale.arsPerUnit)}. ` : null}
        Dólar a $ {formatRate(sale.arsPerUsd)}. Fuente: {rateOrigin(sale)}.
      </p>
    </section>
  );
}
