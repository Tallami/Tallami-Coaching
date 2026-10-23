import { describe, expect, test } from "vitest";
import {
  argentinaLocalToDate,
  dateToArgentinaLocal,
  formatDay,
  formatMoment,
  isValidIsoDate,
  todayInArgentina,
} from "@/admin/dates";

describe("todayInArgentina", () => {
  test("uses the Argentine calendar day, not the UTC one", () => {
    // 23:30 del 13 en Argentina ya es el 14 en UTC.
    expect(todayInArgentina(new Date("2026-10-14T02:30:00Z"))).toBe("2026-10-13");
    expect(todayInArgentina(new Date("2026-10-14T03:00:00Z"))).toBe("2026-10-14");
    expect(todayInArgentina(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31");
  });
});

describe("Argentine local date and time", () => {
  test("reads a datetime-local value as Argentine time", () => {
    expect(argentinaLocalToDate("2026-10-20T15:00")?.toISOString()).toBe(
      "2026-10-20T18:00:00.000Z",
    );
    // 22:00 del 31 en Argentina ya es el 1.º del mes siguiente en UTC.
    expect(argentinaLocalToDate("2026-10-31T22:00")?.toISOString()).toBe(
      "2026-11-01T01:00:00.000Z",
    );
  });

  test("writes a stored instant back as the Argentine wall clock", () => {
    expect(dateToArgentinaLocal(new Date("2026-10-20T18:00:00.000Z"))).toBe("2026-10-20T15:00");
    expect(dateToArgentinaLocal(new Date("2026-11-01T01:00:00.000Z"))).toBe("2026-10-31T22:00");
  });

  test("round-trips", () => {
    const text = "2026-03-05T09:45";
    expect(dateToArgentinaLocal(argentinaLocalToDate(text) as Date)).toBe(text);
  });

  test.each(["", "2026-10-20", "2026-10-20 15:00", "2026-13-20T15:00", "2026-02-30T10:00", "2026-10-20T25:00"])(
    "rejects %j",
    (text) => {
      expect(argentinaLocalToDate(text)).toBeNull();
    },
  );
});

describe("isValidIsoDate", () => {
  test("accepts real calendar days only", () => {
    expect(isValidIsoDate("2026-02-28")).toBe(true);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-1-1")).toBe(false);
    expect(isValidIsoDate("hoy")).toBe(false);
  });
});

describe("formatDay", () => {
  test("writes a day as day/month/year without touching time zones", () => {
    expect(formatDay("2026-10-12")).toBe("12/10/2026");
    expect(formatDay("2019-01-05")).toBe("05/01/2019");
  });
});

describe("formatMoment", () => {
  test("writes an instant as the Argentine day and time, the way it is read on screen", () => {
    expect(formatMoment(new Date("2026-10-15T17:30:00.000Z"))).toBe("15/10/2026, 14:30");
  });

  test("an instant just after midnight UTC is still the day before in Argentina", () => {
    expect(formatMoment(new Date("2026-10-16T01:15:00.000Z"))).toBe("15/10/2026, 22:15");
  });
});
