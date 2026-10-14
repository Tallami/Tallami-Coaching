import type { ReactNode } from "react";

interface EmptyStateProps {
  title: string;
  description?: string;
  /** La acción que sigue: un botón o enlace. Un estado vacío siempre invita a hacer algo. */
  action?: ReactNode;
}

/** Lo que se ve cuando todavía no hay nada que mostrar, con el paso siguiente a mano. */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <section className="border-2 border-ink border-l-[6px] border-l-gold bg-white px-6 py-8 narrow:px-5">
      <h2 className="text-[1.75rem] leading-tight font-extrabold [font-stretch:75%]">{title}</h2>
      {description ? <p className="mt-2 max-w-prose text-ink-2">{description}</p> : null}
      {action ? <div className="mt-5 flex flex-wrap gap-3">{action}</div> : null}
    </section>
  );
}
