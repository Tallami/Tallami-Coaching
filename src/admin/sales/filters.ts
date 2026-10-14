// Los filtros de la lista de ventas viven en la dirección (`?estado=paid&q=ana`):
// se pueden compartir, volver atrás y paginar sin perderlos. Todo lo que llega
// de la dirección es texto del usuario: lo que no se reconoce se ignora.

import {
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  SALE_ITEMS,
  SALE_STATUSES,
} from "@/admin/catalog";
import { isValidIsoDate } from "@/admin/dates";
import type { SaleFilter } from "@/admin/sales/repository";

export interface SalesQuery {
  filter: SaleFilter;
  page: number;
}

type SearchParams = Record<string, string | string[] | undefined>;

const MAX_SEARCH_LENGTH = 100;
/** Más páginas que esto no existen: alcanza para mil millones de ventas. */
const MAX_PAGE = 1_000_000;
const WHOLE_NUMBER = /^\d{1,9}$/;

/** Nombres de los parámetros de la dirección, en el orden en que se escriben. */
export const SALES_PARAMS = {
  from: "desde",
  to: "hasta",
  item: "servicio",
  status: "estado",
  paymentMethod: "medio",
  invoiceStatus: "factura",
  q: "q",
  page: "pagina",
} as const;

/** `?clave=a&clave=b` llega como lista: vale el primero. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | undefined {
  return values.find((candidate) => candidate === value);
}

function day(value: string | undefined): string | undefined {
  return value && isValidIsoDate(value) ? value : undefined;
}

/** Los filtros y la página que dice la dirección. */
export function parseSalesQuery(params: SearchParams): SalesQuery {
  const read = (key: keyof typeof SALES_PARAMS) => firstValue(params[SALES_PARAMS[key]])?.trim();
  const q = read("q")?.slice(0, MAX_SEARCH_LENGTH).trim();
  const page = read("page");

  const entries = {
    from: day(read("from")),
    to: day(read("to")),
    item: oneOf(SALE_ITEMS, read("item")),
    status: oneOf(SALE_STATUSES, read("status")),
    paymentMethod: oneOf(PAYMENT_METHODS, read("paymentMethod")),
    invoiceStatus: oneOf(INVOICE_STATUSES, read("invoiceStatus")),
    q: q || undefined,
  };
  const filter = Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined),
  ) as SaleFilter;

  const pageNumber = page && WHOLE_NUMBER.test(page) ? Number(page) : 1;
  return { filter, page: Math.min(Math.max(pageNumber, 1), MAX_PAGE) };
}

/** Cuántos filtros hay puestos. (La página no cuenta.) */
export function countActiveFilters(filter: SaleFilter): number {
  return Object.values(filter).filter((value) => value !== undefined).length;
}

/** ¿Hay algún filtro puesto? */
export function hasActiveFilters(filter: SaleFilter): boolean {
  return countActiveFilters(filter) > 0;
}

/**
 * La parte `?…` de la dirección para estos filtros y esta página; vacía si no
 * hay nada que escribir (la lista sin filtros queda en `/admin/ventas`). La
 * página 1 no se escribe.
 */
export function salesQueryString(filter: SaleFilter, page = 1): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(SALES_PARAMS) as (keyof typeof SALES_PARAMS)[]) {
    const value = key === "page" ? (page > 1 ? String(page) : undefined) : filter[key];
    if (value) params.set(SALES_PARAMS[key], value);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}
