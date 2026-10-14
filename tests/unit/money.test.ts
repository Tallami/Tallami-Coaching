import { describe, expect, test } from "vitest";
import {
  arsToUsdMinor,
  convertToArsMinor,
  formatMoney,
  InvalidAmountError,
  normalizeRate,
  parseAmountToMinor,
} from "@/lib/money";

describe("parseAmountToMinor", () => {
  test("parses spanish and plain amounts", () => {
    expect(parseAmountToMinor("1.234,56")).toBe(123456);
    expect(parseAmountToMinor("1234,56")).toBe(123456);
    expect(parseAmountToMinor("1234.56")).toBe(123456);
    expect(parseAmountToMinor("1234")).toBe(123400);
    expect(parseAmountToMinor("40")).toBe(4000);
  });

  test("scales one decimal and tiny amounts to cents", () => {
    expect(parseAmountToMinor("40,5")).toBe(4050);
    expect(parseAmountToMinor("40.5")).toBe(4050);
    expect(parseAmountToMinor("0,01")).toBe(1);
    expect(parseAmountToMinor("0.99")).toBe(99);
  });

  test("accepts several thousands groups and surrounding spaces", () => {
    expect(parseAmountToMinor("1.234.567,89")).toBe(123456789);
    expect(parseAmountToMinor("1.234.567")).toBe(123456700);
    expect(parseAmountToMinor("  2.500,00 ")).toBe(250000);
  });

  test.each([
    ["negative", "-5"],
    ["text", "abc"],
    ["empty", ""],
    ["only spaces", "   "],
    ["zero", "0"],
    ["zero with cents", "0,00"],
    ["leading plus", "+5"],
    ["currency symbol", "$ 40"],
    ["comma plus three digits (ambiguous)", "1,234"],
    ["dot plus three digits (ambiguous)", "1.234"],
    ["three decimals", "12,345"],
    ["four decimals", "12.3456"],
    ["two decimal separators", "1,5,5"],
    ["english thousands", "1,234.56"],
    ["misplaced thousands dot", "12.34.567,00"],
    ["thousands dot after a decimal comma", "1,5.000"],
    ["too large for a safe integer", "99999999999999999"],
  ])("rejects %s (%s) with a spanish message", (_label, input) => {
    expect(() => parseAmountToMinor(input)).toThrow(InvalidAmountError);
    expect(() => parseAmountToMinor(input)).toThrow(/monto/i);
  });

  test("explains the ambiguous case", () => {
    expect(() => parseAmountToMinor("1,234")).toThrow(/ambiguo/);
  });
});

describe("formatMoney", () => {
  test("formats money in es-AR", () => {
    expect(formatMoney(123456, "USD")).toBe("USD 1.234,56");
    expect(formatMoney(123456, "ARS")).toBe("$ 1.234,56");
    expect(formatMoney(123456, "BRL")).toBe("R$ 1.234,56");
    expect(formatMoney(123456, "USDT")).toBe("USDT 1.234,56");
  });

  test("groups thousands from four digits and pads cents", () => {
    expect(formatMoney(0, "USD")).toBe("USD 0,00");
    expect(formatMoney(5, "USD")).toBe("USD 0,05");
    expect(formatMoney(100, "ARS")).toBe("$ 1,00");
    expect(formatMoney(99900, "ARS")).toBe("$ 999,00");
    expect(formatMoney(100000, "ARS")).toBe("$ 1.000,00");
    expect(formatMoney(100000000, "USD")).toBe("USD 1.000.000,00");
  });

  test("rounds half-up to whole units with decimals: 0", () => {
    expect(formatMoney(123456, "USD", { decimals: 0 })).toBe("USD 1.235");
    expect(formatMoney(123449, "USD", { decimals: 0 })).toBe("USD 1.234");
    expect(formatMoney(50, "ARS", { decimals: 0 })).toBe("$ 1");
    expect(formatMoney(49, "ARS", { decimals: 0 })).toBe("$ 0");
    expect(formatMoney(123456, "USD", { decimals: 2 })).toBe("USD 1.234,56");
  });

  test("puts the minus sign before the symbol", () => {
    expect(formatMoney(-123456, "ARS")).toBe("-$ 1.234,56");
    expect(formatMoney(-49, "ARS", { decimals: 0 })).toBe("$ 0");
  });

  test("uses a plain space, never a non-breaking one", () => {
    expect(formatMoney(100, "USD")).not.toMatch(/\u00a0|\u202f/);
  });

  test("refuses amounts that are not whole cents", () => {
    expect(() => formatMoney(12.5, "USD")).toThrow(RangeError);
    expect(() => formatMoney(Number.NaN, "USD")).toThrow(RangeError);
    expect(() => formatMoney(Number.POSITIVE_INFINITY, "USD")).toThrow(RangeError);
  });
});

