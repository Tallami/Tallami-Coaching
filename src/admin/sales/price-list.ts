import { SALE_ITEMS, suggestedPriceUsd, type SaleItem } from "@/admin/catalog";

/**
 * Precio de lista en dólares enteros de cada servicio que tiene uno ("Otro"
 * no). El formulario de venta lo sugiere al elegir el servicio.
 */
export function priceListUsd(): Partial<Record<SaleItem, number>> {
  const prices: Partial<Record<SaleItem, number>> = {};
  for (const item of SALE_ITEMS) {
    const price = suggestedPriceUsd(item);
    if (price !== null) prices[item] = price;
  }
  return prices;
}
