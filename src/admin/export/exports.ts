// Las dos descargas CSV del panel, de punta a punta: filtros de la dirección →
// ventas → archivo. Las rutas (`/admin/ventas/exportar` y
// `/admin/facturacion/exportar`) solo verifican la sesión y llaman acá; vive
// aparte para poder probarlo con una base de prueba.
//
// Los filtros son los mismos de la lista de ventas (`parseSalesQuery`): lo que
// no se reconoce se ignora, nunca da error. La página (`pagina`) no cuenta: el
// archivo trae todo lo que cumple el filtro.

import { csvFilename, csvResponse, salesToCsv } from "@/admin/export/csv";
import { todayInArgentina } from "@/admin/dates";
import { parseSalesQuery } from "@/admin/sales/filters";
import { ExportTooLargeError, listSalesForExport, type SaleFilter } from "@/admin/sales/repository";
import { searchParamsRecord } from "@/admin/ui/search-params";
import type { Db } from "@/db/client";

/** Ventas que entran en un archivo; con más, se pide acotar las fechas. */
export const MAX_EXPORT_ROWS = 20_000;

export interface ExportResponseOptions {
  /** Otro tope de ventas (para probarlo sin cargar miles). */
  limit?: number;
}

const TOO_LARGE_MESSAGE =
  "Hay demasiadas ventas para un solo archivo. Acotá las fechas y probá de nuevo.";
const FAILED_MESSAGE = "No pudimos preparar el archivo. Probá de nuevo en unos minutos.";

/** Un aviso de texto en lugar del archivo, que tampoco se guarda en ninguna caché. */
function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

interface ExportPlan {
  /** Prefijo del nombre del archivo. */
  name: string;
  filter: SaleFilter;
  collectedBy?: string;
}

async function runExport(db: Db, plan: ExportPlan, today: string, limit: number): Promise<Response> {
  try {
    const rows = await listSalesForExport(db, plan.filter, { limit, collectedBy: plan.collectedBy });
    const filename = csvFilename(plan.name, { from: plan.filter.from, to: plan.filter.to }, today);
    return csvResponse(salesToCsv(rows), filename);
  } catch (error) {
    if (error instanceof ExportTooLargeError) return textResponse(413, TOO_LARGE_MESSAGE);
    console.error("Panel: no se pudo armar la exportación.", error);
    return textResponse(500, FAILED_MESSAGE);
  }
}

/**
 * Las ventas que filtra la lista de ventas, todas, de la cobrada hace más
 * tiempo a la más nueva (incluidas las canceladas, reembolsadas o pendientes si
 * el filtro las deja: el archivo lleva el estado de cada una).
 */
export function salesExportResponse(
  db: Db,
  params: URLSearchParams,
  now: Date,
  options: ExportResponseOptions = {},
): Promise<Response> {
  const { filter } = parseSalesQuery(searchParamsRecord(params));
  return runExport(db, { name: "ventas", filter }, todayInArgentina(now), options.limit ?? MAX_EXPORT_ROWS);
}

/**
 * Lo cobrado, para el contador: ventas cobradas o entregadas con fecha de cobro
 * hasta hoy (lo mismo que suman los totales del panel), con los datos de su
 * factura. Respeta las fechas, el estado de la factura y el resto de los filtros
 * de la lista; el estado de la venta no se puede filtrar porque ya es "cobrada".
 */
export function billingExportResponse(
  db: Db,
  params: URLSearchParams,
  now: Date,
  options: ExportResponseOptions = {},
): Promise<Response> {
  const { filter: parsed } = parseSalesQuery(searchParamsRecord(params));
  const filter: SaleFilter = { ...parsed, status: undefined };
  const today = todayInArgentina(now);
  return runExport(db, { name: "facturacion", filter, collectedBy: today }, today, options.limit ?? MAX_EXPORT_ROWS);
}
