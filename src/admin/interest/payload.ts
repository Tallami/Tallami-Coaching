// Lo que `/api/interest` acepta: un JSON con exactamente dos campos de listas
// cerradas, y el país que pone Vercel en un encabezado. Todo lo demás se
// descarta sin repetirlo (nunca se devuelve texto del pedido).

import { z } from "zod";
import { INTEREST_ITEMS, INTEREST_LOCALES } from "@/admin/catalog";

/** Estricto: un campo de más es un pedido que no manda el sitio. */
const interestPayloadSchema = z.strictObject({
  item: z.enum(INTEREST_ITEMS),
  locale: z.enum(INTEREST_LOCALES),
});

export type InterestPayload = z.infer<typeof interestPayloadSchema>;

/** El clic que describe el cuerpo del pedido, o `null` si no es JSON o no cumple el formato. */
export function parseInterestPayload(text: string): InterestPayload | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = interestPayloadSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

const COUNTRY_HEADER = "x-vercel-ip-country";
const COUNTRY_CODE = /^[A-Z]{2}$/;

/**
 * País del visitante según Vercel, o `null`. Solo vale un código de dos letras
 * mayúsculas: fuera de Vercel el encabezado lo manda cualquiera y no se guarda
 * nada que no tenga ese formato.
 */
export function readCountry(headers: Headers): string | null {
  const value = headers.get(COUNTRY_HEADER);
  return value !== null && COUNTRY_CODE.test(value) ? value : null;
}
