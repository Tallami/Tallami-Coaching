import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** Una línea que explica la página. */
  description?: string;
  /** Botones o enlaces de la página, a la derecha del título. */
  actions?: ReactNode;
}

/** Encabezado de cada página del panel: el título de la página (único `h1`) y sus acciones. */
export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b-2 border-ink pb-4">
      <div className="min-w-0">
        <h1 className="text-[2.5rem] leading-none font-extrabold text-balance [font-stretch:72%] narrow:text-[2.125rem]">
          {title}
        </h1>
        {description ? <p className="mt-2 max-w-prose text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
    </header>
  );
}
