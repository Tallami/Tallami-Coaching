import { count, eq } from "drizzle-orm";
import { beforeAll, describe, expect, test } from "vitest";
import {
  CustomerNotFoundError,
  createCustomer,
  getCustomer,
  listCustomersWithStats,
  searchCustomers,
  updateCustomer,
} from "@/admin/customers/repository";
import type { SaleRates } from "@/admin/sales/rates";
import { createSale } from "@/admin/sales/repository";
import { saleInputSchema } from "@/admin/sales/schema";
import type { Db } from "@/db/client";
import { customers, sales } from "@/db/schema";
import { createTestDb } from "../helpers/db";

const RATES_1500: SaleRates = {
  arsPerUnit: "1500.0000",
  arsPerUsd: "1500.0000",
  source: "fixed",
  quotedOn: "2026-10-12",
};
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

/** Carga una venta de un alumno que ya existe; cada test cambia solo lo que prueba. */
async function sell(
  db: Db,
  customerId: string,
  overrides: Record<string, unknown> = {},
  rates: SaleRates = RATES_1500,
): Promise<void> {
  const input = saleInputSchema.parse({
    customer: { mode: "existing", id: customerId },
    item: "lesson",
    currency: "USD",
    amount: "40",
    paymentMethod: "transfer",
    status: "paid",
    paidOn: "2026-10-12",
    rateMode: "auto",
    ...overrides,
  });
  await createSale(db, input, rates);
}

describe("customers repository", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
    await createCustomer(db, { name: "Ana Pérez", discord: "ana.fn", country: "AR" });
    await createCustomer(db, { name: "Bruno Souza", discord: "Bruninho", country: "BR" });
    await createCustomer(db, { name: "Carla 100%", country: "MX" });
    await createCustomer(db, { name: "Diego_Ruiz" });
    for (let index = 1; index <= 10; index += 1) {
      await createCustomer(db, { name: `Lote ${String(index).padStart(2, "0")}` });
    }
  });

  test("creates a student and gives back its id", async () => {
    const before = await db.select({ total: count() }).from(customers);

    const { id } = await createCustomer(db, { name: "Elena", discord: "elena", country: "ar" });

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const after = await db.select({ total: count() }).from(customers);
    expect(after[0].total).toBe(before[0].total + 1);
    const [found] = await searchCustomers(db, "Elena");
    expect(found).toEqual({ id, name: "Elena", discord: "elena", country: "AR" });
  });

  test("searches by name or discord without caring about case", async () => {
    expect((await searchCustomers(db, "ana")).map((c) => c.name)).toContain("Ana Pérez");
    expect((await searchCustomers(db, "ANA PÉREZ")).map((c) => c.name)).toEqual(["Ana Pérez"]);
    // Las mayúsculas se igualan también con acentos; los acentos en sí, no.
    expect(await searchCustomers(db, "perez")).toEqual([]);
    expect((await searchCustomers(db, "bruninho")).map((c) => c.name)).toEqual(["Bruno Souza"]);
    expect((await searchCustomers(db, "  souza  ")).map((c) => c.name)).toEqual(["Bruno Souza"]);
  });

  test("treats % and _ in the text as plain characters", async () => {
    expect((await searchCustomers(db, "100%")).map((c) => c.name)).toEqual(["Carla 100%"]);
    expect((await searchCustomers(db, "%")).map((c) => c.name)).toEqual(["Carla 100%"]);
    expect((await searchCustomers(db, "o_r")).map((c) => c.name)).toEqual(["Diego_Ruiz"]);
    expect(await searchCustomers(db, "\\")).toEqual([]);
  });

  test("a NUL character in the search is ignored instead of breaking the query", async () => {
    expect((await searchCustomers(db, "souza\u0000")).map((c) => c.name)).toEqual(["Bruno Souza"]);
    expect((await searchCustomers(db, "\u0000")).length).toBeGreaterThan(0);
  });

  test("answers at most eight students by default, ordered by name", async () => {
    const found = await searchCustomers(db, "Lote");

    expect(found).toHaveLength(8);
    expect(found.map((c) => c.name)).toEqual([
      "Lote 01",
      "Lote 02",
      "Lote 03",
      "Lote 04",
      "Lote 05",
      "Lote 06",
      "Lote 07",
      "Lote 08",
    ]);
    expect(await searchCustomers(db, "Lote", 3)).toHaveLength(3);
  });

  test("an empty search lists the first students instead of everybody", async () => {
    const found = await searchCustomers(db, "   ");

    expect(found.length).toBeLessThanOrEqual(8);
    expect(found.length).toBeGreaterThan(0);
  });

  test("a missing discord or country stays empty", async () => {
    const [found] = await searchCustomers(db, "Diego_Ruiz");

    expect(found.discord).toBeNull();
    expect(found.country).toBeNull();
  });

  test("keeps the notes of a new student, and none when they are blank", async () => {
    const withNotes = await createCustomer(db, { name: "Fede notas", notes: "Paga su papá" });
    const withoutNotes = await createCustomer(db, { name: "Gina sin notas", notes: "" });

    const [first] = await db.select().from(customers).where(eq(customers.id, withNotes.id));
    const [second] = await db.select().from(customers).where(eq(customers.id, withoutNotes.id));
    expect(first.notes).toBe("Paga su papá");
    expect(second.notes).toBeNull();
  });
});

