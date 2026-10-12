"use client";

import type { FocusEvent, ReactNode } from "react";

interface NavListProps {
  className: string;
  children: ReactNode;
}

/**
 * Lista de la navegación principal. ≤900 px hace scroll horizontal y el
 * navegador no siempre lleva el link enfocado hasta adentro de la vista: el
 * último queda a medias bajo el fundido del borde. Al recibir el foco, el link
 * se desplaza lo justo para verse entero. Es el único componente de cliente de
 * la navegación: los `<li>` llegan ya renderizados desde el servidor.
 */
export function NavList({ className, children }: NavListProps) {
  function revealFocusedLink(event: FocusEvent<HTMLUListElement>) {
    if (event.target instanceof HTMLElement) {
      event.target.scrollIntoView({ inline: "nearest", block: "nearest" });
    }
  }

  return (
    <ul className={className} onFocus={revealFocusedLink}>
      {children}
    </ul>
  );
}
