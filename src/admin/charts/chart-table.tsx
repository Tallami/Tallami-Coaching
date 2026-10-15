import { ChevronDownIcon } from "lucide-react";

interface ChartTableProps {
  /** El texto del botón que despliega la tabla. */
  summary: string;
  /** Qué muestra la tabla, para los lectores de pantalla. */
  caption: string;
  headers: readonly [string, string];
  rows: readonly (readonly [string, string])[];
}

/**
 * La tabla gemela de un gráfico: los mismos números en filas, para quien no ve
 * las barras (lectores de pantalla) o prefiere leerlos. Va plegada con
 * `<details>`, que no necesita JavaScript.
 */
export function ChartTable({ summary, caption, headers, rows }: ChartTableProps) {
  return (
    <details className="group/table mt-3 border-t border-rule pt-3">
      <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-2 rounded-[4px] font-semibold text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronDownIcon
          className="size-4 transition-transform duration-150 group-open/table:rotate-180"
          aria-hidden="true"
        />
        {summary}
      </summary>
      <table className="mt-1 w-full max-w-md border-collapse text-[0.9375rem]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-ink text-left">
            <th scope="col" className="py-1.5 pr-4 font-bold">
              {headers[0]}
            </th>
            <th scope="col" className="py-1.5 text-right font-bold">
              {headers[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, value]) => (
            <tr key={name} className="border-b border-rule">
              <th scope="row" className="py-1.5 pr-4 text-left font-normal">
                {name}
              </th>
              <td className="py-1.5 text-right tabular-nums">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