describe("listCustomersWithStats", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  test("customer stats count only income sales", async () => {
    const { id } = await createCustomer(db, { name: "Ana Stats", discord: "ana.stats", country: "AR" });
    await sell(db, id, { item: "lesson", status: "paid", paidOn: "2026-10-01", amount: "40" });
    await sell(db, id, { item: "vodRecorded", status: "delivered", paidOn: "2026-10-05", amount: "30" });
    // Ninguna de estas tres suma, aunque tengan fecha de cobro más nueva.
    await sell(db, id, { item: "gamePlan", status: "cancelled", paidOn: "2026-10-06", amount: "120" });
    await sell(db, id, { item: "proSeason", status: "refunded", paidOn: "2026-10-07", amount: "2500" });
    await sell(db, id, { item: "tournament", status: "pending", paidOn: undefined, amount: "150" });

    const found = (await listCustomersWithStats(db)).find((customer) => customer.id === id);

    expect(found).toEqual({
      id,
      name: "Ana Stats",
      discord: "ana.stats",
      country: "AR",
      purchases: 2,
      totalUsdMinor: 7000,
      firstPaidOn: "2026-10-01",
      lastPaidOn: "2026-10-05",
      // Sin repetir y en el orden del catálogo.
      items: ["vodRecorded", "lesson"],
    });
  });

  test("orders customers by last purchase, newest first, and the ones without purchases last", async () => {
    const fresh = await createTestDb();
    const make = async (name: string) => (await createCustomer(fresh, { name })).id;
    const abel = await make("Abel");
    const zoe = await make("Zoe");
    const maru = await make("Maru");
    await make("Nadie");
    const pablo = await make("Pablo pendiente");
    // Abel compró primero pero también compró hace poco: cuenta la última, no la primera.
    await sell(fresh, abel, { paidOn: "2026-01-01" });
    await sell(fresh, abel, { paidOn: "2026-10-03" });
    await sell(fresh, zoe, { paidOn: "2026-10-10" });
    await sell(fresh, maru, { paidOn: "2026-10-10" });
    await sell(fresh, pablo, { status: "pending", paidOn: undefined });

    const names = (await listCustomersWithStats(fresh)).map((customer) => customer.name);

    // Zoe y Maru empatan en el día: desempata el nombre. Nadie y Pablo no compraron: al final, por nombre.
    expect(names).toEqual(["Maru", "Zoe", "Abel", "Nadie", "Pablo pendiente"]);
  });

  test("a sale collected after today (Argentina) does not count yet: not in purchases, total, dates or services", async () => {
    // El 12 de octubre a las 12:00 en Argentina.
    const now = new Date("2026-10-12T15:00:00Z");
    const { id } = await createCustomer(db, { name: "Ana Futuro" });
    await sell(db, id, { item: "lesson", paidOn: "2026-10-10", amount: "40" });
    // Hoy sí cuenta; mañana no, aunque ya esté cobrada o entregada.
    await sell(db, id, { item: "vodRecorded", paidOn: "2026-10-12", amount: "30" });
    await sell(db, id, { item: "gamePlan", status: "paid", paidOn: "2026-10-13", amount: "120" });
    await sell(db, id, { item: "proSeason", status: "delivered", paidOn: "2026-12-01", amount: "2500" });

    const found = (await listCustomersWithStats(db, undefined, now)).find((customer) => customer.id === id);

    expect(found).toMatchObject({
      purchases: 2,
      totalUsdMinor: 7000,
      firstPaidOn: "2026-10-10",
      lastPaidOn: "2026-10-12",
      items: ["vodRecorded", "lesson"],
    });
  });

  test("the sale starts to count on its own day, by the Argentine calendar and not the UTC one", async () => {
    const { id } = await createCustomer(db, { name: "Borde del día" });
    await sell(db, id, { paidOn: "2026-10-13", amount: "40" });
    const totalAt = async (now: Date) =>
      (await listCustomersWithStats(db, undefined, now)).find((customer) => customer.id === id)?.totalUsdMinor;

    // 23:00 del 12 en Argentina ya es el 13 en UTC: para el negocio todavía es el 12.
    expect(await totalAt(new Date("2026-10-13T02:00:00Z"))).toBe(0);
    // 00:30 del 13 en Argentina.
    expect(await totalAt(new Date("2026-10-13T03:30:00Z"))).toBe(4000);
  });

  test("a student whose only collected sale is in the future sorts with the ones who have not bought", async () => {
    const fresh = await createTestDb();
    const now = new Date("2026-10-12T15:00:00Z");
    const make = async (name: string) => (await createCustomer(fresh, { name })).id;
    const abel = await make("Abel");
    const zoe = await make("Zoe");
    const futuro = await make("Futuro");
    await sell(fresh, abel, { paidOn: "2026-10-03" });
    await sell(fresh, zoe, { paidOn: "2026-10-10" });
    // Con su fecha de cobro dentro de un mes, antes quedaba primero de la lista.
    await sell(fresh, futuro, { paidOn: "2026-11-12" });

    const names = (await listCustomersWithStats(fresh, undefined, now)).map((customer) => customer.name);

    expect(names).toEqual(["Zoe", "Abel", "Futuro"]);
  });

  test("a student without income sales is listed with zeros and no dates", async () => {
    const { id } = await createCustomer(db, { name: "Pablo sin compras" });
    await sell(db, id, { status: "pending", paidOn: undefined });

    const found = (await listCustomersWithStats(db)).find((customer) => customer.id === id);

    expect(found).toMatchObject({
      purchases: 0,
      totalUsdMinor: 0,
      firstPaidOn: null,
      lastPaidOn: null,
      items: [],
    });
  });

  test("sums big amounts as plain numbers, not as text", async () => {
    const { id } = await createCustomer(db, { name: "Rico Grande" });
    // 40.000.000 USD = 4.000.000.000 centavos cada una: la suma pasa los 2^31 de un entero de 32 bits.
    await sell(db, id, { amount: "40000000", paidOn: "2026-09-01" });
    await sell(db, id, { amount: "40000000", paidOn: "2026-09-02" });

    const found = (await listCustomersWithStats(db)).find((customer) => customer.id === id);

    expect(found?.totalUsdMinor).toBe(8_000_000_000);
    expect(typeof found?.totalUsdMinor).toBe("number");
    expect(typeof found?.purchases).toBe("number");
  });

  test("counts the dollars saved on each sale, whatever the currency it was paid in", async () => {
    const { id } = await createCustomer(db, { name: "Bruno Real" });
    // Con el dólar y el real a 1500 pesos, y el peso a 1.
    await sell(db, id, { currency: "BRL", amount: "100", paidOn: "2026-09-10" });
    await sell(db, id, { currency: "ARS", amount: "150000", paidOn: "2026-09-11" }, { ...RATES_1500, arsPerUnit: "1.0000" });

    const found = (await listCustomersWithStats(db)).find((customer) => customer.id === id);

    // R$ 100 = $ 150.000 = USD 100; y $ 150.000 = USD 100.
    expect(found?.totalUsdMinor).toBe(20_000);
  });

  test("searches by name or discord, with the text taken literally", async () => {
    await createCustomer(db, { name: "Carla 100%", discord: "carla_x" });
    await createCustomer(db, { name: "Diego Ruiz", discord: "dieguito" });

    expect((await listCustomersWithStats(db, "dieguito")).map((c) => c.name)).toEqual(["Diego Ruiz"]);
    expect((await listCustomersWithStats(db, "  RUIZ ")).map((c) => c.name)).toEqual(["Diego Ruiz"]);
    expect((await listCustomersWithStats(db, "100%")).map((c) => c.name)).toEqual(["Carla 100%"]);
    expect((await listCustomersWithStats(db, "%")).map((c) => c.name)).toEqual(["Carla 100%"]);
    expect(await listCustomersWithStats(db, "no existe")).toEqual([]);
  });

  test("a blank or NUL-only search lists everybody instead of breaking the query", async () => {
    const everybody = await listCustomersWithStats(db);

    expect(await listCustomersWithStats(db, "   ")).toEqual(everybody);
    expect(await listCustomersWithStats(db, "\u0000")).toEqual(everybody);
    expect((await listCustomersWithStats(db, "Ruiz\u0000")).map((c) => c.name)).toEqual(["Diego Ruiz"]);
  });
});