describe("currency conversion", () => {
  test("converts with exact cents", () => {
    expect(convertToArsMinor(4000, "1517.0000")).toBe(6068000);
    expect(arsToUsdMinor(6068000, "1517.0000")).toBe(4000);
  });

  test("rounds half-up on a remainder of exactly one half", () => {
    // 1 x 1,5 = 1,5 -> 2 y 3 x 1,5 = 4,5 -> 5 (con floor serían 1 y 4)
    expect(convertToArsMinor(1, "1.5000")).toBe(2);
    expect(convertToArsMinor(3, "1.5000")).toBe(5);
    // 3 / 2 = 1,5 -> 2; 5 / 2 = 2,5 -> 3
    expect(arsToUsdMinor(3, "2.0000")).toBe(2);
    expect(arsToUsdMinor(5, "2.0000")).toBe(3);
  });

  test("rounds down below one half and up above it", () => {
    expect(arsToUsdMinor(1, "3.0000")).toBe(0);
    expect(arsToUsdMinor(2, "3.0000")).toBe(1);
    // 1000 x 301,5651 / 100 -> 301565,1
    expect(convertToArsMinor(1000, "301.5651")).toBe(301565);
    expect(convertToArsMinor(1000, "301.5656")).toBe(301566);
  });

  test("handles pesos, fractional rates and short rate texts", () => {
    expect(convertToArsMinor(12345, "1.0000")).toBe(12345);
    expect(convertToArsMinor(4000, "1517")).toBe(6068000);
    expect(convertToArsMinor(4000, "1512.5")).toBe(6050000);
    expect(arsToUsdMinor(6050000, "1512.5000")).toBe(4000);
  });

  test("is symmetric for negative amounts", () => {
    expect(convertToArsMinor(-3, "1.5000")).toBe(-5);
    expect(arsToUsdMinor(-3, "2.0000")).toBe(-2);
    expect(convertToArsMinor(0, "1517.0000")).toBe(0);
  });

  test.each(["0", "0.0000", "-1517.0000", "abc", "", "1,5", "1.23456", "1e3"])(
    "rejects the rate %j",
    (rate) => {
      expect(() => convertToArsMinor(4000, rate)).toThrow(RangeError);
      expect(() => arsToUsdMinor(6068000, rate)).toThrow(RangeError);
    },
  );

  test("refuses amounts that are not whole cents or overflow", () => {
    expect(() => convertToArsMinor(10.5, "1517.0000")).toThrow(RangeError);
    expect(() => arsToUsdMinor(10.5, "1517.0000")).toThrow(RangeError);
    expect(() => convertToArsMinor(Number.MAX_SAFE_INTEGER, "1517.0000")).toThrow(
      RangeError,
    );
  });
});

describe("normalizeRate", () => {
  test("pads and rounds to four decimals", () => {
    expect(normalizeRate("1517")).toBe("1517.0000");
    expect(normalizeRate("1517.5")).toBe("1517.5000");
    expect(normalizeRate("1517.00000000")).toBe("1517.0000");
    expect(normalizeRate("304.15430300")).toBe("304.1543");
    expect(normalizeRate("301.565148")).toBe("301.5651");
  });

  test("rounds half-up on exact decimal ties, where floats get it wrong", () => {
    // (1.00105).toFixed(4) === "1.0010": con decimales binarios se pierde el empate
    expect(normalizeRate("1.00105")).toBe("1.0011");
    expect(normalizeRate("2.00005")).toBe("2.0001");
    expect(normalizeRate("301.56515")).toBe("301.5652");
    expect(normalizeRate("9.99995")).toBe("10.0000");
  });

  test.each(["0", "0.00004", "-1", "abc", "", "1,5", "1.2.3", "1e3"])(
    "rejects %j",
    (value) => {
      expect(() => normalizeRate(value)).toThrow(RangeError);
    },
  );
});
