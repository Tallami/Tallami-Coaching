import { describe, expect, test } from "vitest";
import { monotributoStatus, monotributoWindow } from "@/admin/metrics/monotributo";
import { pendingWork } from "@/admin/metrics/pending";
import { NOW, ids, sale } from "../helpers/metric-sales";

// NOW es el martes 13/10/2026 a las 15:00 en Argentina. Ese día empezó a las
// 03:00 UTC (2026-10-13T03:00:00.000Z) y los próximos 7 días terminan en
// 2026-10-20T18:00:00.000Z.
const START_OF_TODAY = "2026-10-13T03:00:00.000Z";

describe("pending work", () => {
  test("pending work: overdue deliveries, sessions in 7 days, uninvoiced totals", () => {
    const sales = [
      // Entregas: cobradas, VOD grabado o plan de juego, sin entregar.
      sale({
        id: "vod-overdue",
        item: "vodRecorded",
        customerId: "bruno",
        dueAt: "2026-10-12T18:00:00.000Z",
      }),
      sale({ id: "plan-soon", item: "gamePlan", dueAt: "2026-10-16T15:00:00.000Z" }),
      sale({ id: "plan-no-date", item: "gamePlan", dueAt: null }),
      sale({
        id: "vod-done",
        item: "vodRecorded",
        dueAt: "2026-10-10T18:00:00.000Z",
        deliveredAt: "2026-10-09T18:00:00.000Z",
      }),
      sale({
        id: "vod-delivered-status",
        item: "vodRecorded",
        status: "delivered",
        dueAt: "2026-10-10T18:00:00.000Z",
        deliveredAt: "2026-10-09T18:00:00.000Z",
      }),
      // Entregada según su estado aunque falte la fecha de entrega: no queda nada por hacer.
      sale({ id: "vod-delivered-no-date", item: "vodRecorded", status: "delivered" }),
      sale({
        id: "vod-cancelled",
        item: "vodRecorded",
        status: "cancelled",
        dueAt: "2026-10-01T18:00:00.000Z",
      }),
      // Sin cobrar no es una entrega pendiente (todavía no hay nada que entregar).
      sale({
        id: "plan-unpaid",
        item: "gamePlan",
        status: "pending",
        paidOn: null,
        dueAt: "2026-10-01T18:00:00.000Z",
      }),

      // Sesiones: de hoy (desde las 00:00 de Argentina) a dentro de 7 días, cobradas o sin cobrar.
      sale({ id: "lesson-tomorrow", item: "lesson", dueAt: "2026-10-14T20:00:00.000Z" }),
      sale({
        id: "lesson-unpaid",
        item: "lesson",
        customerId: "carla",
        status: "pending",
        paidOn: null,
        dueAt: "2026-10-14T20:00:00.000Z",
      }),
      sale({ id: "live-in-7-days", item: "vodLive", dueAt: "2026-10-20T18:00:00.000Z" }),
      sale({ id: "cup-too-far", item: "tournament", dueAt: "2026-10-20T18:00:01.000Z" }),
      // Más temprano hoy: sigue en la lista de sesiones.
      sale({ id: "pack-this-morning", item: "lessonPack", dueAt: "2026-10-13T12:00:00.000Z" }),
      sale({ id: "pro-right-now", item: "proSeason", dueAt: NOW.toISOString() }),
      sale({ id: "lesson-cancelled", item: "lesson", status: "cancelled", dueAt: "2026-10-14T20:00:00.000Z" }),
      sale({ id: "lesson-undated", item: "lesson", dueAt: null }),
      sale({
        id: "lesson-done",
        item: "lesson",
        dueAt: "2026-10-14T20:00:00.000Z",
        deliveredAt: "2026-10-13T12:00:00.000Z",
      }),

      // Para marcar: cobradas, sin entregar y con la sesión en un día anterior a hoy.
      sale({ id: "mark-yesterday", item: "lessonPack", dueAt: "2026-10-12T20:00:00.000Z" }),
      sale({
        id: "mark-old",
        item: "tournament",
        customerId: "dario",
        dueAt: "2026-09-01T15:00:00.000Z",
      }),
      sale({
        id: "mark-unpaid",
        item: "lesson",
        status: "pending",
        paidOn: null,
        dueAt: "2026-10-12T20:00:00.000Z",
      }),
      sale({
        id: "mark-done",
        item: "lesson",
        dueAt: "2026-10-12T20:00:00.000Z",
        deliveredAt: "2026-10-12T21:00:00.000Z",
      }),

      // Sin facturar: ingresos con la factura pendiente (cuenta cualquiera, entregada o no).
      sale({ id: "unbilled-1", item: "other", dollars: 40, invoiceStatus: "pending" }),
      sale({
        id: "unbilled-2",
        item: "other",
        status: "delivered",
        dollars: 30,
        invoiceStatus: "pending",
        deliveredAt: "2026-10-09T18:00:00.000Z",
      }),
      sale({ id: "billed", item: "other", dollars: 500, invoiceStatus: "issued" }),
      sale({ id: "not-required", item: "other", dollars: 500, invoiceStatus: "not_required" }),
      sale({
        id: "unbilled-cancelled",
        item: "other",
        status: "cancelled",
        dollars: 500,
        invoiceStatus: "pending",
      }),
    ];

    const work = pendingWork(sales, NOW);

    expect(work.deliveries).toEqual([
      {
        id: "vod-overdue",
        item: "vodRecorded",
        customerId: "bruno",
        customerName: "Bruno",
        dueAt: "2026-10-12T18:00:00.000Z",
        overdue: true,
      },
      {
        id: "plan-soon",
        item: "gamePlan",
        customerId: "ana",
        customerName: "Ana",
        dueAt: "2026-10-16T15:00:00.000Z",
        overdue: false,
      },
      {
        id: "plan-no-date",
        item: "gamePlan",
        customerId: "ana",
        customerName: "Ana",
        dueAt: null,
        overdue: false,
      },
    ]);
    expect(work.sessions).toEqual([
      {
        id: "pack-this-morning",
        item: "lessonPack",
        customerId: "ana",
        customerName: "Ana",
        dueAt: "2026-10-13T12:00:00.000Z",
        unpaid: false,
      },
      {
        id: "pro-right-now",
        item: "proSeason",
        customerId: "ana",
        customerName: "Ana",
        dueAt: "2026-10-13T18:00:00.000Z",
        unpaid: false,
      },
      {
        id: "lesson-tomorrow",
        item: "lesson",
        customerId: "ana",
        customerName: "Ana",
        dueAt: "2026-10-14T20:00:00.000Z",
        unpaid: false,
      },
      {
        id: "lesson-unpaid",
        item: "lesson",
        customerId: "carla",
        customerName: "Carla",
        dueAt: "2026-10-14T20:00:00.000Z",
        unpaid: true,
      },
      {
        id: "live-in-7-days",
        item: "vodLive",
        customerId: "ana",
        customerName: "Ana",
        dueAt: "2026-10-20T18:00:00.000Z",
        unpaid: false,
      },
    ]);
    // El pack de clases de ayer no está: es de varias sesiones y no se marca como una sola.
    expect(work.toMark).toEqual([
      {
        id: "mark-old",
        item: "tournament",
        customerId: "dario",
        customerName: "Dario",
        dueAt: "2026-09-01T15:00:00.000Z",
        unpaid: false,
      },
      {
        id: "mark-unpaid",
        item: "lesson",
        customerId: "ana",
        customerName: "Ana",
        dueAt: "2026-10-12T20:00:00.000Z",
        unpaid: true,
      },
    ]);
    expect(work.uninvoiced).toEqual({ count: 2, arsMinor: 10_500_000, usdMinor: 7000 });
  });

  test("a session earlier today is still a session until the Argentine day ends", () => {
    const sales = [
      sale({ id: "first-minute", item: "lesson", dueAt: START_OF_TODAY }),
      sale({ id: "this-morning", item: "lesson", dueAt: "2026-10-13T12:00:00.000Z" }),
      sale({ id: "last-night", item: "lesson", dueAt: "2026-10-13T02:59:59.000Z" }),
    ];

    const during = pendingWork(sales, NOW);
    expect(ids(during.sessions)).toEqual(["first-minute", "this-morning"]);
    expect(ids(during.toMark)).toEqual(["last-night"]);

    // 23:59:59 del 13 en Argentina: todo sigue igual.
    const lastSecond = pendingWork(sales, new Date("2026-10-14T02:59:59.000Z"));
    expect(ids(lastSecond.sessions)).toEqual(["first-minute", "this-morning"]);
    expect(ids(lastSecond.toMark)).toEqual(["last-night"]);

    // 00:00 del 14: lo de ayer pasa a "para marcar".
    const midnight = pendingWork(sales, new Date("2026-10-14T03:00:00.000Z"));
    expect(ids(midnight.sessions)).toEqual([]);
    expect(ids(midnight.toMark)).toEqual(["last-night", "first-minute", "this-morning"]);
  });

  test("an unpaid session is listed as unpaid, and a paid one is not", () => {
    const sales = [
      sale({ id: "paid", item: "lesson", dueAt: "2026-10-15T12:00:00.000Z" }),
      sale({
        id: "unpaid",
        item: "lesson",
        status: "pending",
        paidOn: null,
        dueAt: "2026-10-15T12:00:00.000Z",
      }),
    ];
    expect(pendingWork(sales, NOW).sessions.map((session) => [session.id, session.unpaid])).toEqual([
      ["paid", false],
      ["unpaid", true],
    ]);
  });

  test("past sessions to mark are the paid and the unpaid ones, never the cancelled or refunded", () => {
    const past = "2026-10-01T15:00:00.000Z";
    const sales = [
      sale({ id: "paid", item: "lesson", dueAt: past }),
      sale({ id: "unpaid", item: "lesson", status: "pending", paidOn: null, dueAt: past }),
      sale({ id: "cancelled", item: "lesson", status: "cancelled", dueAt: past }),
      sale({ id: "refunded", item: "lesson", status: "refunded", dueAt: past }),
      sale({ id: "delivered", item: "lesson", status: "delivered", dueAt: past }),
      sale({ id: "marked", item: "lesson", dueAt: past, deliveredAt: "2026-10-01T16:00:00.000Z" }),
      sale({
        id: "unpaid-marked",
        item: "lesson",
        status: "pending",
        paidOn: null,
        dueAt: past,
        deliveredAt: "2026-10-01T16:00:00.000Z",
      }),
      sale({ id: "undated", item: "lesson", dueAt: null }),
      sale({ id: "unpaid-undated", item: "lesson", status: "pending", paidOn: null, dueAt: null }),
      // Los VOD grabados y planes de juego son entregas, no sesiones.
      sale({ id: "delivery", item: "vodRecorded", dueAt: past }),
      sale({ id: "unpaid-delivery", item: "vodRecorded", status: "pending", paidOn: null, dueAt: past }),
      sale({ id: "other", item: "other", dueAt: past }),
    ];
    const work = pendingWork(sales, NOW);
    expect(work.toMark.map((entry) => [entry.id, entry.unpaid])).toEqual([
      ["paid", false],
      ["unpaid", true],
    ]);
    expect(ids(work.deliveries)).toEqual(["delivery"]);
  });

  test("an unpaid session from before today is flagged unpaid; today's is still a session", () => {
    const sales = [
      sale({ id: "yesterday", item: "vodLive", status: "pending", paidOn: null, dueAt: "2026-10-12T20:00:00.000Z" }),
      sale({ id: "last-night", item: "lesson", status: "pending", paidOn: null, dueAt: "2026-10-13T02:59:59.000Z" }),
      sale({ id: "this-morning", item: "lesson", status: "pending", paidOn: null, dueAt: START_OF_TODAY }),
    ];
    const work = pendingWork(sales, NOW);
    expect(work.toMark.map((entry) => [entry.id, entry.unpaid])).toEqual([
      ["yesterday", true],
      ["last-night", true],
    ]);
    expect(work.sessions.map((entry) => [entry.id, entry.unpaid])).toEqual([["this-morning", true]]);
  });

  test("a lesson pack and a pro season span many sessions, so they are never left to mark", () => {
    const past = "2026-10-01T15:00:00.000Z";
    const sales = [
      sale({ id: "pack", item: "lessonPack", dueAt: past }),
      sale({ id: "pack-unpaid", item: "lessonPack", status: "pending", paidOn: null, dueAt: past }),
      sale({ id: "pro", item: "proSeason", dueAt: past }),
      sale({ id: "pro-unpaid", item: "proSeason", status: "pending", paidOn: null, dueAt: past }),
      sale({ id: "pack-next", item: "lessonPack", dueAt: "2026-10-14T20:00:00.000Z" }),
      sale({ id: "pro-next", item: "proSeason", dueAt: "2026-10-15T20:00:00.000Z" }),
      sale({ id: "lesson", item: "lesson", dueAt: past }),
    ];
    const work = pendingWork(sales, NOW);
    expect(ids(work.toMark)).toEqual(["lesson"]);
    // Sí figuran como próximas sesiones cuando su fecha cae en los próximos 7 días.
    expect(ids(work.sessions)).toEqual(["pack-next", "pro-next"]);
  });

  test("sessions to mark go oldest first, paid and unpaid together, then by id", () => {
    const sales = [
      sale({ id: "c", item: "lesson", dueAt: "2026-10-10T12:00:00.000Z" }),
      sale({ id: "b", item: "tournament", dueAt: "2026-10-02T12:00:00.000Z" }),
      sale({ id: "a", item: "vodLive", dueAt: "2026-10-02T12:00:00.000Z" }),
      sale({ id: "z", item: "lesson", dueAt: "2025-01-02T12:00:00.000Z" }),
      sale({ id: "y", item: "lesson", status: "pending", paidOn: null, dueAt: "2025-06-01T12:00:00.000Z" }),
    ];
    expect(ids(pendingWork(sales, NOW).toMark)).toEqual(["z", "y", "a", "b", "c"]);
  });

  test("every row says what was sold and to whom", () => {
    const sales = [
      sale({
        id: "delivery",
        item: "gamePlan",
        customerId: "c-1",
        customerName: "Carla Díaz",
        dueAt: "2026-10-16T12:00:00.000Z",
      }),
      sale({
        id: "session",
        item: "vodLive",
        customerId: "c-2",
        customerName: "Matías Núñez",
        dueAt: "2026-10-15T12:00:00.000Z",
      }),
      sale({
        id: "to-mark",
        item: "tournament",
        customerId: "c-3",
        customerName: "Julián",
        dueAt: "2026-10-01T12:00:00.000Z",
      }),
    ];
    const work = pendingWork(sales, NOW);
    expect(work.deliveries[0]).toMatchObject({ item: "gamePlan", customerId: "c-1", customerName: "Carla Díaz" });
    expect(work.sessions[0]).toMatchObject({ item: "vodLive", customerId: "c-2", customerName: "Matías Núñez" });
    expect(work.toMark[0]).toMatchObject({ item: "tournament", customerId: "c-3", customerName: "Julián" });
  });

  test("a delivery due exactly now is not overdue yet", () => {
    const work = pendingWork([sale({ item: "gamePlan", dueAt: NOW.toISOString() })], NOW);
    expect(work.deliveries.map((delivery) => delivery.overdue)).toEqual([false]);
    const later = new Date(NOW.getTime() + 1);
    const afterwards = pendingWork([sale({ item: "gamePlan", dueAt: NOW.toISOString() })], later);
    expect(afterwards.deliveries[0].overdue).toBe(true);
  });

  test("deliveries go by due date, then id", () => {
    const sales = [
      sale({ id: "c", item: "gamePlan", dueAt: "2026-10-18T12:00:00.000Z" }),
      sale({ id: "b", item: "vodRecorded", dueAt: "2026-10-15T12:00:00.000Z" }),
      sale({ id: "a", item: "vodRecorded", dueAt: "2026-10-15T12:00:00.000Z" }),
      sale({ id: "z", item: "gamePlan", dueAt: null }),
      sale({ id: "y", item: "gamePlan", dueAt: null }),
    ];
    expect(ids(pendingWork(sales, NOW).deliveries)).toEqual(["a", "b", "c", "y", "z"]);
  });

  test("sessions go by date, then id", () => {
    const sales = [
      sale({ id: "d", item: "lesson", dueAt: "2026-10-15T12:00:00.000Z" }),
      sale({ id: "b", item: "lesson", dueAt: "2026-10-14T12:00:00.000Z" }),
      sale({ id: "a", item: "lessonPack", dueAt: "2026-10-14T12:00:00.000Z" }),
    ];
    expect(ids(pendingWork(sales, NOW).sessions)).toEqual(["a", "b", "d"]);
  });

  test("a due date written as the Argentine wall clock is read as Argentine time", () => {
    const sales = [
      // 12/10 21:00 en Argentina = 13/10 00:00 UTC: ya pasó.
      sale({ id: "late", item: "gamePlan", dueAt: "2026-10-12T21:00" }),
      // 13/10 16:00 en Argentina: dentro de una hora.
      sale({ id: "soon", item: "gamePlan", dueAt: "2026-10-13T16:00" }),
      sale({ id: "session", item: "lesson", dueAt: "2026-10-13T16:00" }),
      // 12/10 23:00 en Argentina: ayer.
      sale({ id: "yesterday", item: "lesson", dueAt: "2026-10-12T23:00" }),
    ];
    const work = pendingWork(sales, NOW);
    expect(work.deliveries.map((delivery) => [delivery.id, delivery.overdue])).toEqual([
      ["late", true],
      ["soon", false],
    ]);
    expect(ids(work.sessions)).toEqual(["session"]);
    expect(ids(work.toMark)).toEqual(["yesterday"]);
  });

  test("a due date that is not a date is treated as having none", () => {
    const sales = [
      sale({ id: "broken", item: "gamePlan", dueAt: "mañana" }),
      sale({ id: "broken-session", item: "lesson", dueAt: "mañana" }),
      sale({ id: "date-only", item: "lesson", dueAt: "2026-10-14" }),
    ];
    const work = pendingWork(sales, NOW);
    expect(work.deliveries.map((delivery) => [delivery.id, delivery.dueAt])).toEqual([
      ["broken", null],
    ]);
    expect(work.sessions).toEqual([]);
    expect(work.toMark).toEqual([]);
  });

  test("with nothing pending everything is empty", () => {
    expect(pendingWork([], NOW)).toEqual({
      deliveries: [],
      sessions: [],
      toMark: [],
      uninvoiced: { count: 0, arsMinor: 0, usdMinor: 0 },
    });
  });

  test("uninvoiced covers every collected sale, whatever its age, but not future-dated ones", () => {
    const sales = [
      sale({ paidOn: "2024-01-15", dollars: 10, invoiceStatus: "pending" }),
      sale({ paidOn: "2026-10-13", dollars: 20, invoiceStatus: "pending" }),
      sale({ paidOn: "2026-10-14", dollars: 640, invoiceStatus: "pending" }),
    ];
    expect(pendingWork(sales, NOW).uninvoiced).toEqual({
      count: 2,
      arsMinor: 4_500_000,
      usdMinor: 3000,
    });
  });
});

