// Las dos descargas CSV del panel, de punta a punta: filtros de la dirección →
// ventas → archivo. Las rutas (`/admin/ventas/exportar` y
// `/admin/facturacion/exportar`) solo verifican la sesión y llaman acá; vive
// aparte para poder probarlo con una base de prueba.
//
// Los filtros son los mismos de la lista de ventas (`parseSalesQuery`): lo que
// no se reconoce se ignora, nunca da error. La página (`pagina`) no cuenta: el
// archivo trae todo lo que cumple el filtro.
//
// Si el archivo no se puede armar (hay demasiadas ventas o falla la base) no se
// contesta un texto suelto: se vuelve a la pantalla de origen con un aviso en
// español (`notices.ts`).

import { csvFilename, csvResponse, salesToCsv } from "@/admin/export/csv";
import { exportFailurePath, type ExportFailure } from "@/admin/export/notices";
import { todayInArgentina } from "@/admin/dates";
import { ADMIN_ROUTES } from "@/admin/routes";
import { parseSalesQuery, salesQueryString } from "@/admin/sales/filters";
import { ExportTooLargeError, listSalesForExport, type SaleFilter } from "@/admin/sales/repository";
import { searchParamsRecord } from "@/admin/ui/search-params";
import type { Db } from "@/db/client";

/** Ventas que entran en un archivo; con más, se pide acotar las fechas. */
export const MAX_EXPORT_ROWS = 20_000;

export interface ExportResponseOptions {
  /** Otro tope de ventas (para probarlo sin cargar miles). */
  limit?: number;
}

/**
 * Vuelve a la pantalla de origen (`backTo`, con sus filtros) con el motivo en la
 * dirección. Es una redirección sin cuerpo y sin caché: no hay ningún archivo y
 * la pantalla es la que explica.
 */
function backWithNotice(backTo: ExportBack, failure: ExportFailure): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: exportFailurePath(backTo.path, backTo.query, failure),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** La pantalla a la que se vuelve si no hay archivo, y los filtros con que se la dejó. */
interface ExportBack {
  path: string;
  /** Empieza con `?`, o está vacía. */
  query: string;
}

interface ExportPlan {
  /** Prefijo del nombre del archivo. */
  name: string;
  filter: SaleFilter;
  collectedBy?: string;
  /** Adónde se vuelve si el archivo no se puede armar. */
  back: ExportBack;
}

async function runExport(db: Db, plan: ExportPlan, today: string, limit: number): Promise<Response> {
  try {
    const rows = await listSalesForExport(db, plan.filter, { limit, collectedBy: plan.collectedBy });
    const filename = csvFilename(plan.name, { from: plan.filter.from, to: plan.filter.to }, today);
    return csvResponse(salesToCsv(rows), filename);
  } catch (error) {
    if (error instanceof ExportTooLargeError) return backWithNotice(plan.back, "demasiadas");
    console.error("Panel: no se pudo armar la exportación.", error);
    return backWithNotice(plan.back, "error");
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
  const back = { path: ADMIN_ROUTES.sales, query: salesQueryString(filter) };
  return runExport(db, { name: "ventas", filter, back }, todayInArgentina(now), options.limit ?? MAX_EXPORT_ROWS);
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
  const back = { path: ADMIN_ROUTES.billing, query: "" };
  return runExport(db, { name: "facturacion", filter, collectedBy: today, back }, today, options.limit ?? MAX_EXPORT_ROWS);
}
