import { describe, expect, test } from "vitest";
import { barLength, niceScale } from "@/admin/charts/scale";

describe("niceScale", () => {
  test("rounds the top up to a clean number and puts a gridline on every step", () => {
    // 2.150 dólares: pasos de 500 → 5 tramos, hasta 2.500.
    expect(niceScale(215_000)).toEqual({
      max: 250_000,
      ticks: [0, 50_000, 100_000, 150_000, 200_000, 250_000],
    });
  });

  test("an exact top stays where it is", () => {
    expect(niceScale(1_000_000)).toEqual({
      max: 1_000_000,
      ticks: [0, 200_000, 400_000, 600_000, 800_000, 1_000_000],
    });
  });

  test("never draws more than five intervals", () => {
    for (const max of [1, 99, 100, 101, 12_345, 99_999, 123_456_789]) {
      const { ticks } = niceScale(max);
      expect(ticks.length - 1, String(max)).toBeLessThanOrEqual(5);
      expect(ticks[ticks.length - 1], String(max)).toBeGreaterThanOrEqual(max);
    }
  });

  test("steps are 1, 2 or 5 times a power of ten, in whole dollars", () => {
    for (const max of [1, 7_300, 45_000, 215_000, 880_000, 12_000_000]) {
      const step = niceScale(max).ticks[1];
      const dollars = step / 100;
      expect(Number.isInteger(dollars), String(max)).toBe(true);
      expect([1, 2, 5]).toContain(Number(String(dollars)[0]));
      expect(String(dollars).slice(1)).toMatch(/^0*$/);
    }
  });

  test("no income at all still gets a readable scale", () => {
    expect(niceScale(0)).toEqual({
      max: 10_000,
      ticks: [0, 2_000, 4_000, 6_000, 8_000, 10_000],
    });
  });

  test("rejects values that are not money", () => {
    expect(() => niceScale(-1)).toThrow(RangeError);
    expect(() => niceScale(1.5)).toThrow(RangeError);
    expect(() => niceScale(Number.NaN)).toThrow(RangeError);
  });
});

describe("barLength", () => {
  test("is proportional to the scale", () => {
    expect(barLength(50_000, 100_000, 200)).toBe(100);
    expect(barLength(100_000, 100_000, 200)).toBe(200);
    expect(barLength(0, 100_000, 200)).toBe(0);
  });

  test("a tiny amount is still visible", () => {
    expect(barLength(1, 1_000_000, 200)).toBe(2);
  });

  test("never passes the full length", () => {
    expect(barLength(300_000, 100_000, 200)).toBe(200);
  });
});
