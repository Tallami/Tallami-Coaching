import Link from "next/link";
import { INVOICE_STATUSES, INVOICE_STATUS_LABELS } from "@/admin/catalog";
import type { DateRange } from "@/admin/metrics/period";
import { SALES_PARAMS } from "@/admin/sales/filters";
import { SectionCard } from "@/admin/overview/section-card";
import { Field } from "@/admin/ui/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

export const BILLING_EXPORT_PATH = "/admin/facturacion/exportar";

/**
 * La descarga para el contador: lo cobrado en un período, en un CSV que se abre
 * en Excel. Es un formulario `GET` común: el archivo se baja sin JavaScript y
 * la dirección (`?desde=…&hasta=…&factura=…`) lleva los filtros.
 */
export function ExportCard({ defaults }: { defaults: DateRange }) {
  return (
    <SectionCard
      id="exportar"
      testId="export"
      title="Exportar para el contador"
      description="Un archivo CSV con lo cobrado, para abrir en Excel."
    >
      <form method="get" action={BILLING_EXPORT_PATH} aria-label="Exportar para el contador" className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-4">
          <Field id="export-from" label="Desde">
            {(control) => <Input {...control} type="date" name={SALES_PARAMS.from} defaultValue={defaults.from} />}
          </Field>
          <Field id="export-to" label="Hasta">
            {(control) => <Input {...control} type="date" name={SALES_PARAMS.to} defaultValue={defaults.to} />}
          </Field>
        </div>
        <Field id="export-invoice" label="Factura">
          {(control) => (
            <NativeSelect {...control} name={SALES_PARAMS.invoiceStatus} defaultValue="">
              <NativeSelectOption value="">Todas</NativeSelectOption>
              {INVOICE_STATUSES.map((status) => (
                <NativeSelectOption key={status} value={status}>
                  {INVOICE_STATUS_LABELS[status]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Button type="submit" className="self-start">
          Descargar CSV
        </Button>
      </form>
      <p className="mt-4 text-[0.875rem] leading-snug text-ink-2">
        Trae cada venta cobrada con su valor en pesos y en dólares, el tipo de cambio y los datos de la factura. Por
        defecto, los 12 meses del monotributo. Confirmá con tu contador qué tipo de cambio corresponde.
      </p>
      <p className="mt-2 text-[0.875rem] leading-snug text-ink-2">
        Para otras ventas, con otros filtros, usá «Exportar CSV» en{" "}
        <Link href="/admin/ventas" prefetch={false} className="font-semibold underline underline-offset-2">
          Ventas
        </Link>
        .
      </p>
    </SectionCard>
  );
}
