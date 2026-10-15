import { ITEM_LABELS } from "@/admin/catalog";
import { formatDay } from "@/admin/dates";
import type { CustomerStats } from "@/admin/customers/repository";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/money";

interface StudentSummaryProps {
  student: CustomerStats;
}

const labelClasses = "text-[0.875rem] text-ink-2";
const valueClasses = "text-[1.125rem] font-bold tabular-nums";

/**
 * Lo que compró el alumno, de un vistazo: total gastado, compras, primera y
 * última, y qué servicios. Cuenta solo ventas cobradas o entregadas, igual que
 * la lista de alumnos.
 */
export function StudentSummary({ student }: StudentSummaryProps) {
  const headingId = "student-summary-heading";
  const hasPurchases = student.purchases > 0;

  return (
    <section
      aria-labelledby={headingId}
      className="mb-6 border-2 border-ink border-l-[6px] border-l-zone bg-white px-5 py-4"
    >
      <h2 id={headingId} className="text-[1.25rem] leading-tight font-extrabold [font-stretch:75%]">
        Lo que compró
      </h2>
      <dl className="mt-3 grid grid-cols-[repeat(4,minmax(0,auto))] justify-start gap-x-12 gap-y-3 narrow:grid-cols-2">
        <div className="narrow:col-span-2">
          <dt className={labelClasses}>Total gastado</dt>
          <dd className="text-[1.75rem] leading-tight font-extrabold whitespace-nowrap tabular-nums">
            {formatMoney(student.totalUsdMinor, "USD")}
          </dd>
        </div>
        <div>
          <dt className={labelClasses}>Compras</dt>
          <dd className={valueClasses}>{student.purchases}</dd>
        </div>
        {student.firstPaidOn && student.lastPaidOn ? (
          <>
            <div>
              <dt className={labelClasses}>Primera compra</dt>
              <dd className={valueClasses}>{formatDay(student.firstPaidOn)}</dd>
            </div>
            <div>
              <dt className={labelClasses}>Última compra</dt>
              <dd className={valueClasses}>{formatDay(student.lastPaidOn)}</dd>
            </div>
          </>
        ) : null}
      </dl>
      {hasPurchases ? (
        <ul aria-label="Servicios que compró" className="mt-4 flex flex-wrap gap-2">
          {student.items.map((item) => (
            <li key={item}>
              <Badge variant="neutral">{ITEM_LABELS[item]}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[0.9375rem] text-ink-2">
          Todavía no compró: con su primera venta cobrada o entregada acá ves el total y las fechas.
        </p>
      )}
    </section>
  );
}
