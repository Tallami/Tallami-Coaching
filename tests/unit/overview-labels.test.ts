import { describe, expect, test } from "vitest";
import {
  countryLabel,
  formatDueDay,
  formatPercent,
  formatRangeLabel,
  formatSessionWhen,
  formatSignedPercent,
  monthLabels,
  rangeLengthInDays,
} from "@/admin/overview/labels";
import { DEFAULT_PERIOD, PERIOD_SLUGS, overviewHref, parsePeriodParam } from "@/admin/overview/period-param";
import { PERIODS } from "@/admin/metrics/period";

const TODAY = "2026-10-14";

describe("period in the address", () => {
  test("each period has its slug and reads back from it", () => {
    expect(PERIOD_SLUGS).toEqual({
      thisMonth: "este-mes",
      lastMonth: "mes-pasado",
      last30: "30-dias",
      last12: "12-meses",
      thisYear: "este-ano",
    });
    for (const period of PERIODS) {
      expect(parsePeriodParam(PERIOD_SLUGS[period])).toBe(period);
    }
  });

  test("no parameter, an unknown one or a hostile one is the default, never an error", () => {
    expect(DEFAULT_PERIOD).toBe("thisMonth");
    for (const value of [
      undefined,
      "",
      "ESTE-MES",
      " este-mes",
      "thisYear",
      "este-mes,30-dias",
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
      "0",
      "<script>",
      "%00",
      "a".repeat(10_000),
      [],
    ]) {
      expect(parsePeriodParam(value), JSON.stringify(value)?.slice(0, 40)).toBe("thisMonth");
    }
  });

  test("a repeated parameter uses the first value", () => {
    expect(parsePeriodParam(["12-meses", "este-ano"])).toBe("last12");
    expect(parsePeriodParam(["nada", "este-ano"])).toBe("thisMonth");
  });

  test("the link of a period is the plain panel for the default and ?periodo= for the rest", () => {
    expect(overviewHref("thisMonth")).toBe("/admin");
    expect(overviewHref("thisYear")).toBe("/admin?periodo=este-ano");
    expect(overviewHref("last30")).toBe("/admin?periodo=30-dias");
  });
});

describe("range labels", () => {
  test("a range inside one month reads 1–13 sep.", () => {
    expect(formatRangeLabel({ from: "2026-09-01", to: "2026-09-13" }, TODAY)).toBe("1–13 sep.");
    expect(formatRangeLabel({ from: "2026-10-01", to: "2026-10-14" }, TODAY)).toBe("1–14 oct.");
    expect(formatRangeLabel({ from: "2026-08-01", to: "2026-08-31" }, TODAY)).toBe("1–31 ago.");
  });

  test("a single day is written once", () => {
    expect(formatRangeLabel({ from: "2026-10-01", to: "2026-10-01" }, TODAY)).toBe("1 oct.");
  });

  test("a range across months names both", () => {
    expect(formatRangeLabel({ from: "2026-01-01", to: "2026-10-14" }, TODAY)).toBe("1 ene. – 14 oct.");
    expect(formatRangeLabel({ from: "2026-09-15", to: "2026-10-14" }, TODAY)).toBe("15 sep. – 14 oct.");
  });

  test("the year appears when it is not the current one or the range crosses years", () => {
    expect(formatRangeLabel({ from: "2025-01-01", to: "2025-10-14" }, TODAY)).toBe("1 ene. – 14 oct. 2025");
    expect(formatRangeLabel({ from: "2025-09-01", to: "2025-09-13" }, TODAY)).toBe("1–13 sep. 2025");
    expect(formatRangeLabel({ from: "2025-11-01", to: "2026-10-14" }, TODAY)).toBe("1 nov. 2025 – 14 oct. 2026");
    expect(formatRangeLabel({ from: "2024-11-01", to: "2025-10-14" }, TODAY)).toBe("1 nov. 2024 – 14 oct. 2025");
  });

  test("the length counts both ends", () => {
    expect(rangeLengthInDays({ from: "2026-10-01", to: "2026-10-01" })).toBe(1);
    expect(rangeLengthInDays({ from: "2026-10-01", to: "2026-10-14" })).toBe(14);
    expect(rangeLengthInDays({ from: "2026-01-01", to: "2026-12-31" })).toBe(365);
  });
});

describe("month labels", () => {
  test("short, with year and long forms", () => {
    expect(monthLabels("2026-10")).toEqual({ short: "oct", medium: "oct. 2026", long: "octubre de 2026" });
    expect(monthLabels("2025-01")).toEqual({ short: "ene", medium: "ene. 2025", long: "enero de 2025" });
    expect(monthLabels("2026-09").short).toBe("sep");
  });
});

describe("percentages", () => {
  test("use a decimal comma and a space before the sign", () => {
    expect(formatPercent(34.5)).toBe("34,5 %");
    expect(formatPercent(100)).toBe("100 %");
    expect(formatPercent(0)).toBe("0 %");
    expect(formatPercent(12.3)).toBe("12,3 %");
  });

  test("a variation always carries its sign", () => {
    expect(formatSignedPercent(50)).toBe("+50 %");
    expect(formatSignedPercent(12.5)).toBe("+12,5 %");
    expect(formatSignedPercent(-3.2)).toBe("-3,2 %");
    expect(formatSignedPercent(0)).toBe("0 %");
  });
});

describe("country names", () => {
  test("a code becomes the country in Spanish", () => {
    expect(countryLabel("AR")).toBe("Argentina");
    expect(countryLabel("BR")).toBe("Brasil");
    expect(countryLabel("MX")).toBe("México");
    expect(countryLabel("ES")).toBe("España");
  });

  test("no country stays as it is, and a code nobody knows stays as the code", () => {
    expect(countryLabel("Sin país")).toBe("Sin país");
    expect(countryLabel("QQ")).toBe("QQ");
    expect(countryLabel("???")).toBe("???");
  });
});

describe("dates of the pending list", () => {
  test("a session reads as weekday, day and Argentine time", () => {
    // 2026-10-15T18:00Z son las 15:00 del jueves 15/10 en Argentina.
    expect(formatSessionWhen("2026-10-15T18:00:00.000Z")).toBe("jue 15/10, 15:00");
    // Las 02:30 UTC del 14 son las 23:30 del martes 13 en Argentina.
    expect(formatSessionWhen("2026-10-14T02:30:00.000Z")).toBe("mar 13/10, 23:30");
  });

  test("a due day is the Argentine day, not the UTC one", () => {
    expect(formatDueDay("2026-10-15T18:00:00.000Z")).toBe("15/10");
    expect(formatDueDay("2026-10-16T01:00:00.000Z")).toBe("15/10");
  });

  test("a due day from another year carries the year", () => {
    expect(formatDueDay("2025-12-30T18:00:00.000Z", TODAY)).toBe("30/12/2025");
    expect(formatDueDay("2026-10-15T18:00:00.000Z", TODAY)).toBe("15/10");
  });
});
