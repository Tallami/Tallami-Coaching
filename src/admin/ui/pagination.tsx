import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import Link from "next/link";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  /** Lo que se cuenta, en plural: "ventas". */
  noun: string;
  /** A dónde lleva la página `n`; solo se llama para las páginas que existen. */
  hrefFor: (page: number) => string;
}

const linkClasses =
  "inline-flex min-h-11 items-center gap-1 rounded-[4px] border-2 border-ink px-3 font-bold transition-[color,background-color,border-color] duration-150 hover:bg-ink hover:text-paper";
const disabledClasses = "inline-flex min-h-11 items-center gap-1 rounded-[4px] border-2 border-rule px-3 font-bold text-ink-2";

/** "Mostrando 26 a 50 de 120 ventas" con enlaces a la página anterior y a la siguiente. */
export function Pagination({ page, pageSize, total, noun, hrefFor }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Páginas"
      className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3"
    >
      <p className="text-ink-2" aria-live="polite">
        {total === 0
          ? `Sin ${noun}`
          : `Mostrando ${first} a ${last} de ${total} ${noun}`}
      </p>
      {pageCount > 1 ? (
        <div className="flex items-center gap-3">
          {page > 1 ? (
            <Link href={hrefFor(page - 1)} prefetch={false} className={linkClasses}>
              <ChevronLeftIcon className="size-4" aria-hidden="true" />
              Anterior
            </Link>
          ) : (
            <span className={disabledClasses} aria-disabled="true">
              <ChevronLeftIcon className="size-4" aria-hidden="true" />
              Anterior
            </span>
          )}
          <span className="font-semibold tabular-nums">
            Página {page} de {pageCount}
          </span>
          {page < pageCount ? (
            <Link href={hrefFor(page + 1)} prefetch={false} className={linkClasses}>
              Siguiente
              <ChevronRightIcon className="size-4" aria-hidden="true" />
            </Link>
          ) : (
            <span className={disabledClasses} aria-disabled="true">
              Siguiente
              <ChevronRightIcon className="size-4" aria-hidden="true" />
            </span>
          )}
        </div>
      ) : null}
    </nav>
  );
}
