import Link from "next/link";
import { CountriesCard, ItemsCard, PaymentsCard } from "@/admin/overview/breakdown-cards";
import { KpiSection } from "@/admin/overview/kpi-section";
import { MonotributoCard } from "@/admin/overview/monotributo-card";
import { MonthlyIncome } from "@/admin/overview/monthly-income";
import type { OverviewData } from "@/admin/overview/overview-data";
import { PendingSection } from "@/admin/overview/pending-section";
import { PeriodSelector } from "@/admin/overview/period-selector";
import { ADMIN_ROUTES } from "@/admin/routes";
import { EmptyState } from "@/admin/ui/empty-state";
import { Button } from "@/components/ui/button";

/**
 * El cuerpo del resumen (el encabezado de la página lo pone la página). Si las
 * métricas no leen ninguna venta (ni cobrada ni pendiente de trabajo) no hay
 * nada que resumir: queda la invitación a cargar una. Con ventas, de arriba abajo: período, tarjetas, ingresos por mes
 * junto al monotributo, desgloses del período y pendientes. En pantallas
 * angostas todo se apila en ese orden.
 */
export function OverviewView({ data }: { data: OverviewData }) {
  if (!data.hasSales) {
    return (
      <EmptyState
        title="Todavía no hay ventas cobradas"
        description="Cada venta cobrada suma a lo que ganás, a lo que tenés para facturar y al medidor del monotributo. Cargá una y acá aparece el resumen."
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
      <div className="mb-5">
        <PeriodSelector current={data.period} />
      </div>
      <KpiSection data={data} />
      <div className="mb-6 grid items-start gap-6 min-[1180px]:grid-cols-[minmax(0,1fr)_21.5rem]">
        <MonthlyIncome data={data} />
        <MonotributoCard data={data} />
      </div>
      <div className="mb-6 grid items-start gap-6 min-[1180px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <ItemsCard data={data} />
        <div className="flex min-w-0 flex-col gap-6">
          <PaymentsCard data={data} />
          <CountriesCard data={data} />
        </div>
      </div>
      <PendingSection data={data} />
    </>
  );
}
