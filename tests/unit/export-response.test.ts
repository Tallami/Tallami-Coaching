import { beforeAll, describe, expect, test, vi } from "vitest";
import { markInvoiceNotRequired, markInvoiced } from "@/admin/billing/invoicing";
import { CSV_HEADERS } from "@/admin/export/csv";
import { billingExportResponse, salesExportResponse } from "@/admin/export/exports";
import { exportErrorNotice } from "@/admin/export/notices";
import { searchParamsRecord } from "@/admin/ui/search-params";
import type { Db } from "@/db/client";
import { parseCsv } from "../helpers/csv";
import { createTestDb } from "../helpers/db";
import { seedSale } from "../helpers/sales-db";

/** Martes 13/10/2026, 15:00 en Argentina. */
const NOW = new Date("2026-10-13T18:00:00.000Z");
const INVOICE = { type: "C", number: "00003-00000045", issuedOn: "2026-10-13" } as const;

async function body(response: Response): Promise<string[][]> {
  return parseCsv(await response.text());
}

/** Los nombres de alumno de las filas de datos, en el orden del archivo. */
function students(rows: string[][]): string[] {
  return rows.slice(1).map((cells) => cells[1]);
}

describe("salesExportResponse", () => {
  let db: Db;
  const named: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDb();
    const make = async (key: string, overrides: Record<string, unknown>) => {
      const name = `Export ${key}`;
      named[key] = await seedSale(db, { customer: { mode: "new", name }, ...overrides });
    };
    await make("paid-oct", { paidOn: "2026-10-10", item: "lesson", paymentMethod: "paypal" });
    await make("paid-sep", { paidOn: "2026-09-10", item: "gamePlan" });
    await make("delivered-aug", { status: "delivered", paidOn: "2026-08-10" });
    await make("cancelled", { status: "cancelled", paidOn: "" });
    await make("pending", { status: "pending", paidOn: "" });
    await make("future", { paidOn: "2026-10-20" });
    await make("invoiced", { paidOn: "2026-10-05" });
    await make("not-required", { paidOn: "2026-10-06" });
    await markInvoiced(db, [named.invoiced], INVOICE, NOW);
    await markInvoiceNotRequired(db, [named["not-required"]], NOW);
  });

  test("download headers: attachment, csv, not cached, not sniffable", async () => {
    const response = await salesExportResponse(db, new URLSearchParams(), NOW);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="ventas_[A-Za-z0-9._-]+\.csv"$/,
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  test("without filters it exports every sale, whatever its status, oldest payment first", async () => {
    const rows = await body(await salesExportResponse(db, new URLSearchParams(), NOW));

    expect(rows[0]).toEqual([...CSV_HEADERS]);
    expect(students(rows).sort()).toEqual(Object.keys(named).map((key) => `Export ${key}`).sort());
    // Con fecha de cobro, de la más vieja a la más nueva; las que no tienen, al final.
    const dates = rows.slice(1).map((cells) => cells[0]);
    expect(dates.slice(0, 3)).toEqual(["10/08/2026", "10/09/2026", "05/10/2026"]);
    expect(dates.slice(-2)).toEqual(["", ""]);
  });

  test("respects the same filters as the screen: dates, service, payment method, status, invoice and name", async () => {
    const run = async (query: string) =>
      students(await body(await salesExportResponse(db, new URLSearchParams(query), NOW))).sort();

    expect(await run("desde=2026-10-01&hasta=2026-10-31")).toEqual([
      "Export future",
      "Export invoiced",
      "Export not-required",
      "Export paid-oct",
    ]);
    expect(await run("hasta=2026-09-30")).toEqual(["Export delivered-aug", "Export paid-sep"]);
    expect(await run("servicio=gamePlan")).toEqual(["Export paid-sep"]);
    expect(await run("medio=paypal")).toEqual(["Export paid-oct"]);
    expect(await run("estado=cancelled")).toEqual(["Export cancelled"]);
    expect(await run("estado=delivered")).toEqual(["Export delivered-aug"]);
    expect(await run("factura=issued")).toEqual(["Export invoiced"]);
    expect(await run("factura=not_required")).toEqual(["Export not-required"]);
    expect(await run("q=export%20paid-")).toEqual(["Export paid-oct", "Export paid-sep"]);
  });

  test("the file name carries the date range of the filter", async () => {
    const withRange = await salesExportResponse(
      db,
      new URLSearchParams("desde=2026-01-01&hasta=2026-03-31"),
      NOW,
    );
    const open = await salesExportResponse(db, new URLSearchParams(), NOW);

    expect(withRange.headers.get("Content-Disposition")).toBe(
      'attachment; filename="ventas_2026-01-01_a_2026-03-31.csv"',
    );
    expect(open.headers.get("Content-Disposition")).toBe(
      'attachment; filename="ventas_inicio_a_2026-10-13.csv"',
    );
  });

  test("an empty result is still a csv with its header line", async () => {
    const rows = await body(await salesExportResponse(db, new URLSearchParams("q=nadie-se-llama-asi"), NOW));

    expect(rows).toEqual([[...CSV_HEADERS]]);
  });

  test.each([
    "desde=0000-01-01&hasta=9999-12-31",
    "desde=basura&hasta=2026-02-30",
    "q=%00",
    "q=a%00b",
    "estado=__proto__&servicio=constructor&medio=toString&factura=hasOwnProperty",
    "__proto__=1&constructor=2&desde=2026-10-01",
    "pagina=3&pagina=x",
    "q=" + "A".repeat(5000),
    "desde=2026-10-01&desde=2026-01-01",
  ])("ignores garbage in the query instead of failing: %s", async (query) => {
    const response = await salesExportResponse(db, new URLSearchParams(query), NOW);

    expect(response.status).toBe(200);
    expect((await body(response))[0]).toEqual([...CSV_HEADERS]);
  });

  test("a hand-written filename-like value can never leak into the file name", async () => {
    const response = await salesExportResponse(
      db,
      new URLSearchParams('desde=2026-01-01"%0d%0aSet-Cookie:x'),
      NOW,
    );

    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="ventas_inicio_a_2026-10-13.csv"',
    );
  });

  test("it is not limited to one page of the list", async () => {
    const big = await createTestDb();
    for (let index = 0; index < 30; index += 1) await seedSale(big);

    const rows = await body(await salesExportResponse(big, new URLSearchParams(), NOW));

    expect(rows).toHaveLength(31);
  });

  test("with more sales than the limit it sends you back to the list, with a notice, and no file", async () => {
    const response = await salesExportResponse(db, new URLSearchParams(), NOW, { limit: 3 });

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/admin/ventas?exportacion=demasiadas");
    expect(response.headers.get("Content-Disposition")).toBeNull();
    expect(response.headers.get("Content-Type")).toBeNull();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  test("the way back keeps the filters, so the person finds the list as they left it", async () => {
    const response = await salesExportResponse(db, new URLSearchParams("estado=paid&q=Export"), NOW, { limit: 1 });

    const location = new URL(response.headers.get("Location") ?? "", "http://panel.test");
    expect(location.pathname).toBe("/admin/ventas");
    expect(Object.fromEntries(location.searchParams)).toEqual({ estado: "paid", q: "Export", exportacion: "demasiadas" });
  });

  test("when the database fails it sends you back too, in the panel, and logs the cause", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      select: () => {
        throw new Error("la base no contesta");
      },
    } as unknown as Db;

    const response = await salesExportResponse(broken, new URLSearchParams(), NOW);

    expect(response.status).toBe(303);
    expect(response.headers.get("Location")).toBe("/admin/ventas?exportacion=error");
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });
});