describe("getCustomer", () => {
  let db: Db;
  let id: string;

  beforeAll(async () => {
    db = await createTestDb();
    ({ id } = await createCustomer(db, {
      name: "Eli Historia",
      discord: "eli.h",
      country: "mx",
      notes: "Juega duos con su hermano",
    }));
    await sell(db, id, { item: "lesson", status: "paid", paidOn: "2026-10-01", amount: "40" });
    await sell(db, id, { item: "vodRecorded", status: "delivered", paidOn: "2026-10-05", amount: "30" });
    await sell(db, id, { item: "gamePlan", status: "cancelled", paidOn: "2026-10-06", amount: "120" });
    await sell(db, id, { item: "proSeason", status: "refunded", paidOn: "2026-10-07", amount: "2500" });
    await sell(db, id, { item: "tournament", status: "pending", paidOn: undefined, amount: "150" });
    // Una venta de otro alumno no entra en esta ficha.
    const other = await createCustomer(db, { name: "Otro alumno" });
    await sell(db, other.id, { item: "vodLive", paidOn: "2026-10-08" });
  });

  test("gives the profile, the income stats and the whole sales history with each status", async () => {
    const customer = await getCustomer(db, id);

    expect(customer).toMatchObject({
      id,
      name: "Eli Historia",
      discord: "eli.h",
      country: "MX",
      notes: "Juega duos con su hermano",
      purchases: 2,
      totalUsdMinor: 7000,
      firstPaidOn: "2026-10-01",
      lastPaidOn: "2026-10-05",
      items: ["vodRecorded", "lesson"],
    });
    // Todas las ventas, con su estado: la pendiente (sin día de cobro) arriba y después de la más nueva a la más vieja.
    expect(customer?.sales.map((sale) => [sale.item, sale.status, sale.amountUsdMinor])).toEqual([
      ["tournament", "pending", 15_000],
      ["proSeason", "refunded", 250_000],
      ["gamePlan", "cancelled", 12_000],
      ["vodRecorded", "delivered", 3000],
      ["lesson", "paid", 4000],
    ]);
    expect(customer?.sales.every((sale) => sale.customerId === id)).toBe(true);
  });

  test("the stats leave out a sale collected after today but the history still lists it", async () => {
    const now = new Date("2026-10-12T15:00:00Z");
    const { id: future } = await createCustomer(db, { name: "Fran Futuro" });
    await sell(db, future, { item: "lesson", paidOn: "2026-10-10", amount: "40" });
    await sell(db, future, { item: "gamePlan", status: "paid", paidOn: "2026-10-20", amount: "120" });

    const customer = await getCustomer(db, future, now);

    expect(customer).toMatchObject({
      purchases: 1,
      totalUsdMinor: 4000,
      firstPaidOn: "2026-10-10",
      lastPaidOn: "2026-10-10",
      items: ["lesson"],
    });
    // La ficha muestra todas las ventas, también la que todavía no cuenta.
    expect(customer?.sales.map((sale) => sale.item)).toEqual(["gamePlan", "lesson"]);
  });

  test("a student with no sales has an empty history", async () => {
    const { id: lonely } = await createCustomer(db, { name: "Sin ventas" });

    expect(await getCustomer(db, lonely)).toMatchObject({
      name: "Sin ventas",
      purchases: 0,
      totalUsdMinor: 0,
      notes: null,
      sales: [],
    });
  });

  test("is null for an id that does not exist or is not an id", async () => {
    expect(await getCustomer(db, UNKNOWN_ID)).toBeNull();
    expect(await getCustomer(db, "no-es-un-id")).toBeNull();
    expect(await getCustomer(db, "")).toBeNull();
  });
});