describe("monotributo", () => {
  const settings = { category: "C", annualCapArsMinor: 100_000_000, validFrom: "2026-08-01" };

  test("monotributo uses the rolling last 12 months against the cap", () => {
    const sales = [
      sale({ paidOn: "2025-10-13", dollars: 1000 }), // un día antes de la ventana
      sale({ paidOn: "2025-10-14", dollars: 200 }), // primer día de la ventana
      sale({ paidOn: "2026-03-01", dollars: 300 }),
      sale({ paidOn: "2026-10-13", dollars: 100 }), // hoy
      sale({ paidOn: "2026-10-14", dollars: 50 }), // mañana: todavía no
      sale({ paidOn: "2026-05-01", dollars: 900, status: "cancelled" }),
      sale({ paidOn: "2026-06-01", dollars: 900, status: "refunded" }),
      sale({ paidOn: null, dollars: 900, status: "pending" }),
    ];

    // 600 dólares a 1.500 = $ 900.000,00 = 90.000.000 centavos de peso; el tope es $ 1.000.000,00.
    expect(monotributoStatus(sales, settings, NOW)).toEqual({
      last12ArsMinor: 90_000_000,
      capArsMinor: 100_000_000,
      usedPct: 90,
      remainingArsMinor: 10_000_000,
    });
  });

  test("the window is the day after today a year ago up to today, in Argentina", () => {
    expect(monotributoWindow(NOW)).toEqual({ from: "2025-10-14", to: "2026-10-13" });
    // 31/10 a las 22:30 en Argentina ya es 1/11 en UTC: la ventana es la del 31/10.
    expect(monotributoWindow(new Date("2026-11-01T01:30:00.000Z"))).toEqual({
      from: "2025-11-01",
      to: "2026-10-31",
    });
  });

  test("the percentage used has one decimal", () => {
    const sales = [sale({ amountArsMinor: 33_333_333, amountUsdMinor: 1 })];
    expect(monotributoStatus(sales, settings, NOW).usedPct).toBe(33.3);
    const more = [sale({ amountArsMinor: 66_666_667, amountUsdMinor: 1 })];
    expect(monotributoStatus(more, settings, NOW).usedPct).toBe(66.7);
  });

  test("over the cap the remaining amount is negative", () => {
    const sales = [sale({ amountArsMinor: 125_000_000, amountUsdMinor: 1 })];
    expect(monotributoStatus(sales, settings, NOW)).toEqual({
      last12ArsMinor: 125_000_000,
      capArsMinor: 100_000_000,
      usedPct: 125,
      remainingArsMinor: -25_000_000,
    });
  });

  test("exactly at the cap leaves nothing", () => {
    const sales = [sale({ amountArsMinor: 100_000_000, amountUsdMinor: 1 })];
    expect(monotributoStatus(sales, settings, NOW)).toMatchObject({
      usedPct: 100,
      remainingArsMinor: 0,
    });
  });

  test("monotributo without settings returns only the total", () => {
    const sales = [sale({ dollars: 100 }), sale({ dollars: 50, status: "cancelled" })];
    expect(monotributoStatus(sales, null, NOW)).toEqual({
      last12ArsMinor: 15_000_000,
      capArsMinor: null,
      usedPct: null,
      remainingArsMinor: null,
    });
  });

  test.each([0, -1, Number.NaN, 1.5])("a cap of %s is no cap", (annualCapArsMinor) => {
    const result = monotributoStatus([sale({ dollars: 100 })], { ...settings, annualCapArsMinor }, NOW);
    expect(result).toEqual({
      last12ArsMinor: 15_000_000,
      capArsMinor: null,
      usedPct: null,
      remainingArsMinor: null,
    });
  });

  test("with no income the whole cap is left", () => {
    expect(monotributoStatus([], settings, NOW)).toEqual({
      last12ArsMinor: 0,
      capArsMinor: 100_000_000,
      usedPct: 0,
      remainingArsMinor: 100_000_000,
    });
  });

  test("the window moves with the date", () => {
    const sales = [sale({ paidOn: "2025-10-20", dollars: 100 })];
    // El 13/10/2026 la venta del 20/10/2025 todavía está; el 21/10/2026 ya salió.
    expect(monotributoStatus(sales, settings, NOW).last12ArsMinor).toBe(15_000_000);
    const later = new Date("2026-10-21T15:00:00.000Z");
    expect(monotributoStatus(sales, settings, later).last12ArsMinor).toBe(0);
    // Un 29/2 no rompe la ventana: del 1/3/2027 al 29/2/2028.
    const leapDay = new Date("2028-02-29T15:00:00.000Z");
    const edge = [
      sale({ paidOn: "2027-02-28", dollars: 1 }),
      sale({ paidOn: "2027-03-01", dollars: 2 }),
    ];
    expect(monotributoStatus(edge, settings, leapDay).last12ArsMinor).toBe(300_000);
  });
});
