import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/admin/auth/require-admin";
import { loadMetricSales } from "@/admin/metrics/load";
import { buildOverview } from "@/admin/overview/overview-data";
import { OverviewView } from "@/admin/overview/overview-view";
import { parsePeriodParam } from "@/admin/overview/period-param";
import { ADMIN_ROUTES } from "@/admin/routes";
import { getMonotributoSettings } from "@/admin/settings/read";
import { PageHeader } from "@/admin/ui/page-header";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";
import { PanelShell } from "@/app/admin/panel-shell";

export const metadata: Metadata = { title: "Resumen" };

/** Resumen del negocio: lo cobrado, lo que se vende, lo pendiente y el monotributo. */
export default async function OverviewPage(props: PageProps<"/admin">) {
  await requireAdmin();
  // El período viene de la dirección (`?periodo=`): lo que no se reconoce es el de por defecto.
  const period = parsePeriodParam((await props.searchParams).periodo);

  const db = await getDb();
  const now = new Date();
  const [sales, monotributo] = await Promise.all([loadMetricSales(db, now), getMonotributoSettings(db)]);
  const data = buildOverview(sales, monotributo, period, now);

  return (
    <PanelShell active="overview">
      <PageHeader
        title="Resumen"
        description="Cuánto ganás, qué se vende y qué tenés pendiente."
        actions={
          <Button asChild>
            <Link href={ADMIN_ROUTES.newSale}>Cargar una venta</Link>
          </Button>
        }
      />
      <OverviewView data={data} />
    </PanelShell>
  );
}
