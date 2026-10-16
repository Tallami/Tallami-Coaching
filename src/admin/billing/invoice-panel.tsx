import Link from "next/link";
import { INCOME_STATUSES, STATUS_LABELS } from "@/admin/catalog";
import { formatDay } from "@/admin/dates";
import type { SaleRow } from "@/admin/sales/repository";
import { InvoiceStatusBadge } from "@/admin/sales/status-badge";
import { SubmitButton } from "@/components/admin/submit-button";

const BILLING_HREF = "/admin/facturacion";

interface InvoicePanelProps {
  sale: Pick<SaleRow, "status" | "paidOn" | "invoiceStatus" | "invoiceType" | "invoiceNumber" | "invoicedOn">;
  /** Devuelve la factura de la venta a pendiente (la acción del servidor, ya con el id de la venta). */
  undoAction: (formData: FormData) => void | Promise<void>;
  /** Hoy en Argentina, "AAAA-MM-DD": una venta con fecha de cobro futura todavía no se puede facturar. */
  today: string;
}

function BillingLink({ children }: { children: string }) {
  return (
    <Link href={BILLING_HREF} prefetch={false} className="font-semibold underline underline-offset-2">
      {children}
    </Link>
  );
}

/** ¿La venta está cobrada o entregada? Solo esas se facturan y solo de esas se puede deshacer la factura. */
function isIncomeStatus(sale: InvoicePanelProps["sale"]): boolean {
  return (INCOME_STATUSES as readonly string[]).includes(sale.status);
}

/** ¿Es una venta cobrada, o sea una que se puede facturar? */
function isCollected(sale: InvoicePanelProps["sale"]): boolean {
  return isIncomeStatus(sale) && sale.paidOn !== null;
}

/** Lo que se dice de una venta con factura (o «No requiere») que no se puede volver a pendiente desde acá. */
function WhyNoUndo({ sale }: { sale: InvoicePanelProps["sale"] }) {
  if (sale.status === "cancelled" || sale.status === "refunded") {
    return (
      <>
        Como la venta está {STATUS_LABELS[sale.status].toLowerCase()}, no se vuelve a pendiente desde acá.
        {sale.invoiceStatus === "issued"
          ? " Para anular una factura ya emitida hace falta una nota de crédito, y esa se hace en ARCA."
          : null}
      </>
    );
  }
  return <>Para volver a pendiente, la venta tiene que estar cobrada o entregada.</>;
}

/**
 * Lo que dice la ficha de la venta sobre su factura, solo para leer: el estado
 * y, si está facturada, el tipo, el número y la fecha. La factura no se edita
 * acá: se marca en Facturación. Si se anotó mal (o la venta no tenía que
 * salir de la lista) el botón la devuelve a pendiente y se vuelve a marcar; solo
 * en una venta cobrada o entregada. En una cancelada o reembolsada la factura
 * se muestra tal cual, sin botón: si ya salió en ARCA, se anula allá con una
 * nota de crédito.
 */
export function InvoicePanel({ sale, undoAction, today }: InvoicePanelProps) {
  const hasInvoiceState = sale.invoiceStatus === "issued" || sale.invoiceStatus === "not_required";
  const canUndo = hasInvoiceState && isIncomeStatus(sale);

  return (
    <section
      aria-labelledby="invoice-panel-title"
      data-testid="invoice-panel"
      className="mb-6 border-2 border-ink border-l-[6px] border-l-gold bg-white px-5 py-4"
    >
      <h2 id="invoice-panel-title" className="text-[1.25rem] leading-tight font-extrabold [font-stretch:75%]">
        Factura
      </h2>
      <dl className="mt-3 grid grid-cols-[repeat(4,minmax(0,auto))] justify-start gap-x-10 gap-y-3 narrow:grid-cols-1">
        <div>
          <dt className="text-[0.875rem] text-ink-2">Estado</dt>
          <dd className="mt-0.5">
            <InvoiceStatusBadge status={sale.invoiceStatus} />
          </dd>
        </div>
        {sale.invoiceStatus === "issued" ? (
          <>
            <div>
              <dt className="text-[0.875rem] text-ink-2">Tipo</dt>
              <dd className="text-[1.125rem] font-bold">{sale.invoiceType ? `Factura ${sale.invoiceType}` : "—"}</dd>
            </div>
            <div>
              <dt className="text-[0.875rem] text-ink-2">Número</dt>
              <dd className="text-[1.125rem] font-bold tabular-nums">{sale.invoiceNumber ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[0.875rem] text-ink-2">Fecha de la factura</dt>
              <dd className="text-[1.125rem] font-bold tabular-nums">
                {sale.invoicedOn ? formatDay(sale.invoicedOn) : "—"}
              </dd>
            </div>
          </>
        ) : null}
      </dl>

      {canUndo ? (
        <>
          <p className="mt-3 max-w-prose text-[0.9375rem] text-ink-2">
            {sale.invoiceStatus === "issued"
              ? "Si anotaste mal el número, el tipo o la fecha, "
              : "Si no tenía que salir de la lista, "}
            volvela a pendiente y marcala de nuevo en <BillingLink>Facturación</BillingLink>.
          </p>
          <form action={undoAction} className="mt-3">
            <SubmitButton variant="ink-outline" size="sm" pendingLabel="Volviendo a pendiente…">
              Volver a pendiente
            </SubmitButton>
          </form>
        </>
      ) : hasInvoiceState ? (
        <p className="mt-3 max-w-prose text-[0.9375rem] text-ink-2">
          <WhyNoUndo sale={sale} />
        </p>
      ) : isCollected(sale) && sale.paidOn !== null && sale.paidOn > today ? (
        // Facturación solo lista lo cobrado hasta hoy: con fecha de cobro futura todavía no aparece ahí.
        <p className="mt-3 max-w-prose text-[0.9375rem] text-ink-2">
          La vas a poder facturar desde el {formatDay(sale.paidOn)}.
        </p>
      ) : isCollected(sale) ? (
        <p className="mt-3 max-w-prose text-[0.9375rem] text-ink-2">
          Todavía no la marcaste. La facturás desde <BillingLink>Facturación</BillingLink>.
        </p>
      ) : (
        <p className="mt-3 max-w-prose text-[0.9375rem] text-ink-2">
          Se puede facturar cuando esté cobrada o entregada y tenga fecha de cobro.
        </p>
      )}
    </section>
  );
}
