"use client";

import type { ComponentProps, MouseEvent } from "react";
import type { InterestItem, InterestLocale } from "@/admin/catalog";
import { sendInterest } from "./send-interest";

type BookingLinkProps = Omit<ComponentProps<"a">, "href"> & {
  /** Destino del enlace (`bookingHref`): hoy `#services`, mañana el pago o la agenda. */
  href: string;
  /** Qué botón de reserva es. */
  item: InterestItem;
  /** Idioma de la página donde está. */
  locale: InterestLocale;
};

const MIDDLE_BUTTON = 1;

/**
 * El botón de reserva de un servicio: el mismo `<a href>` de siempre, que en
 * cada clic avisa de forma anónima qué servicio se tocó (ver `sendInterest`).
 * No cancela nada: el teclado (Enter), Ctrl/Cmd+clic y el clic del medio abren
 * el enlace como cualquiera, y sin JavaScript sigue siendo un enlace. El clic
 * del medio no genera `click` sino `auxclick`, por eso se atiende aparte.
 * No agrega atributos ni cambia el HTML que llega del servidor.
 */
export function BookingLink({ item, locale, onClick, onAuxClick, ...anchor }: BookingLinkProps) {
  return (
    <a
      {...anchor}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        sendInterest(item, locale);
        onClick?.(event);
      }}
      onAuxClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (event.button === MIDDLE_BUTTON) sendInterest(item, locale);
        onAuxClick?.(event);
      }}
    />
  );
}
