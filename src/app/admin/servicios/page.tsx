import type { Metadata } from "next";
import { requireAdmin } from "@/admin/auth/require-admin";
import { interestByItem, interestDropsInRange } from "@/admin/interest/query";
import { loadMetricSales } from "@/admin/metrics/load";
import { periodRange } from "@/admin/metrics/period";
import { parsePeriodParam } from "@/admin/overview/period-param";
import { buildServicesReport } from "@/admin/services/report";
import { ServicesView } from "@/admin/services/services-view";
import { AdminShell } from "@/admin/ui/admin-shell";
import { PageHeader } from "@/admin/ui/page-header";
import { getDb } from "@/db/client";

export const metadata: Metadata = { title: "Servicios" };

/** Cómo anda cada servicio: ventas, ingresos, tendencia, y cuántos tocaron "Reservar" y cuántos compraron. */
export default async function ServicesPage(props: PageProps<"/admin/servicios">) {
  await requireAdmin();
  // El período viene de la dirección (`?periodo=`): lo que no se reconoce es el de por defecto.
  const period = parsePeriodParam((await props.searchParams).periodo);

  const db = await getDb();
  const now = new Date();
  const range = periodRange(period, now);
  const [sales, clicks, droppedClicks] = await Promise.all([
    loadMetricSales(db, now),
    interestByItem(db, range),
    interestDropsInRange(db, range),
  ]);
  const report = buildServicesReport(sales, clicks, period, now, droppedClicks);

  return (
    <AdminShell active="services">
      <PageHeader
        title="Servicios"
        description="Qué se vende, cuánto deja y cuánta gente toca Reservar antes de comprar."
      />
      <ServicesView report={report} />
    </AdminShell>
  );
}
