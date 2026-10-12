import { INTL_TAG, type Locale } from "@/i18n/routing";

const ENGLISH_ORDINAL_SUFFIX: Record<Intl.LDMLPluralRule, string> = {
  zero: "th",
  one: "st",
  two: "nd",
  few: "rd",
  many: "th",
  other: "th",
};

const englishOrdinals = new Intl.PluralRules("en-US", { type: "ordinal" });

/** "USD 45.300" (es, pt) o "USD 45,300" (en). Siempre con espacio normal. */
export function formatUsd(amount: number, locale: Locale): string {
  const grouped = new Intl.NumberFormat(INTL_TAG[locale], {
    maximumFractionDigits: 0,
  }).format(amount);
  return `USD ${grouped}`;
}

/** "1º" en es y pt; "1st", "2nd", "3rd", "4th" en en. */
export function formatPlace(place: number, locale: Locale): string {
  if (locale === "en") {
    return `${place}${ENGLISH_ORDINAL_SUFFIX[englishOrdinals.select(place)]}`;
  }
  return `${place}º`;
}

export interface ListPart {
  type: "element" | "literal";
  value: string;
}

/**
 * Une los nombres con la conjunción del idioma ("K1ng, Fazer y Phzin") y los
 * devuelve por partes: `element` es cada nombre, `literal` son las comas y la
 * conjunción. Así la página puede marcar los nombres como no traducibles sin
 * tocar la conjunción.
 */
export function formatListParts(
  items: readonly string[],
  locale: Locale,
): ListPart[] {
  return new Intl.ListFormat(INTL_TAG[locale], {
    type: "conjunction",
  }).formatToParts(items);
}
