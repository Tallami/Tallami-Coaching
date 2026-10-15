import { beforeAll, describe, expect, test } from "vitest";
import { createCustomer } from "@/admin/customers/repository";
import { isIncome, computeKpis } from "@/admin/metrics/kpis";
import { loadMetricSales } from "@/admin/metrics/load";
import { monotributoStatus } from "@/admin/metrics/monotributo";
import { pendingWork } from "@/admin/metrics/pending";
import { PERIODS, periodRange } from "@/admin/metrics/period";
import {
  incomeByCountry,
  incomeByItem,
  incomeByPaymentMethod,
  itemsWithoutSales,
  monthlyIncome,
} from "@/admin/metrics/series";
import type { Db } from "@/db/client";
import { sales, type NewSale } from "@/db/schema";
import { createTestDb } from "../helpers/db";
import { NOW } from "../helpers/metric-sales";

// Con "ahora" = 13/10/2026, la ventana empieza el 1/11/2024: 24 meses de
// calendario contando octubre de 2026.
const WINDOW_START = "2024-11-01";
/** Una venta ya entregada: no es trabajo pendiente, así que solo se carga si otra regla lo pide. */
const DELIVERED = { status: "delivered", deliveredAt: new Date("2025-01-01T12:00:00.000Z") } as const;

