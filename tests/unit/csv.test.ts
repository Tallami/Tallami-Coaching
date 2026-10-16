import { describe, expect, test } from "vitest";
import {
  CSV_HEADERS,
  csvFilename,
  csvResponse,
  escapeCsvCell,
  salesToCsv,
} from "@/admin/export/csv";
import type { SaleRow } from "@/admin/sales/repository";
import { parseCsv } from "../helpers/csv";

const ROW: SaleRow = {
  id: "8f4f3f64-7c5c-4a43-9d4c-3f6a3a2f1b10",
  customerId: "11111111-7c5c-4a43-9d4c-3f6a3a2f1b10",
  customerName: "Ana Pérez",
  customerDiscord: "ana.fn",
  customerCountry: "AR",
  item: "gamePlan",
  description: null,
  currency: "USD",
  amountMinor: 12000,
  arsPerUnit: "1500.0000",
  arsPerUsd: "1500.0000",
  rateSource: "bcra",
  rateQuotedOn: "2026-10-09",
  amountArsMinor: 18_000_000,
  amountUsdMinor: 12000,
  paymentMethod: "mercadopago",
  status: "paid",
  paidOn: "2026-10-12",
  dueAt: null,
  deliveredAt: null,
  invoiceStatus: "pending",
  invoiceType: null,
  invoiceNumber: null,
  invoicedOn: null,
  source: "manual",
  notes: "no va al CSV",
  createdAt: new Date("2026-10-12T15:00:00Z"),
  updatedAt: new Date("2026-10-12T15:00:00Z"),
};

function row(overrides: Partial<SaleRow> = {}): SaleRow {
  return { ...ROW, ...overrides };
}

