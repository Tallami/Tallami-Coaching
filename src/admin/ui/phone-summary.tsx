interface PhoneSummaryProps {
  /** Qué se vendió: "Clase 1 a 1". */
  service: string;
  /** Lo cobrado, ya escrito en la moneda de la venta: "USD 40,00". */
  amount: string;
  /** El estado de la venta, si la tabla no lo tiene a la vista: "Cobrada". */
  status?: string;
}

/**
 * Una línea para el celular, dentro de la celda del alumno de una tabla ancha:
 * "Clase 1 a 1 · USD 40,00 · Cobrada". En el celular la tabla se desplaza por
 * dentro de su recuadro y de entrada solo se ven las primeras columnas; el
 * servicio y el monto, que es lo que se quiere ver, quedarían detrás del
 * desplazamiento. Con 900 px o más no se dibuja (las columnas ya lo dicen) y
 * los lectores de pantalla no la leen: la tabla ya les da esos datos por columna.
 */
export function PhoneSummary({ service, amount, status }: PhoneSummaryProps) {
  return (
    <p
      aria-hidden="true"
      data-testid="phone-summary"
      className="mt-1 hidden text-[0.875rem] leading-snug text-ink-2 narrow:block"
    >
      {service} ·{" "}
      <span data-testid="phone-amount" className="font-bold whitespace-nowrap text-ink">
        {amount}
      </span>
      {status ? ` · ${status}` : null}
    </p>
  );
}
