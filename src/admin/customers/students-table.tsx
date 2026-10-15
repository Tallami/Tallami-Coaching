import Link from "next/link";
import { ITEM_LABELS } from "@/admin/catalog";
import { formatDay } from "@/admin/dates";
import type { CustomerStats } from "@/admin/customers/repository";
import { EmptyState } from "@/admin/ui/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatMoney } from "@/lib/money";
import { cn } from "@/lib/utils";

const STUDENTS_PATH = "/admin/alumnos";
const NEW_STUDENT_PATH = "/admin/alumnos/nuevo";

interface StudentsTableProps {
  rows: readonly CustomerStats[];
  /** Hay una búsqueda puesta: una lista vacía significa "nadie coincide", no "no hay alumnos". */
  hasSearch: boolean;
}

const numberCell = "text-right whitespace-nowrap tabular-nums";

/** Un día de compra, o un guion si el alumno todavía no compró (lo dice la columna de servicios). */
function PurchaseDay({ day }: { day: string | null }) {
  return day ? <>{formatDay(day)}</> : <span aria-hidden="true" className="text-ink-2">—</span>;
}

/** La lista de alumnos. Si es más ancha que la pantalla, se desplaza dentro de su recuadro. */
export function StudentsTable({ rows, hasSearch }: StudentsTableProps) {
  if (rows.length === 0) {
    return hasSearch ? (
      <EmptyState
        title="Ningún alumno coincide con la búsqueda"
        description="Probá con un texto más corto: se busca en el nombre y en el Discord."
        action={
          <Button asChild variant="ink-outline" size="sm">
            <Link href={STUDENTS_PATH}>Ver todos los alumnos</Link>
          </Button>
        }
      />
    ) : (
      <EmptyState
        title="Todavía no hay alumnos"
        description="Los alumnos también se crean solos cuando cargás una venta de alguien nuevo. Acá los ves con lo que compró cada uno."
        action={
          <Button asChild>
            <Link href={NEW_STUDENT_PATH}>Cargá tu primer alumno</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="border-2 border-ink bg-white">
      <Table
        className="min-w-[60rem]"
        containerProps={{ role: "region", "aria-label": "Alumnos", tabIndex: 0 }}
      >
        <TableHeader>
          <TableRow className="border-b-0 hover:bg-transparent focus-within:bg-transparent">
            <TableHead scope="col">Alumno</TableHead>
            <TableHead scope="col">País</TableHead>
            <TableHead scope="col" className="text-right">
              Compras
            </TableHead>
            <TableHead scope="col" className="text-right">
              Total gastado
            </TableHead>
            <TableHead scope="col">Primera compra</TableHead>
            <TableHead scope="col">Última compra</TableHead>
            <TableHead scope="col">Servicios</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((student) => (
            <TableRow key={student.id}>
              <TableCell>
                <Link
                  href={`${STUDENTS_PATH}/${student.id}`}
                  prefetch={false}
                  className="rounded-[2px] font-bold underline decoration-ink-2/50 underline-offset-4 hover:decoration-ink"
                >
                  {student.name}
                </Link>
                {student.discord ? (
                  <div className="mt-0.5 text-[0.875rem] text-ink-2">{student.discord}</div>
                ) : null}
              </TableCell>
              <TableCell>
                {student.country ? (
                  <Badge variant="outline">{student.country}</Badge>
                ) : (
                  <span aria-hidden="true" className="text-ink-2">
                    —
                  </span>
                )}
              </TableCell>
              <TableCell className={numberCell}>{student.purchases}</TableCell>
              <TableCell
                className={cn(numberCell, student.purchases > 0 ? "font-bold" : "text-ink-2")}
              >
                {formatMoney(student.totalUsdMinor, "USD")}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <PurchaseDay day={student.firstPaidOn} />
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <PurchaseDay day={student.lastPaidOn} />
              </TableCell>
              <TableCell className="max-w-[18rem] text-[0.9375rem] leading-snug">
                {student.items.length > 0 ? (
                  student.items.map((item) => ITEM_LABELS[item]).join(", ")
                ) : (
                  <span className="text-ink-2">Sin compras</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