describe("loadMetricSales", () => {
  let db: Db;
  /** El id de cada venta de prueba, por la etiqueta con que se la creó. */
  const saleIds = new Map<string, string>();
  const customerIds = new Map<string, string>();

  async function addCustomer(name: string, country: string | null): Promise<void> {
    const { id } = await createCustomer(db, { name, country });
    customerIds.set(name, id);
  }

  /** Una venta cobrada de 40 dólares el 5/10/2026 sin factura que emitir; cada una cambia lo que prueba. */
  async function addSale(label: string, customer: string, values: Partial<NewSale>): Promise<void> {
    const [row] = await db
      .insert(sales)
      .values({
        customerId: customerIds.get(customer) as string,
        item: "lesson",
        currency: "USD",
        amountMinor: 4000,
        arsPerUnit: "1500.0000",
        arsPerUsd: "1500.0000",
        rateSource: "fixed",
        amountArsMinor: 6_000_000,
        amountUsdMinor: 4000,
        paymentMethod: "transfer",
        status: "paid",
        paidOn: "2026-10-05",
        invoiceStatus: "not_required",
        notes: label,
        ...values,
      })
      .returning({ id: sales.id });
    saleIds.set(label, row.id);
  }

  const idOf = (label: string): string => saleIds.get(label) as string;

  beforeAll(async () => {
    db = await createTestDb();
    await addCustomer("Ana", "AR");
    await addCustomer("Bruno", null);
    await addCustomer("Carla", "BR");
    await addCustomer("Dario", "MX");
    await addCustomer("Edu", "AR");
    await addCustomer("Fran", "AR");

    // Ana: compró en 2023, dos veces cerca del borde de la ventana y en octubre.
    await addSale("ana-2023", "Ana", { paidOn: "2023-05-10", ...DELIVERED });
    await addSale("ana-before-window", "Ana", { paidOn: "2024-10-31", item: "vodRecorded", ...DELIVERED });
    await addSale("ana-window-start", "Ana", { paidOn: WINDOW_START, ...DELIVERED });
    await addSale("ana-october", "Ana", { paidOn: "2026-10-05" });
    // Bruno: dos ventas viejas, una sin facturar (se carga igual) y otra ya facturada (no).
    await addSale("bruno-old-unbilled", "Bruno", {
      paidOn: "2024-02-01",
      item: "gamePlan",
      ...DELIVERED,
      amountUsdMinor: 12_000,
      amountArsMinor: 18_000_000,
      invoiceStatus: "pending",
    });
    await addSale("bruno-older", "Bruno", { paidOn: "2022-06-01", ...DELIVERED });
    // Carla: una cobrada y sin entregar de hace tiempo (se carga) y una entregada.
    await addSale("carla-old-undelivered", "Carla", { paidOn: "2024-03-01", item: "proSeason" });
    await addSale("carla-delivered", "Carla", {
      paidOn: "2026-09-20",
      status: "delivered",
      deliveredAt: new Date("2026-09-21T15:00:00.000Z"),
    });
    // Darío: solo una venta vieja y entregada, y una cancelada: no entra nada.
    await addSale("dario-old-delivered", "Dario", { paidOn: "2023-01-01", ...DELIVERED });
    await addSale("dario-cancelled", "Dario", { paidOn: "2026-09-01", status: "cancelled" });
    // Edu: una pendiente sin fecha, una reembolsada, una sesión cobrada sin facturar y
    // dos sesiones sin cobrar (una pendiente de hacer y otra ya hecha).
    await addSale("edu-pending", "Edu", { status: "pending", paidOn: null });
    await addSale("edu-unpaid-session", "Edu", {
      status: "pending",
      paidOn: null,
      item: "lesson",
      dueAt: new Date("2026-10-16T18:00:00.000Z"),
      invoiceStatus: "pending",
      amountMinor: 99_900,
      amountUsdMinor: 99_900,
      amountArsMinor: 149_850_000,
    });
    await addSale("edu-unpaid-done", "Edu", {
      status: "pending",
      paidOn: null,
      dueAt: new Date("2026-10-16T18:00:00.000Z"),
      deliveredAt: new Date("2026-10-16T19:00:00.000Z"),
    });
    await addSale("edu-refunded", "Edu", { status: "refunded", paidOn: "2026-09-02" });
    await addSale("edu-session", "Edu", {
      paidOn: "2026-10-10",
      item: "vodLive",
      dueAt: new Date("2026-10-15T18:00:00.000Z"),
      invoiceStatus: "pending",
    });
    // Fran: dos compras viejas y una de octubre.
    await addSale("fran-2023-june", "Fran", { paidOn: "2023-06-01", ...DELIVERED });
    await addSale("fran-2023-july", "Fran", { paidOn: "2023-07-01", ...DELIVERED });
    await addSale("fran-october", "Fran", { paidOn: "2026-10-02" });
  });

  test("loads 24 months, open items and returning customers' first purchase, oldest first", async () => {
    const loaded = await loadMetricSales(db, NOW);

    expect(loaded.map((entry) => entry.id)).toEqual(
      [
        "ana-2023", // la primera compra de Ana, que ya había comprado antes de la ventana
        "fran-2023-june", // la primera compra de Fran
        "bruno-old-unbilled", // vieja pero sin facturar
        "carla-old-undelivered", // vieja pero sin entregar
        "ana-window-start", // el primer día de la ventana
        "carla-delivered",
        "fran-october",
        "ana-october",
        "edu-session",
        "edu-unpaid-session", // sin cobrar y con fecha: sin día de cobro, va al final
      ].map(idOf),
    );
  });

  test("leaves out what no metric reads", async () => {
    const loaded = new Set((await loadMetricSales(db, NOW)).map((entry) => entry.id));

    for (const label of [
      "ana-before-window", // vieja y no es la primera de Ana
      "bruno-older", // vieja, entregada y sin factura que emitir
      "dario-old-delivered", // vieja y Darío no compró en la ventana
      "dario-cancelled",
      "edu-pending", // sin cobrar y sin fecha de sesión
      "edu-unpaid-done", // sin cobrar pero ya hecha
      "edu-refunded",
      "fran-2023-july", // vieja y no es la primera de Fran
    ]) {
      expect(loaded.has(idOf(label)), label).toBe(false);
    }
  });

  test("builds the sale the metrics read, with the country of the student", async () => {
    const loaded = await loadMetricSales(db, NOW);
    const byId = new Map(loaded.map((entry) => [entry.id, entry]));

    expect(byId.get(idOf("edu-session"))).toEqual({
      id: idOf("edu-session"),
      customerId: customerIds.get("Edu"),
      customerName: "Edu",
      item: "vodLive",
      status: "paid",
      paidOn: "2026-10-10",
      dueAt: "2026-10-15T18:00:00.000Z",
      deliveredAt: null,
      amountArsMinor: 6_000_000,
      amountUsdMinor: 4000,
      paymentMethod: "transfer",
      country: "AR",
      invoiceStatus: "pending",
    });
    expect(byId.get(idOf("carla-delivered"))).toMatchObject({
      status: "delivered",
      deliveredAt: "2026-09-21T15:00:00.000Z",
      dueAt: null,
      country: "BR",
    });
    expect(byId.get(idOf("bruno-old-unbilled"))).toMatchObject({
      country: null,
      amountUsdMinor: 12_000,
      amountArsMinor: 18_000_000,
      invoiceStatus: "pending",
    });
  });

  test("an unpaid sale with a date comes with what the pending list needs", async () => {
    const loaded = await loadMetricSales(db, NOW);
    expect(loaded.find((entry) => entry.id === idOf("edu-unpaid-session"))).toEqual({
      id: idOf("edu-unpaid-session"),
      customerId: customerIds.get("Edu"),
      customerName: "Edu",
      item: "lesson",
      status: "pending",
      paidOn: null,
      dueAt: "2026-10-16T18:00:00.000Z",
      deliveredAt: null,
      amountArsMinor: 149_850_000,
      amountUsdMinor: 99_900,
      paymentMethod: "transfer",
      country: "AR",
      invoiceStatus: "pending",
    });
    const sessions = pendingWork(loaded, NOW).sessions;
    expect(sessions.map((session) => [session.id, session.unpaid, session.customerName])).toEqual([
      [idOf("edu-session"), false, "Edu"],
      [idOf("edu-unpaid-session"), true, "Edu"],
    ]);
  });

  test("unpaid sales change no income number", async () => {
    const loaded = await loadMetricSales(db, NOW);
    const incomeOnly = loaded.filter(isIncome);
    expect(loaded.length).toBeGreaterThan(incomeOnly.length);
    expect(loaded.some((entry) => entry.status === "pending")).toBe(true);

    for (const period of PERIODS) {
      expect(computeKpis(loaded, period, NOW), period).toEqual(computeKpis(incomeOnly, period, NOW));
      const range = periodRange(period, NOW);
      expect(incomeByItem(loaded, range), period).toEqual(incomeByItem(incomeOnly, range));
      expect(incomeByPaymentMethod(loaded, range), period).toEqual(
        incomeByPaymentMethod(incomeOnly, range),
      );
      expect(incomeByCountry(loaded, range), period).toEqual(incomeByCountry(incomeOnly, range));
    }
    expect(monthlyIncome(loaded, 24, NOW)).toEqual(monthlyIncome(incomeOnly, 24, NOW));
    expect(itemsWithoutSales(loaded, 90, NOW)).toEqual(itemsWithoutSales(incomeOnly, 90, NOW));
    const settings = { category: "A", annualCapArsMinor: 1_000_000_000, validFrom: "2026-08-01" };
    expect(monotributoStatus(loaded, settings, NOW)).toEqual(
      monotributoStatus(incomeOnly, settings, NOW),
    );
    expect(pendingWork(loaded, NOW).uninvoiced).toEqual(pendingWork(incomeOnly, NOW).uninvoiced);
    // El monto de la sesión sin cobrar (999 dólares) no aparece en ningún lado.
    expect(computeKpis(loaded, "thisMonth", NOW).incomeUsdMinor).toBe(12_000);
  });

  test("amounts come back as numbers", async () => {
    const loaded = await loadMetricSales(db, NOW);
    for (const entry of loaded) {
      expect(typeof entry.amountArsMinor).toBe("number");
      expect(typeof entry.amountUsdMinor).toBe("number");
    }
  });

  test("the window follows the Argentine month, not the UTC one", async () => {
    // 31/10 22:30 en Argentina (1/11 01:30 UTC): todavía es octubre y la ventana empieza el 1/11/2024.
    const stillOctober = await loadMetricSales(db, new Date("2026-11-01T01:30:00.000Z"));
    expect(stillOctober.map((entry) => entry.id)).toContain(idOf("ana-window-start"));
    // Tres horas después ya es noviembre: la ventana empieza el 1/12/2024 y esa venta pasa a ser vieja.
    const november = await loadMetricSales(db, new Date("2026-11-01T03:00:00.000Z"));
    expect(november.map((entry) => entry.id)).not.toContain(idOf("ana-window-start"));
    expect(november.map((entry) => entry.id)).toContain(idOf("ana-2023"));
  });

  test("a customer who bought before the window is a repeat customer, not a new one", async () => {
    const kpis = computeKpis(await loadMetricSales(db, NOW), "thisMonth", NOW);

    // Octubre: Ana, Edu y Fran. Ana y Fran ya habían comprado; Edu no.
    expect(kpis.salesCount).toBe(3);
    expect(kpis.incomeUsdMinor).toBe(12_000);
    expect(kpis.newCustomers).toBe(1);
    expect(kpis.repeatRatePct).toBe(66.7);
  });

  test("an empty database has no sales", async () => {
    expect(await loadMetricSales(await createTestDb(), NOW)).toEqual([]);
  });
});
