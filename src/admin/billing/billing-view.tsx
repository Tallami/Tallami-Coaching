import Link from "next/link";
import type { BillingData } from "@/admin/billing/billing-data";
import { ExportCard } from "@/admin/billing/export-card";
import type { InvoicingAction } from "@/admin/billing/form-state";
import { MonthlyBilling } from "@/admin/billing/monthly-billing";
import { UninvoicedSection } from "@/admin/billing/uninvoiced-section";
import { MonotributoCard } from "@/admin/overview/monotributo-card";
import { ADMIN_ROUTES } from "@/admin/routes";
import { EmptyState } from "@/admin/ui/empty-state";
import { Button } from "@/components/ui/button";

interface BillingViewProps {
  data: BillingData;
  /** Marca las ventas elegidas como facturadas o como "no requiere factura". */
  invoiceAction: InvoicingAction;
  /**
   * El aviso del último marcado que salió bien (viene de la dirección). Lo muestra
   * el formulario de la lista y se va si el siguiente marcado falla.
   */
  savedNotice?: string;
}

/**
 * El cuerpo de Facturación (el encabezado de la página lo pone la página). Si
 * todavía no hay nada cobrado no hay nada que facturar: queda la invitación a
 * cargar la primera venta. Con ventas, de arriba abajo: lo que falta facturar,
 * el resumen de 12 meses y, lado a lado, el monotributo y la exportación para
 * el contador. En pantallas angostas todo se apila en ese orden.
 */
export function BillingView({ data, invoiceAction, savedNotice }: BillingViewProps) {
  if (!data.hasIncome) {
    return (
      <EmptyState
        title="Todavía no hay ventas cobradas"
        description="Cada venta cobrada aparece acá hasta que la marques como facturada, y suma al medidor del monotributo. Cargá una y empezás."
        action={
          <Button asChild>
            <Link href={ADMIN_ROUTES.newSale}>Cargá tu primera venta</Link>
          </Button>
        }
      />
    );
  }

  return (
    <>
      <UninvoicedSection data={data} action={invoiceAction} savedNotice={savedNotice} />
      <MonthlyBilling months={data.months} total={data.total} className="mb-6" />
      <div className="grid items-start gap-6 grid-cols-2 narrow:grid-cols-1">
        <MonotributoCard data={data} />
        <ExportCard defaults={data.exportDefaults} invoiceStatus={data.exportInvoiceStatus ?? undefined} />
      </div>
    </>
  );
}
