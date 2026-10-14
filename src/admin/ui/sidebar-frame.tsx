"use client";

import { MenuIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Monogram } from "@/admin/ui/monogram";
import { cn } from "@/lib/utils";

const MENU_ID = "menu-del-panel";

interface SidebarFrameProps {
  /** La navegación y el botón Salir, armados en el servidor. */
  children: ReactNode;
}

/**
 * Barra lateral del panel. En pantallas anchas es una columna fija; hasta 900 px
 * queda como una barra de arriba con el botón "Menú", que despliega la
 * navegación (se cierra con Escape y al elegir una sección). Es lo único del
 * panel que necesita JavaScript para el menú; la navegación en sí son enlaces.
 */
export function SidebarFrame({ children }: SidebarFrameProps) {
  const [isOpen, setIsOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  function closeWithEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || !isOpen) return;
    setIsOpen(false);
    toggleRef.current?.focus();
  }

  function closeAfterChoosing(event: MouseEvent<HTMLElement>) {
    if (event.target instanceof Element && event.target.closest("a")) setIsOpen(false);
  }

  return (
    <aside
      className="stage sticky top-0 z-30 flex h-dvh flex-col overflow-y-auto border-r border-stage-line narrow:h-auto narrow:max-h-dvh narrow:border-r-0 narrow:border-b"
      onKeyDown={closeWithEscape}
    >
      <div className="flex items-center justify-between gap-3 px-5 pt-6 pb-5 narrow:px-gutter narrow:py-3">
        <Link href="/admin" className="flex items-center gap-3 rounded-[4px]" aria-label="Tallami, panel de administración">
          <Monogram size={40} />
          <span className="flex flex-col leading-none">
            <span className="text-[1.5rem] font-extrabold [font-stretch:75%]">Tallami</span>
            <span className="mt-1 text-[0.8125rem] font-semibold text-on-stage-2">Panel</span>
          </span>
        </Link>
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={isOpen}
          aria-controls={MENU_ID}
          onClick={() => setIsOpen((open) => !open)}
          className="hidden min-h-11 cursor-pointer items-center gap-2 rounded-[4px] border-2 border-[#7F8BB5] px-3 font-bold transition-[color,background-color,border-color] duration-150 hover:border-on-stage narrow:inline-flex"
        >
          {isOpen ? <XIcon className="size-5" aria-hidden="true" /> : <MenuIcon className="size-5" aria-hidden="true" />}
          Menú
        </button>
      </div>
      <div
        id={MENU_ID}
        onClick={closeAfterChoosing}
        className={cn(
          "flex flex-1 flex-col gap-6 px-3 pb-6 narrow:px-gutter narrow:pb-5",
          !isOpen && "narrow:hidden",
        )}
      >
        {children}
      </div>
    </aside>
  );
}
