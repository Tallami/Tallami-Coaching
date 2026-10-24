"use client";

import type { ReactNode } from "react";
import { clearStoredDrafts } from "@/admin/ui/draft-store";

interface ClearDraftsOnSubmitProps {
  /** La acción del servidor que cierra la sesión. */
  action: () => void | Promise<void>;
  className?: string;
  children?: ReactNode;
}

/**
 * Un formulario de «Salir» que, al enviarse, borra de la pestaña todo lo escrito que se guardó
 * (los borradores y la marca de recuperación): quien cierra la sesión a propósito no quiere que
 * lo suyo siga ahí. Sigue siendo un formulario común con la acción del servidor, así que anda
 * también sin JavaScript (ahí no hay nada guardado que borrar).
 */
export function ClearDraftsOnSubmit({ action, className, children }: ClearDraftsOnSubmitProps) {
  return (
    <form action={action} onSubmit={clearStoredDrafts} className={className}>
      {children}
    </form>
  );
}
