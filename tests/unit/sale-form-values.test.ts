import { describe, expect, test } from "vitest";
import type { SaleRow } from "@/admin/sales/repository";
import { parseRateInput } from "@/lib/money";
import {
  customerLabel,
  emptySaleFormValues,
  saleToFormValues,
} from "@/admin/sales/form-values";

const SALE: SaleRow = {
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
  notes: null,
  createdAt: new Date("2026-10-12T15:00:00Z"),
  updatedAt: new Date("2026-10-12T15:00:00Z"),
};

describe("emptySaleFormValues", () => {
  test("starts a collected dollar sale today with the official rate", () => {
    expect(emptySaleFormValues("2026-10-14", true)).toMatchObject({
      currency: "USD",
      status: "paid",
      paidOn: "2026-10-14",
      rateMode: "auto",
      item: "",
      amount: "",
      paymentMethod: "",
    });
  });

  test("searches an existing student when there are some, and creates one when there are none", () => {
    expect(emptySaleFormValues("2026-10-14", true).customerMode).toBe("existing");
    expect(emptySaleFormValues("2026-10-14", false).customerMode).toBe("new");
  });
});

describe("saleToFormValues", () => {
  test("writes the saved sale as the text a person would type", () => {
    expect(saleToFormValues(SALE)).toMatchObject({
      customerMode: "existing",
      customerId: SALE.customerId,
      customerLabel: "Ana Pérez (ana.fn)",
      item: "gamePlan",
      currency: "USD",
      amount: "120",
      paymentMethod: "mercadopago",
      status: "paid",
      paidOn: "2026-10-12",
      dueAt: "",
      deliveredAt: "",
      notes: "",
    });
  });

  test("keeps the cents of an amount, padded to two digits", () => {
    expect(saleToFormValues({ ...SALE, amountMinor: 12050 }).amount).toBe("120,50");
    expect(saleToFormValues({ ...SALE, amountMinor: 12005 }).amount).toBe("120,05");
    expect(saleToFormValues({ ...SALE, amountMinor: 5 }).amount).toBe("0,05");
    expect(saleToFormValues({ ...SALE, amountMinor: 123_400 }).amount).toBe("1234");
  });

  test("shows the dates and times as Argentine wall clock", () => {
    const values = saleToFormValues({
      ...SALE,
      dueAt: new Date("2026-10-20T18:00:00Z"),
      deliveredAt: new Date("2026-11-01T01:00:00Z"),
    });

    expect(values.dueAt).toBe("2026-10-20T15:00");
    expect(values.deliveredAt).toBe("2026-10-31T22:00");
  });

  test("an official rate stays out of the manual fields and a manual one fills them", () => {
    const official = saleToFormValues(SALE);
    expect(official).toMatchObject({ rateMode: "auto", arsPerUnit: "", arsPerUsd: "" });

    const manual = saleToFormValues({
      ...SALE,
      currency: "BRL",
      rateSource: "manual",
      arsPerUnit: "280.5000",
      arsPerUsd: "1400.0000",
    });
    expect(manual).toMatchObject({ rateMode: "manual", arsPerUnit: "280,5", arsPerUsd: "1400" });
  });

  test.each([
    "59.8750",
    "281.2550",
    "1.0010",
    "12.1230",
    "0.1230",
    "1517.0000",
    "280.5000",
    "0.1234",
    "99999.9990",
    "100.0000",
    "1400.0500",
  ])("a manual rate of %s saved by the app is accepted again when the sale is re-saved", (stored) => {
    const values = saleToFormValues({
      ...SALE,
      currency: "BRL",
      rateSource: "manual",
      arsPerUnit: stored,
      arsPerUsd: stored,
    });

    // El texto que vuelve al formulario tiene que entrar de nuevo, sin avisos de "ambiguo", y dar lo mismo.
    expect(parseRateInput(values.arsPerUnit)).toBe(stored);
    expect(parseRateInput(values.arsPerUsd)).toBe(stored);
  });

  test("a rate with three decimals keeps a fourth zero so it is not mistaken for thousands", () => {
    const values = saleToFormValues({ ...SALE, rateSource: "manual", arsPerUsd: "59.8750" });

    expect(values.arsPerUsd).toBe("59,8750");
  });

  test("a description and notes come back as text", () => {
    const values = saleToFormValues({ ...SALE, item: "other", description: "Clips", notes: "Pagó 2 veces" });

    expect(values).toMatchObject({ item: "other", description: "Clips", notes: "Pagó 2 veces" });
  });
});

describe("customerLabel", () => {
  test("adds the discord when there is one", () => {
    expect(customerLabel("Ana", "ana.fn")).toBe("Ana (ana.fn)");
    expect(customerLabel("Ana", null)).toBe("Ana");
  });
});
