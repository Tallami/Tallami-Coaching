import type { ReactNode } from "react";
import { formatArs, formatUsd } from "@/lib/format";
import type { Locale } from "@/i18n/routing";
import { pesosForUsd } from "@/payments/pricing";

interface PricePairProps {
  priceUsd: number;
  /** Pesos por dólar ("1500.0000"); sin valor se muestran solo los dólares. */
  rate: string | null;
  locale: Locale;
  /** Clase de cada precio: el de pesos y el de dólares miden igual. */
  className?: string;
  /** Aclaración junto al precio en dólares: "por equipo, toda la temporada". */
  unit?: ReactNode;
}

/** El precio en dólares y, debajo, el mismo en pesos con el mismo tamaño. */
export function PricePair({ priceUsd, rate, locale, className, unit }: PricePairProps) {
  return (
    <span className="ml-auto flex flex-col items-end gap-1">
      <span className={className} data-testid="price">
        {formatUsd(priceUsd, locale)}
        {unit ? (
          <>
            {" "}
            <small>{unit}</small>
          </>
        ) : null}
      </span>
      {rate ? (
        <span className={className} data-testid="price-ars">
          {formatArs(pesosForUsd(priceUsd * 100, rate), locale)}
        </span>
      ) : null}
    </span>
  );
}
