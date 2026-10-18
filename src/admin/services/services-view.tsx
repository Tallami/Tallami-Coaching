import Link from "next/link";
import { INTEREST_GLOBAL_MAX_PER_HOUR, INTEREST_GLOBAL_MAX_PER_WINDOW } from "@/admin/interest/limits";
import { PERIOD_LABELS } from "@/admin/metrics/period";
import { formatRangeLabel } from "@/admin/overview/labels";
import { PeriodSelector } from "@/admin/overview/period-selector";
import { ADMIN_ROUTES } from "@/admin/routes";
import { clicksCountText, droppedClicksText, salesCountText } from "@/admin/services/labels";
import type { ServicesReport } from "@/admin/services/report";
import { ServicesTable } from "@/admin/services/services-table";
import { EmptyState } from "@/admin/ui/empty-state";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/money";


/** Los topes con el separador de miles de Argentina: 2000 se escribe "2.000". */
const numberText = (value: number) => new Intl.NumberFormat("es-AR").format(value);

/** Cómo leer la tabla: lo que no se ve a simple vista y puede llevar a una mala conclusión. */
function Notes() {
  return (
    <section
      aria-labelledby="como-leer-title"
      className="mt-6 max-w-3xl border-2 border-ink border-l-[6px] border-l-gold bg-white p-5 narrow:p-4"
    >
      <h2 id="como-leer-title" className="text-[1.25rem] leading-tight font-extrabold [font-stretch:75%]">
        Cómo leer esta tabla
      </h2>
      <ul className="mt-3 flex list-disc flex-col gap-2 pl-5 text-[0.9375rem] leading-snug text-ink-2">
        <li>
          <strong className="font-bold text-ink">Más de 100 %.</strong> La conversión puede pasar de 100 %: también se
          vende por fuera del sitio (Discord, mensajes) y una compra puede cerrarse en otro período que el clic.
        </li>
        <li>
          El pack de 4 clases y Otro no tienen botón propio en el sitio, por eso no tienen clics ni conversión propios.
          El pack se pide desde el botón de Clase 1 a 1: la conversión de Clase 1 a 1 cuenta también las ventas del
          pack (sus columnas de ventas e ingresos son solo las de la clase).
        </li>
        <li>
          Los clics son anónimos (sin cookies ni datos personales). Se descartan los bots, las ráfagas de una misma
          conexión y todo lo que pase de {numberText(INTEREST_GLOBAL_MAX_PER_WINDOW)} clics por minuto o de{" "}
          {numberText(INTEREST_GLOBAL_MAX_PER_HOUR)} por hora entre todos (si pasó en el período, arriba figura
          cuántos), así que son una guía y no un conteo exacto de personas.
        </li>
        <li>
          Los gráficos muestran los dólares cobrados por mes en los últimos 6 meses, el último todavía abierto.
          Cada fila usa su propia escala y no cambia con el período.
        </li>
      </ul>
    </section>
  );
}

/**
 * El cuerpo de Servicios (el encabezado lo pone la página): selector de
 * período, una línea con el total del período, la tabla y cómo leerla. Sin
 * ventas ni clics no hay nada que mostrar: queda la invitación a cargar la
 * primera venta. El selector va siempre, también sin datos: un período vacío
 * (por ejemplo el mes pasado, cuando los clics empezaron este mes) no puede
 * ser un callejón sin salida.
 */
export function ServicesView({ report }: { report: ServicesReport }) {
  return (
    <>
      <div className="mb-5">
        <PeriodSelector current={report.period} basePath={ADMIN_ROUTES.services} label="Período de los servicios" />
      </div>
      {report.hasActivity ? <ServicesBody report={report} /> : <NoActivity />}
    </>
  );
}

function NoActivity() {
  return (
    <EmptyState
      title="Todavía no hay ventas ni clics"
      description="Cada venta cobrada y cada clic en Reservar del sitio aparecen acá, servicio por servicio, con su conversión. Cargá una venta y empieza la tabla."
      action={
        <Button asChild>
          <Link href={ADMIN_ROUTES.newSale}>Cargá tu primera venta</Link>
        </Button>
      }
    />
  );
}

function ServicesBody({ report }: { report: ServicesReport }) {
  const { totals, period, range, today } = report;
  return (
    <>
      <section aria-labelledby="servicios-title">
        <h2 id="servicios-title" className="text-[1.5rem] leading-tight font-extrabold [font-stretch:75%]">
          Ventas, ingresos y clics por servicio
        </h2>
        <p data-testid="services-summary" className="mt-1 mb-1 text-[0.9375rem] text-ink">
          {PERIOD_LABELS[period]}, {formatRangeLabel(range, today)}: {salesCountText(totals.sales)} por{" "}
          {formatMoney(totals.incomeUsdMinor, "USD")} y {clicksCountText(totals.clicks)}.
        </p>
        {report.droppedClicks > 0 ? (
          <p data-testid="services-dropped" className="mt-1 mb-1 text-[0.9375rem] text-ink-2">
            {droppedClicksText(report.droppedClicks)}.
          </p>
        ) : null}
        <p className="mb-4 max-w-3xl text-[0.9375rem] text-ink-2">
          Para cada servicio, conversión: ventas cobradas ÷ clics en Reservar del mismo período.
        </p>
        <ServicesTable report={report} />
      </section>
      <Notes />
    </>
  );
}
