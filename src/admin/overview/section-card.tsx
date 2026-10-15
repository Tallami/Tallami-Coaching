import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionCardProps {
  /** Distingue el `id` del título; único en la página. */
  id: string;
  title: string;
  /** Una línea chica bajo el título: qué período o qué ventana mira. */
  description?: ReactNode;
  /** El color del filo izquierdo: azul para datos, dorado para lo que pide atención. */
  accent?: "zone" | "gold";
  testId?: string;
  className?: string;
  children: ReactNode;
}

/** Un bloque del resumen: panel blanco con borde de tinta, filo de color a la izquierda y título. */
export function SectionCard({
  id,
  title,
  description,
  accent = "zone",
  testId,
  className,
  children,
}: SectionCardProps) {
  const titleId = `${id}-title`;
  return (
    <section
      aria-labelledby={titleId}
      data-testid={testId}
      className={cn(
        "min-w-0 border-2 border-ink border-l-[6px] bg-white p-5 narrow:p-4",
        accent === "gold" ? "border-l-gold" : "border-l-zone",
        className,
      )}
    >
      <h2 id={titleId} className="text-[1.5rem] leading-tight font-extrabold [font-stretch:75%]">
        {title}
      </h2>
      {description ? <p className="mt-1 text-[0.9375rem] text-ink-2">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}
