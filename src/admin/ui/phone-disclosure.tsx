"use client";

import { ChevronDownIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PhoneDisclosureProps {
  /** Texto del botón que despliega el contenido. */
  label: string;
  /** Cuántos filtros (o similares) hay puestos: se anotan en el botón y, si hay, arranca desplegado. */
  activeCount?: number;
  children: ReactNode;
}

/**
 * Contenido que en pantallas anchas se ve siempre y hasta 900 px queda detrás
 * de un botón. Sirve para que un bloque largo (los filtros) no empuje la lista
 * fuera de la pantalla del celular.
 */
export function PhoneDisclosure({ label, activeCount = 0, children }: PhoneDisclosureProps) {
  const [isOpen, setIsOpen] = useState(activeCount > 0);
  const panelId = useId();

  return (
    <div className="mb-5">
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((open) => !open)}
        className="hidden min-h-12 w-full cursor-pointer items-center justify-between gap-3 border-2 border-ink bg-white px-4 font-bold transition-[color,background-color,border-color] duration-150 hover:bg-gold/15 narrow:flex"
      >
        <span>
          {label}
          {activeCount > 0 ? (
            <span className="ml-2 rounded-[4px] bg-gold px-2 py-0.5 text-[0.8125rem] text-stage">
              {activeCount === 1 ? "1 activo" : `${activeCount} activos`}
            </span>
          ) : null}
        </span>
        <ChevronDownIcon
          className={cn("size-5 shrink-0 transition-transform duration-150", isOpen && "rotate-180")}
          aria-hidden="true"
        />
      </button>
      <div id={panelId} className={cn(isOpen ? "narrow:mt-3" : "narrow:hidden")}>
        {children}
      </div>
    </div>
  );
}
