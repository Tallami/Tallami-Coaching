import Link from "next/link";
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_LABELS,
  ITEM_LABELS,
  PAYMENT_LABELS,
  PAYMENT_METHODS,
  SALE_ITEMS,
  SALE_STATUSES,
  STATUS_LABELS,
} from "@/admin/catalog";
import {
  SALES_PARAMS,
  countActiveFilters,
  hasActiveFilters,
  salesQueryString,
} from "@/admin/sales/filters";
import type { SaleFilter } from "@/admin/sales/repository";
import { Field } from "@/admin/ui/field";
import { PhoneDisclosure } from "@/admin/ui/phone-disclosure";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";

interface SalesFiltersProps {
  filter: SaleFilter;
}

const SALES_PATH = "/admin/ventas";

/**
 * Filtros de la lista: un formulario `GET`, así que queda en la dirección y se
 * puede compartir. En el celular se despliegan con un botón, para que la lista
 * no quede debajo de seis campos.
 */
export function SalesFilters({ filter }: SalesFiltersProps) {
  return (
    <PhoneDisclosure label="Filtros" activeCount={countActiveFilters(filter)}>
      <form
        // Los campos son "no controlados": al cambiar los filtros (volver, limpiar) se arma un formulario nuevo.
        key={salesQueryString(filter)}
        method="get"
        action={SALES_PATH}
        aria-label="Filtros de ventas"
        className="border-2 border-ink bg-white p-4"
      >
        <div className="grid grid-cols-[minmax(0,2fr)_repeat(2,minmax(0,1fr))] gap-x-4 gap-y-4 narrow:grid-cols-2">
          <Field id="filter-q" label="Buscar alumno" className="narrow:col-span-2">
            {(control) => (
              <Input
                {...control}
                type="search"
                name={SALES_PARAMS.q}
                defaultValue={filter.q ?? ""}
                maxLength={100}
                autoComplete="off"
                placeholder="Nombre o Discord"
              />
            )}
          </Field>
          <Field id="filter-from" label="Cobro desde">
            {(control) => (
              <Input {...control} type="date" name={SALES_PARAMS.from} defaultValue={filter.from ?? ""} />
            )}
          </Field>
          <Field id="filter-to" label="Cobro hasta">
            {(control) => (
              <Input {...control} type="date" name={SALES_PARAMS.to} defaultValue={filter.to ?? ""} />
            )}
          </Field>
        </div>
        <div className="mt-4 grid grid-cols-4 gap-x-4 gap-y-4 narrow:grid-cols-2">
          <Field id="filter-item" label="Servicio">
            {(control) => (
              <NativeSelect {...control} name={SALES_PARAMS.item} defaultValue={filter.item ?? ""}>
                <NativeSelectOption value="">Todos</NativeSelectOption>
                {SALE_ITEMS.map((item) => (
                  <NativeSelectOption key={item} value={item}>
                    {ITEM_LABELS[item]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field id="filter-status" label="Estado">
            {(control) => (
              <NativeSelect {...control} name={SALES_PARAMS.status} defaultValue={filter.status ?? ""}>
                <NativeSelectOption value="">Todos</NativeSelectOption>
                {SALE_STATUSES.map((status) => (
                  <NativeSelectOption key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field id="filter-method" label="Medio de pago">
            {(control) => (
              <NativeSelect
                {...control}
                name={SALES_PARAMS.paymentMethod}
                defaultValue={filter.paymentMethod ?? ""}
              >
                <NativeSelectOption value="">Todos</NativeSelectOption>
                {PAYMENT_METHODS.map((method) => (
                  <NativeSelectOption key={method} value={method}>
                    {PAYMENT_LABELS[method]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field id="filter-invoice" label="Factura">
            {(control) => (
              <NativeSelect
                {...control}
                name={SALES_PARAMS.invoiceStatus}
                defaultValue={filter.invoiceStatus ?? ""}
              >
                <NativeSelectOption value="">Todas</NativeSelectOption>
                {INVOICE_STATUSES.map((status) => (
                  <NativeSelectOption key={status} value={status}>
                    {INVOICE_STATUS_LABELS[status]}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm">
            Filtrar
          </Button>
          {hasActiveFilters(filter) ? (
            <Link
              href={SALES_PATH}
              prefetch={false}
              className="rounded-[2px] font-bold underline underline-offset-4 hover:text-zone"
            >
              Limpiar filtros
            </Link>
          ) : null}
        </div>
      </form>
    </PhoneDisclosure>
  );
}