describe("the notice of a download that did not happen", () => {
  test("is in Spanish and says what to do", () => {
    expect(exportErrorNotice("demasiadas")).toBe(
      "Hay demasiadas ventas para un solo archivo. Acotá las fechas y probá de nuevo.",
    );
    expect(exportErrorNotice("error")).toBe("No pudimos preparar el archivo. Probá de nuevo en unos minutos.");
  });

  test("reads the first value of a repeated parameter and nothing for what it does not know", () => {
    expect(exportErrorNotice(["error", "demasiadas"])).toBe(
      "No pudimos preparar el archivo. Probá de nuevo en unos minutos.",
    );
    for (const value of [undefined, "", "otra-cosa", "__proto__", "constructor", "toString", "hasOwnProperty"]) {
      expect(exportErrorNotice(value), String(value)).toBeNull();
    }
  });
});

describe("billingExportResponse", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
    const make = (name: string, overrides: Record<string, unknown>) =>
      seedSale(db, { customer: { mode: "new", name }, ...overrides });
    await make("Cobrada", { paidOn: "2026-10-10" });
    await make("Entregada", { status: "delivered", paidOn: "2026-09-10" });
    await make("Cancelada", { status: "cancelled", paidOn: "2026-10-01" });
    await make("Reembolsada", { status: "refunded", paidOn: "2026-10-02" });
    await make("Pendiente", { status: "pending", paidOn: "" });
    await make("Futura", { paidOn: "2026-10-20" });
    const invoiced = await make("Facturada", { paidOn: "2026-10-05" });
    await markInvoiced(db, [invoiced], INVOICE, NOW);
    const notRequired = await make("Sin factura", { paidOn: "2026-10-06" });
    await markInvoiceNotRequired(db, [notRequired], NOW);
  });

  test("exports only what was collected: paid or delivered, dated up to today", async () => {
    const rows = await body(await billingExportResponse(db, new URLSearchParams(), NOW));

    expect(rows[0]).toEqual([...CSV_HEADERS]);
    expect(students(rows)).toEqual(["Entregada", "Facturada", "Sin factura", "Cobrada"]);
    // Trae los datos de la factura para el contador.
    const invoiced = rows.find((cells) => cells[1] === "Facturada") as string[];
    expect(invoiced.slice(15)).toEqual(["Facturada", "C", "00003-00000045", "13/10/2026"]);
  });

  test("respects the invoice state and the dates, and ignores a status filter", async () => {
    const run = async (query: string) =>
      students(await body(await billingExportResponse(db, new URLSearchParams(query), NOW)));

    expect(await run("factura=pending")).toEqual(["Entregada", "Cobrada"]);
    expect(await run("factura=issued")).toEqual(["Facturada"]);
    expect(await run("factura=not_required")).toEqual(["Sin factura"]);
    expect(await run("desde=2026-10-01&hasta=2026-10-31")).toEqual(["Facturada", "Sin factura", "Cobrada"]);
    // El estado de la venta no cambia nada: este archivo es de lo cobrado.
    expect(await run("estado=cancelled")).toEqual(["Entregada", "Facturada", "Sin factura", "Cobrada"]);
  });

  test("its file name starts with the word facturacion and carries the range", async () => {
    const response = await billingExportResponse(
      db,
      new URLSearchParams("desde=2025-11-01&hasta=2026-10-13"),
      NOW,
    );

    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="facturacion_2025-11-01_a_2026-10-13.csv"',
    );
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  test("garbage in the query is ignored", async () => {
    const response = await billingExportResponse(
      db,
      new URLSearchParams("factura=__proto__&desde=0000-01-01&q=%00"),
      NOW,
    );

    expect(response.status).toBe(200);
  });

  test("when it cannot be built it sends you back to Facturación, with a notice and no file", async () => {
    const tooMany = await billingExportResponse(db, new URLSearchParams("desde=2026-01-01"), NOW, { limit: 1 });

    expect(tooMany.status).toBe(303);
    expect(tooMany.headers.get("Location")).toBe("/admin/facturacion?exportacion=demasiadas");
    expect(tooMany.headers.get("Content-Disposition")).toBeNull();
    expect(tooMany.headers.get("Cache-Control")).toBe("no-store");

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = {
      select: () => {
        throw new Error("la base no contesta");
      },
    } as unknown as Db;
    const failed = await billingExportResponse(broken, new URLSearchParams(), NOW);
    error.mockRestore();

    expect(failed.status).toBe(303);
    expect(failed.headers.get("Location")).toBe("/admin/facturacion?exportacion=error");
  });
});

describe("searchParamsRecord", () => {
  test("turns the query into the shape pages get, with the first value of a repeated key as a list", () => {
    const params = searchParamsRecord(new URLSearchParams("q=ana&desde=2026-01-01&desde=2026-02-01"));

    expect(params.q).toBe("ana");
    expect(params.desde).toEqual(["2026-01-01", "2026-02-01"]);
  });

  test("a key named __proto__ is just a key: it changes nothing", () => {
    const params = searchParamsRecord(new URLSearchParams("__proto__=x&constructor=y&toString=z"));

    expect(Object.getPrototypeOf(params)).toBeNull();
    expect(params.__proto__).toBe("x");
    expect({}.constructor).toBe(Object);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
});
