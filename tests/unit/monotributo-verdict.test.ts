import { describe, expect, test } from "vitest";
import { monotributoVerdict } from "@/admin/overview/monotributo-verdict";
import { monotributoStatus } from "@/admin/metrics/monotributo";
import { NOW, sale } from "../helpers/metric-sales";

const CAP = 10_000_000;

/** El veredicto para una cantidad cobrada contra un tope de 10.000.000 de centavos, como lo calcula el panel. */
function verdictFor(collectedArsMinor: number) {
  const status = monotributoStatus(
    [sale({ amountArsMinor: collectedArsMinor, amountUsdMinor: 1 })],
    { category: "C", annualCapArsMinor: CAP, validFrom: "2026-08-01" },
    NOW,
  );
  return {
    usedPct: status.usedPct as number,
    verdict: monotributoVerdict(status.usedPct as number, status.remainingArsMinor as number),
  };
}

describe("monotributoVerdict", () => {
  test("well below the cap says how much is left, in the accent tone", () => {
    const { verdict } = verdictFor(5_000_000);
    expect(verdict).toEqual({ tone: "accent", text: "Te quedan $ 50.000,00" });
  });

  test("from 80 % it warns, and says how much is left", () => {
    expect(verdictFor(7_990_000).verdict.tone).toBe("accent");
    expect(verdictFor(8_000_000).verdict).toEqual({
      tone: "warn",
      text: "Estás cerca del tope: te quedan $ 20.000,00",
    });
  });

  test("99,95 % rounds to 100 % but there is still room: about to reach it, never over", () => {
    const { usedPct, verdict } = verdictFor(9_995_000);
    expect(usedPct).toBe(100);
    expect(verdict).toEqual({
      tone: "warn",
      text: "Estás a punto de llegar al tope: te quedan $ 50,00",
    });
  });

  test("exactly 100 % reached the cap and has nothing left", () => {
    const { usedPct, verdict } = verdictFor(CAP);
    expect(usedPct).toBe(100);
    expect(verdict).toEqual({ tone: "danger", text: "Llegaste al tope" });
  });

  test("100,05 % is over the cap by the real amount, never a negative one", () => {
    const { usedPct, verdict } = verdictFor(10_005_000);
    expect(usedPct).toBe(100.1);
    expect(verdict).toEqual({ tone: "danger", text: "Superaste el tope por $ 50,00" });
  });

  test("a single cent over is over", () => {
    const { usedPct, verdict } = verdictFor(CAP + 1);
    expect(usedPct).toBe(100);
    expect(verdict).toEqual({ tone: "danger", text: "Superaste el tope por $ 0,01" });
  });

  test("far over the cap", () => {
    expect(verdictFor(12_500_000).verdict).toEqual({
      tone: "danger",
      text: "Superaste el tope por $ 25.000,00",
    });
  });

  test("never writes a negative amount", () => {
    for (const collected of [0, 1, 7_990_000, 8_000_000, 9_994_999, 9_995_000, CAP - 1, CAP, CAP + 1, 20_000_000]) {
      expect(verdictFor(collected).verdict.text, String(collected)).not.toContain("-");
    }
  });
});
