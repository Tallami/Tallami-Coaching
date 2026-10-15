import { cn } from "@/lib/utils";

interface MoneyFigureProps {
  /** El monto ya escrito: "USD 1.264,09". */
  text: string;
  className?: string;
}

/**
 * Un monto grande con los centavos más chicos: "USD 1.264" y ",09" a la mitad
 * de tamaño. Sigue siendo un solo texto ("USD 1.264,09") para quien lo lee o
 * lo copia. Los números grandes van con cifras proporcionales, sin
 * `tabular-nums`.
 */
export function MoneyFigure({ text, className }: MoneyFigureProps) {
  const commaAt = text.lastIndexOf(",");
  if (commaAt < 0) return <span className={className}>{text}</span>;
  return (
    <span className={cn("whitespace-nowrap", className)}>
      {text.slice(0, commaAt)}
      <span className="text-[0.55em]">{text.slice(commaAt)}</span>
    </span>
  );
}
