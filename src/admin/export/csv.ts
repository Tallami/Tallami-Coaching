// Exportación de ventas a CSV para el contador. Pensada para abrirse con un
// doble clic en Excel en español:
//
// - separador `;` y coma decimal, UTF-8 con BOM (sin él Excel lee mal los acentos);
// - los números van como decimales planos ("1234,56", sin separador de miles)
//   para que Excel los reconozca como números;
// - las fechas, como dd/mm/aaaa;
// - una celda de texto que empieza con `=`, `+`, `-`, `@`, tabulación o retorno
//   de carro se escribe con un apóstrofo adelante: si no, Excel la tomaría por
//   una fórmula (y un nombre o una descripción cargados a mano podrían ejecutar
//   algo al abrir el archivo);
// - las celdas con `;`, comillas o saltos de línea van entre comillas, con la
//   comilla doble escrita dos veces.

import {
  INVOICE_STATUS_LABELS,
  ITEM_LABELS,
  PAYMENT_LABELS,
  RATE_SOURCE_LABELS,
  STATUS_LABELS,
} from "@/admin/catalog";
import { formatDay } from "@/admin/dates";
import type { SaleRow } from "@/admin/sales/sale-row";
import { formatPlainAmount } from "@/lib/money";

const BOM = "\uFEFF";
const SEPARATOR = ";";
const LINE_BREAK = "\r\n";

/** Los encabezados, en el orden en que salen las columnas. */
export const CSV_HEADERS = [
  "Fecha de cobro",
  "Alumno",
  "País",
  "Servicio",
  "Descripción",
  "Moneda",
  "Monto",
  "Pesos",
  "Dólares",
  "Tipo de cambio",
  "Cotización del dólar",
  "Fuente",
  "Fecha de cotización",
  "Medio de pago",
  "Estado",
  "Factura",
  "Tipo",
  "Número",
  "Fecha de factura",
] as const;

/** Un texto que una hoja de cálculo podría tomar por una fórmula. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Un texto que no puede ir "pelado" en una celda. */
const NEEDS_QUOTES = /[";\r\n]/;

/**
 * La celda lista para escribir. `isNumber` es para los números que arma este
 * mismo módulo (un monto negativo no es una fórmula): el texto de una persona
 * nunca lo usa.
 */
export function escapeCsvCell(value: string, options: { isNumber?: boolean } = {}): string {
  const safe = !options.isNumber && FORMULA_START.test(value) ? `'${value}` : value;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

interface CsvCell {
  value: string;
  isNumber?: boolean;
}

const text = (value: string | null | undefined): CsvCell => ({ value: value ?? "" });
const amount = (minor: number): CsvCell => ({ value: formatPlainAmount(minor), isNumber: true });
const day = (isoDay: string | null): CsvCell => text(isoDay ? formatDay(isoDay) : null);

/** "1500.0000" → "1500,00"; "301.5651" → "301,5651": hasta 4 decimales, sin ceros de más. */
function plainRate(rate: string): CsvCell {
  const [whole = "0", fraction = ""] = rate.split(".");
  const decimals = fraction.replace(/0+$/, "").padEnd(2, "0");
  return { value: `${whole},${decimals}`, isNumber: true };
}

function saleCells(sale: SaleRow): CsvCell[] {
  return [
    day(sale.paidOn),
    text(sale.customerName),
    text(sale.customerCountry),
    text(ITEM_LABELS[sale.item]),
    text(sale.description),
    text(sale.currency),
    amount(sale.amountMinor),
    amount(sale.amountArsMinor),
    amount(sale.amountUsdMinor),
    plainRate(sale.arsPerUnit),
    plainRate(sale.arsPerUsd),
    text(RATE_SOURCE_LABELS[sale.rateSource]),
    day(sale.rateQuotedOn),
    text(PAYMENT_LABELS[sale.paymentMethod]),
    text(STATUS_LABELS[sale.status]),
    text(INVOICE_STATUS_LABELS[sale.invoiceStatus]),
    text(sale.invoiceType),
    text(sale.invoiceNumber),
    day(sale.invoicedOn),
  ];
}

function line(cells: readonly CsvCell[]): string {
  return cells.map((cell) => escapeCsvCell(cell.value, { isNumber: cell.isNumber })).join(SEPARATOR);
}

/**
 * Las ventas como CSV: una línea de encabezados y una línea por venta, en el
 * orden que se pasa. Las dos cotizaciones se escriben por separado para que
 * cada cuenta cierre a la vista:
 *
 * - "Tipo de cambio": pesos por unidad de la moneda cobrada (1 para una venta
 *   en pesos), así Monto x Tipo de cambio = Pesos;
 * - "Cotización del dólar": pesos por dólar, así Pesos / Cotización = Dólares
 *   (al centavo).
 *
 * "Fecha de cotización" es el día de la cotización usada (puede ser anterior al
 * cobro: fin de semana o feriado); queda vacía si el valor se cargó a mano.
 */
export function salesToCsv(rows: readonly SaleRow[]): string {
  const lines = [line(CSV_HEADERS.map((header) => text(header))), ...rows.map((sale) => line(saleCells(sale)))];
  return `${BOM}${lines.join(LINE_BREAK)}${LINE_BREAK}`;
}

/** Cualquier cosa que no sea una letra, un número, punto, guion o guion bajo. */
const UNSAFE_FILENAME_CHARS = /[^A-Za-z0-9._-]+/g;

function safeNamePart(value: string): string {
  return value.replace(UNSAFE_FILENAME_CHARS, "-");
}

/**
 * El nombre del archivo, solo con caracteres ASCII seguros, con el rango de
 * fechas: "ventas_2026-01-01_a_2026-03-31.csv". Sin `from` empieza en "inicio";
 * sin `to` termina hoy.
 */
export function csvFilename(
  prefix: string,
  range: { from?: string; to?: string },
  today: string,
): string {
  const from = range.from ?? "inicio";
  const to = range.to ?? today;
  return `${safeNamePart(prefix)}_${safeNamePart(from)}_a_${safeNamePart(to)}.csv`;
}

/**
 * La respuesta de una descarga: el archivo, que nunca se guarda en una caché
 * ni se reinterpreta como otro tipo.
 */
export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeNamePart(filename)}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
