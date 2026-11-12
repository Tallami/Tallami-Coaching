"use client";

import { useHydrated } from "@/admin/ui/use-hydrated";

interface LocalTimeProps {
  /** El instante, en ISO 8601. */
  iso: string;
  /** El idioma con el que se escribe (una etiqueta BCP 47: "es-AR", "pt-BR", "en-US"). */
  locale: string;
  /** Una zona fija (el panel pasa la de Argentina). Sin ella, la del navegador de quien lee. */
  timeZone?: string;
}

const PARTS: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };

function format(iso: string, locale: string, timeZone: string | undefined, withZoneName: boolean): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { ...PARTS, timeZone, ...(withZoneName ? { timeZoneName: "short" } : {}) }).format(date);
}

/**
 * Día y hora de un mensaje: "12 nov, 14:03". Con `timeZone`, en esa zona, igual en el servidor y en el
 * navegador. Sin ella, en la zona del navegador; como el servidor no la conoce, hasta que la página se
 * hidrata (y sin JavaScript) se muestra en UTC y lo dice, así la hora nunca se lee mal.
 */
export function LocalTime({ iso, locale, timeZone }: LocalTimeProps) {
  const hydrated = useHydrated();
  const text = timeZone
    ? format(iso, locale, timeZone, false)
    : hydrated
      ? format(iso, locale, undefined, false)
      : format(iso, locale, "UTC", true);

  return <time dateTime={iso}>{text}</time>;
}
