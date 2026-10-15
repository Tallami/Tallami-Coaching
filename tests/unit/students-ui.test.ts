import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { CustomerStats } from "@/admin/customers/repository";
import { StudentHistory } from "@/admin/customers/student-history";
import { StudentSummary } from "@/admin/customers/student-summary";
import { StudentsTable } from "@/admin/customers/students-table";
import type { SaleRow } from "@/admin/sales/repository";

const STUDENT: CustomerStats = {
  id: "11111111-7c5c-4a43-9d4c-3f6a3a2f1b10",
  name: "Ana Pérez",
  discord: "ana.fn",
  country: "AR",
  purchases: 2,
  totalUsdMinor: 7000,
  firstPaidOn: "2026-08-10",
  lastPaidOn: "2026-09-05",
  items: ["vodRecorded", "lesson"],
};

const SALE: SaleRow = {
  id: "8f4f3f64-7c5c-4a43-9d4c-3f6a3a2f1b10",
  customerId: STUDENT.id,
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
  notes: null,
  createdAt: new Date("2026-10-12T15:00:00Z"),
  updatedAt: new Date("2026-10-12T15:00:00Z"),
};

function table(rows: CustomerStats[], hasSearch = false): string {
  return renderToStaticMarkup(createElement(StudentsTable, { rows, hasSearch }));
}

describe("StudentsTable", () => {
  test("with no students it invites to add the first one", () => {
    const markup = table([]);

    expect(markup).toContain("Todavía no hay alumnos");
    expect(markup).toContain("Cargá tu primer alumno");
    expect(markup).toContain('href="/admin/alumnos/nuevo"');
    expect(markup).not.toContain("<table");
  });

  test("with a search on, an empty result offers to see everybody instead", () => {
    const markup = table([], true);

    expect(markup).toContain("Ningún alumno coincide con la búsqueda");
    expect(markup).toContain('href="/admin/alumnos"');
    expect(markup).not.toContain("Cargá tu primer alumno");
  });

  test("shows each student with what they bought", () => {
    const markup = table([STUDENT]);

    expect(markup).toContain("Ana Pérez");
    expect(markup).toContain("ana.fn");
    expect(markup).toContain(">AR<");
    expect(markup).toContain("USD 70,00");
    expect(markup).toContain("10/08/2026");
    expect(markup).toContain("05/09/2026");
    expect(markup).toContain("VOD review grabado");
    expect(markup).toContain("Clase 1 a 1");
    expect(markup).not.toContain("Plan de juego personalizado");
  });

  test("each row opens the student's page", () => {
    expect(table([STUDENT])).toContain(`href="/admin/alumnos/${STUDENT.id}"`);
  });

  test("a student who has not bought yet shows zeros and no dates", () => {
    const markup = table([
      { ...STUDENT, purchases: 0, totalUsdMinor: 0, firstPaidOn: null, lastPaidOn: null, items: [] },
    ]);

    expect(markup).toContain("USD 0,00");
    expect(markup).toContain("Sin compras");
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("null");
  });

  test("never turns a name or a discord into markup", () => {
    const markup = table([{ ...STUDENT, name: "<img src=x onerror=alert(1)>", discord: "<b>d</b>" }]);

    expect(markup).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(markup).toContain("&lt;b&gt;d&lt;/b&gt;");
    expect(markup).not.toContain("<img src=x");
  });

  test("the table scrolls inside its own region that a keyboard can reach", () => {
    const markup = table([STUDENT]);

    expect(markup).toMatch(/<div[^>]*role="region"[^>]*aria-label="Alumnos"[^>]*tabindex="0"/);
    expect(markup).toContain("overflow-x-auto");
  });
});

describe("StudentSummary", () => {
  test("shows how much the student bought, the first and the last purchase and the services", () => {
    const markup = renderToStaticMarkup(createElement(StudentSummary, { student: STUDENT }));

    expect(markup).toContain("Total gastado");
    expect(markup).toContain("USD 70,00");
    expect(markup).toContain("10/08/2026");
    expect(markup).toContain("05/09/2026");
    expect(markup).toContain("VOD review grabado");
    expect(markup).toContain("Clase 1 a 1");
  });

  test("says so when the student has not bought anything yet", () => {
    const markup = renderToStaticMarkup(
      createElement(StudentSummary, {
        student: { ...STUDENT, purchases: 0, totalUsdMinor: 0, firstPaidOn: null, lastPaidOn: null, items: [] },
      }),
    );

    expect(markup).toContain("Todavía no compró");
    expect(markup).toContain("USD 0,00");
    expect(markup).not.toContain("null");
  });
});

describe("StudentHistory", () => {
  function history(sales: SaleRow[]): string {
    return renderToStaticMarkup(createElement(StudentHistory, { sales }));
  }

  test("with no sales it says so and offers to add one", () => {
    const markup = history([]);

    expect(markup).toContain("Todavía no tiene ventas");
    expect(markup).toContain('href="/admin/ventas/nueva"');
    expect(markup).not.toContain("<table");
  });

  test("lists every sale with its status, and each one opens the sale", () => {
    const markup = history([
      SALE,
      { ...SALE, id: "22222222-7c5c-4a43-9d4c-3f6a3a2f1b10", status: "cancelled", item: "lesson" },
      { ...SALE, id: "33333333-7c5c-4a43-9d4c-3f6a3a2f1b10", status: "pending", paidOn: null },
    ]);

    expect(markup).toContain("Cobrada");
    expect(markup).toContain("Cancelada");
    expect(markup).toContain("Pendiente");
    expect(markup).toContain("Sin fecha");
    expect(markup).toContain("USD 120,00");
    expect(markup).toContain(`href="/admin/ventas/${SALE.id}"`);
    expect(markup).toContain('href="/admin/ventas/22222222-7c5c-4a43-9d4c-3f6a3a2f1b10"');
  });

  test("explains that only collected or delivered sales add up", () => {
    expect(history([SALE])).toContain("Solo cuentan las ventas cobradas o entregadas");
  });

  test("keeps the charged currency's own symbol and shows the 'Otro' description", () => {
    const markup = history([
      { ...SALE, currency: "BRL", amountMinor: 10000, amountUsdMinor: 1867, item: "other", description: "Revisión de clip" },
    ]);

    expect(markup).toContain("R$ 100,00");
    expect(markup).toContain("USD 18,67");
    expect(markup).toContain("Revisión de clip");
  });

  test("the history scrolls inside its own region that a keyboard can reach", () => {
    expect(history([SALE])).toMatch(/<div[^>]*role="region"[^>]*aria-label="Ventas del alumno"[^>]*tabindex="0"/);
  });
});
