import { describe, expect, test } from "vitest";
import { INTEREST_LOCALES, SITE_BOOKING_ITEMS } from "@/admin/catalog";
import { dateToArgentinaLocal } from "@/admin/dates";
import { buildDemoData } from "@/admin/demo-data";
import { DEMO_INTEREST_ID_BASE, DEMO_INTEREST_IP_HASH } from "@/admin/demo-interest";
import { addMonths, firstOfMonth, periodRange } from "@/admin/metrics/period";

const TODAYS = ["2026-10-14", "2026-10-01", "2026-10-31", "2026-01-31", "2028-02-29"];

const dayOf = (instant: Date) => dateToArgentinaLocal(instant).slice(0, 10);
const noonOf = (today: string) => new Date(`${today}T15:00:00.000Z`);

describe("demo interest events", () => {
  test("are deterministic and move with the day", () => {
    for (const today of TODAYS) {
      const first = buildDemoData(today).interest;
      const second = buildDemoData(today).interest;
      expect(JSON.stringify(second), today).toBe(JSON.stringify(first));
    }
    expect(buildDemoData("2026-10-14").interest).not.toEqual(buildDemoData("2026-11-14").interest);
  });

  test("do not change the sales or the students of the demo data", () => {
    const { customers, sales } = buildDemoData("2026-10-14");

    expect(customers).toHaveLength(25);
    expect(sales.length).toBeGreaterThanOrEqual(100);
    expect(sales.length).toBeLessThanOrEqual(135);
  });

  test("have unique ids in a reserved range, a fake ip hash and only valid values", () => {
    for (const today of TODAYS) {
      const { interest } = buildDemoData(today);
      expect(interest.length, today).toBeGreaterThanOrEqual(400);
      expect(interest.length, today).toBeLessThanOrEqual(1200);
      expect(new Set(interest.map((event) => event.id)).size, today).toBe(interest.length);
      for (const event of interest) {
        expect(event.id).toBeGreaterThanOrEqual(DEMO_INTEREST_ID_BASE);
        expect(event.ipHash).toBe(DEMO_INTEREST_IP_HASH);
        expect(SITE_BOOKING_ITEMS as readonly string[]).toContain(event.item);
        expect(INTEREST_LOCALES as readonly string[]).toContain(event.locale);
        expect(event.country === null || /^[A-Z]{2}$/.test(event.country ?? "")).toBe(true);
      }
    }
  });

  test("span the 14 months of history and never fall after today", () => {
    for (const today of TODAYS) {
      const { interest } = buildDemoData(today);
      const days = interest.map((event) => dayOf(event.createdAt as Date)).sort();
      expect(days.at(-1)! <= today, today).toBe(true);
      expect(days[0] >= addMonths(firstOfMonth(today), -13), today).toBe(true);
      expect(days[0] <= addMonths(firstOfMonth(today), -12), today).toBe(true);
    }
  });

  test("every button has clicks over the year, and the pro season has none this month", () => {
    for (const today of TODAYS) {
      const { interest } = buildDemoData(today);
      const year = periodRange("last12", noonOf(today));
      const month = periodRange("thisMonth", noonOf(today));
      const inRange = (range: { from: string; to: string }, item: string) =>
        interest.filter((event) => event.item === item && dayOf(event.createdAt as Date) >= range.from && dayOf(event.createdAt as Date) <= range.to).length;

      for (const item of SITE_BOOKING_ITEMS) {
        expect(inRange(year, item), `${today} ${item}`).toBeGreaterThan(0);
      }
      expect(inRange(month, "proSeason"), today).toBe(0);
    }
  });

  test("keep plausible conversion: clearly more clicks than sales", () => {
    const { interest, sales } = buildDemoData("2026-10-14");
    const sold = sales.filter((sale) => sale.status === "paid" || sale.status === "delivered").length;

    expect(interest.length).toBeGreaterThan(sold * 2);
    expect(interest.length).toBeLessThan(sold * 15);
  });
});
