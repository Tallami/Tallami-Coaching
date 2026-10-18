import { CircleCheckIcon } from "lucide-react";
import type { BillingData } from "@/admin/billing/billing-data";
import type { InvoicingAction } from "@/admin/billing/form-state";
import { UninvoicedList } from "@/admin/billing/uninvoiced-list";
import { toGroupViews } from "@/admin/billing/uninvoiced-views";
import { SectionCard } from "@/admin/overview/section-card";
import { Notice } from "@/admin/ui/notice";
import { formatMoney } from "@/lib/money";

interface UninvoicedSectionProps {
  data: BillingData;
  action: InvoicingAction;
}

/**
 * Lo cobrado que falta facturar, por mes de cobro, con los totales en pesos y
 * en dólares y el formulario para marcarlo. Una venta con fecha de cobro futura
 * todavía no se cobró y no figura (igual que en el resumen).
 */
export function UninvoicedSection({ data, action }: UninvoicedSectionProps) {
  const { uninvoiced } = data;
  const groups = toGroupViews(uninvoiced.groups);
  // Cuando se marcan ventas la lista cambia: con otra clave arranca sin nada elegido ni escrito.
  const listKey = groups.flatMap((group) => group.rows.map((row) => row.id)).join(",");

  return (
    <SectionCard
      id="por-facturar"
      testId="uninvoiced"
      title="Por facturar"
      accent="gold"
      description="Ventas cobradas o entregadas que todavía no marcaste como facturadas, por fecha de cobro. El panel no emite facturas: acá anotás las que ya hiciste en ARCA. «No requiere factura» saca las ventas de la lista sin anotar ninguna."
      className="mb-6"
    >
      {uninvoiced.count === 0 ? (
        <>
          <p className="flex items-center gap-2 text-[1.0625rem] font-bold">
            <CircleCheckIcon className="size-5 shrink-0 text-ok-ink" aria-hidden="true" />
            Todo lo cobrado está facturado.
          </p>
          <p className="mt-1 max-w-prose text-ink-2">
            Cuando cobres una venta nueva aparece acá hasta que la marques como facturada o como «No requiere factura».
          </p>
        </>
      ) : (
        <>
          <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span data-testid="uninvoiced-count" className="text-[2rem] leading-none font-extrabold [font-stretch:75%]">
              {`${uninvoiced.count} ${uninvoiced.count === 1 ? "venta sin facturar" : "ventas sin facturar"}`}
            </span>
            <span className="text-[1.0625rem]">
              Suman <strong className="tabular-nums">{formatMoney(uninvoiced.arsMinor, "ARS")}</strong>
              <span className="text-ink-2"> ({formatMoney(uninvoiced.usdMinor, "USD")})</span>
            </span>
          </p>
          {uninvoiced.reachesBeyondTwelveMonths ? (
            <p data-testid="uninvoiced-scope" className="mt-3 max-w-prose text-[0.9375rem] text-ink-2">
              Esta lista trae todo lo cobrado sin facturar, de cualquier fecha. El resumen de 12 meses de más abajo
              cuenta solo los cobros de los últimos 12 meses, así que su «Sin facturar» puede ser menor.
            </p>
          ) : null}
          {uninvoiced.truncated ? (
            <Notice tone="info" className="mt-4">
              Hay más ventas sin facturar de las que se muestran: acá están las más nuevas. Marcalas y vas a ver las
              que quedan.
            </Notice>
          ) : null}
          <UninvoicedList key={listKey} groups={groups} today={data.today} action={action} />
        </>
      )}
    </SectionCard>
  );
}