describe("updateCustomer", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  test("changes the name, discord, country and notes, and leaves the sales alone", async () => {
    const { id } = await createCustomer(db, { name: "Hugo", discord: "hugo.viejo", country: "AR" });
    await sell(db, id, { paidOn: "2026-10-02" });

    const result = await updateCustomer(db, id, {
      name: "Hugo Nuevo",
      discord: "hugo.nuevo",
      country: " br ",
      notes: "Prefiere los sábados",
    });

    expect(result).toEqual({ id });
    const customer = await getCustomer(db, id);
    expect(customer).toMatchObject({
      name: "Hugo Nuevo",
      discord: "hugo.nuevo",
      country: "BR",
      notes: "Prefiere los sábados",
      purchases: 1,
      totalUsdMinor: 4000,
    });
    expect(customer?.sales).toHaveLength(1);
    const [{ total }] = await db.select({ total: count() }).from(sales).where(eq(sales.customerId, id));
    expect(total).toBe(1);
  });

  test("empty values clear the discord, the country and the notes", async () => {
    const { id } = await createCustomer(db, {
      name: "Iris",
      discord: "iris",
      country: "MX",
      notes: "nota",
    });

    await updateCustomer(db, id, { name: "Iris", discord: "", country: "", notes: "" });

    expect(await getCustomer(db, id)).toMatchObject({ discord: null, country: null, notes: null });
    await updateCustomer(db, id, { name: "Iris" });
    expect(await getCustomer(db, id)).toMatchObject({ discord: null, country: null, notes: null });
  });

  test("rejects a country that is not two letters, and changes nothing", async () => {
    const { id } = await createCustomer(db, { name: "Javi", country: "AR" });

    await expect(updateCustomer(db, id, { name: "Javi", country: "ARG" })).rejects.toThrow(RangeError);

    expect(await getCustomer(db, id)).toMatchObject({ name: "Javi", country: "AR" });
  });

  test("tells when the student is not there", async () => {
    await expect(updateCustomer(db, UNKNOWN_ID, { name: "Nadie" })).rejects.toThrow(CustomerNotFoundError);
    await expect(updateCustomer(db, "no-es-un-id", { name: "Nadie" })).rejects.toThrow(CustomerNotFoundError);
  });
});