describe("salesToCsv", () => {
  test("csv uses semicolons, comma decimals and a BOM", () => {
    const csv = salesToCsv([row()]);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    const [headers, data] = parseCsv(csv);
    expect(headers).toEqual([
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
    ]);
    expect(headers).toHaveLength(19);
    expect(CSV_HEADERS).toEqual(headers);
    expect(data).toEqual([
      "12/10/2026",
      "Ana Pérez",
      "AR",
      "Plan de juego personalizado",
      "",
      "USD",
      "120,00",
      "180000,00",
      "120,00",
      "1500,00",
      "1500,00",
      "BCRA (oficial)",
      "09/10/2026",
      "Mercado Pago",
      "Cobrada",
      "Sin facturar",
      "",
      "",
      "",
    ]);
    // Nada de separadores de miles ni de puntos decimales en los números.
    expect(csv).not.toContain("180.000");
    expect(csv).not.toContain("120.00");
  });

  test("numbers are plain decimals Excel can read in every column that has one", () => {
    const [, data] = parseCsv(
      salesToCsv([
        row({
          currency: "BRL",
          amountMinor: 123_456_789,
          amountArsMinor: 3_456_789_012,
          amountUsdMinor: 2_304_526,
          arsPerUnit: "280.0000",
          arsPerUsd: "1500.5000",
        }),
      ]),
    );

    expect(data[6]).toBe("1234567,89");
    expect(data[7]).toBe("34567890,12");
    expect(data[8]).toBe("23045,26");
    // Las cotizaciones guardan hasta 4 decimales y se escriben sin ceros de más.
    expect(data[9]).toBe("280,00");
    expect(data[10]).toBe("1500,50");
    for (const cell of [data[6], data[7], data[8], data[9], data[10]]) {
      expect(cell).toMatch(/^\d+,\d{2,4}$/);
    }
  });

  test("an exchange rate keeps its 4 decimals when it needs them", () => {
    const [, data] = parseCsv(salesToCsv([row({ arsPerUnit: "12.3400", arsPerUsd: "301.5651" })]));

    expect(data[9]).toBe("12,34");
    expect(data[10]).toBe("301,5651");
  });

  test("a BRL sale explains each rate: Monto x Tipo de cambio = Pesos and Pesos / Cotización del dólar = Dólares", () => {
    const [, data] = parseCsv(
      salesToCsv([
        row({
          currency: "BRL",
          amountMinor: 10_000,
          arsPerUnit: "280.0000",
          arsPerUsd: "1500.0000",
          amountArsMinor: 2_800_000,
          amountUsdMinor: 1867,
          rateQuotedOn: "2026-10-09",
        }),
      ]),
    );

    const [currency, monto, pesos, dolares, tipoDeCambio, cotizacion] = [
      data[5],
      data[6],
      data[7],
      data[8],
      data[9],
      data[10],
    ];
    expect(currency).toBe("BRL");
    // Los números del archivo, leídos como los lee Excel en español (coma decimal).
    const asNumber = (cell: string) => Number(cell.replace(",", "."));
    expect(asNumber(monto) * asNumber(tipoDeCambio)).toBeCloseTo(asNumber(pesos), 2);
    // El dólar del día se redondea al centavo: la cuenta cierra con menos de un centavo de diferencia.
    expect(Math.abs(asNumber(pesos) / asNumber(cotizacion) - asNumber(dolares))).toBeLessThan(0.01);
    expect([monto, pesos, dolares, tipoDeCambio, cotizacion]).toEqual([
      "100,00",
      "28000,00",
      "18,67",
      "280,00",
      "1500,00",
    ]);
  });

  test("a peso sale has a Tipo de cambio of 1 and still gives the dollar rate it was converted with", () => {
    const [, data] = parseCsv(
      salesToCsv([
        row({
          currency: "ARS",
          amountMinor: 6_000_000,
          arsPerUnit: "1.0000",
          arsPerUsd: "1500.0000",
          amountArsMinor: 6_000_000,
          amountUsdMinor: 4000,
        }),
      ]),
    );

    expect(data.slice(5, 11)).toEqual(["ARS", "60000,00", "60000,00", "40,00", "1,00", "1500,00"]);
  });

  test("the quote date is the day of the rate used, and empty for a rate typed by hand", () => {
    const quoted = parseCsv(salesToCsv([row({ rateQuotedOn: "2026-10-09" })]))[1];
    const manual = parseCsv(salesToCsv([row({ rateSource: "manual", rateQuotedOn: null })]))[1];

    // Una cotización de un viernes puede usarse para un cobro del lunes: la fecha de cotización no es la de cobro.
    expect(quoted[11]).toBe("BCRA (oficial)");
    expect(quoted[12]).toBe("09/10/2026");
    expect(manual[11]).toBe("cargado a mano");
    expect(manual[12]).toBe("");
  });

  test("an invoiced sale writes its type, number and date as dd/mm/yyyy", () => {
    const [, data] = parseCsv(
      salesToCsv([
        row({
          invoiceStatus: "issued",
          invoiceType: "E",
          invoiceNumber: "00003-00000045",
          invoicedOn: "2026-10-02",
        }),
      ]),
    );

    expect(data.slice(15)).toEqual(["Facturada", "E", "00003-00000045", "02/10/2026"]);
  });

  test("a sale without a payment date leaves the cell empty", () => {
    const [, data] = parseCsv(salesToCsv([row({ status: "pending", paidOn: null })]));

    expect(data[0]).toBe("");
    expect(data[14]).toBe("Pendiente");
  });

  test("writes one line per sale, in the order given, with CRLF line breaks", () => {
    const csv = salesToCsv([row({ customerName: "Primera" }), row({ customerName: "Segunda" })]);

    const rows = parseCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows.map((cells) => cells[1])).toEqual(["Alumno", "Primera", "Segunda"]);
    expect(csv.split("\r\n")).toHaveLength(4); // tres líneas y el final vacío
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  test("without sales it still has the header line", () => {
    const rows = parseCsv(salesToCsv([]));

    expect(rows).toEqual([[...CSV_HEADERS]]);
  });

  test("csv escapes formula-looking cells and quotes", () => {
    const formula = '=HYPERLINK("http://malo.example";"clic")';
    const csv = salesToCsv([row({ item: "other", description: formula })]);

    // La celda lleva el apóstrofo adelante y, como tiene comillas y `;`, va entre comillas.
    expect(csv).toContain(`"'=HYPERLINK(""http://malo.example"";""clic"")"`);
    expect(parseCsv(csv)[1][4]).toBe(`'${formula}`);
  });

  test.each([
    ["=1+1", "'=1+1"],
    ["+54 11 5555", "'+54 11 5555"],
    ["-2+3", "'-2+3"],
    ["@SUM(A1)", "'@SUM(A1)"],
    ["\tcmd", "'\tcmd"],
    ["\rcmd", "'\rcmd"],
  ])("a student name that starts like a formula (%j) is written as text", (name, expected) => {
    const csv = salesToCsv([row({ customerName: name })]);

    expect(parseCsv(csv)[1][1]).toBe(expected);
  });

  test("quotes cells with semicolons, quotes and line breaks and keeps them intact", () => {
    const name = 'Ana; "la Pro"\nsegunda línea';
    const csv = salesToCsv([row({ customerName: name, description: "uno;dos" })]);

    const [, data] = parseCsv(csv);
    expect(data).toHaveLength(CSV_HEADERS.length);
    expect(data[1]).toBe(name);
    expect(data[4]).toBe("uno;dos");
    expect(csv).toContain('"Ana; ""la Pro""\nsegunda línea"');
  });

  test("text that only looks risky in the middle is not touched", () => {
    const [, data] = parseCsv(salesToCsv([row({ customerName: "Ana-María = 1+1 @casa" })]));

    expect(data[1]).toBe("Ana-María = 1+1 @casa");
  });

  test("a payment date in the Argentine calendar keeps its day", () => {
    const [, data] = parseCsv(salesToCsv([row({ paidOn: "2026-10-31" })]));

    expect(data[0]).toBe("31/10/2026");
  });
});

describe("escapeCsvCell", () => {
  test("leaves plain text alone", () => {
    expect(escapeCsvCell("Ana Pérez")).toBe("Ana Pérez");
    expect(escapeCsvCell("")).toBe("");
  });

  test("a negative number stays a number", () => {
    expect(escapeCsvCell("-5,00", { isNumber: true })).toBe("-5,00");
  });

  test("text that looks like a negative number is still escaped", () => {
    expect(escapeCsvCell("-5,00")).toBe("'-5,00");
  });
});

describe("csvFilename", () => {
  test("names the file with the date range and keeps it ASCII", () => {
    expect(csvFilename("ventas", { from: "2026-01-01", to: "2026-03-31" }, "2026-10-15")).toBe(
      "ventas_2026-01-01_a_2026-03-31.csv",
    );
  });

  test("an open range ends today and starts at the beginning", () => {
    expect(csvFilename("facturacion", {}, "2026-10-15")).toBe(
      "facturacion_inicio_a_2026-10-15.csv",
    );
    expect(csvFilename("ventas", { from: "2026-05-01" }, "2026-10-15")).toBe(
      "ventas_2026-05-01_a_2026-10-15.csv",
    );
  });

  test("never lets anything but safe characters into the name", () => {
    const name = csvFilename("ven/tas\"", { from: "2026-01-01\r\nX: y", to: "ñ" }, "2026-10-15");

    expect(name).toMatch(/^[A-Za-z0-9._-]+\.csv$/);
  });
});

describe("csvResponse", () => {
  test("is a download, not cached, typed as csv and not sniffable", async () => {
    const response = csvResponse("\uFEFFhola;mundo\r\n", "ventas_inicio_a_2026-10-15.csv");

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="ventas_inicio_a_2026-10-15.csv"',
    );
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const bytes = new Uint8Array(await response.arrayBuffer());
    // El BOM de UTF-8 son los bytes EF BB BF.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
