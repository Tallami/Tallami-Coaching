// La nota de Servicios sobre los topes de clics sale de las constantes del
// registro (`src/admin/interest/limits.ts`), no de números escritos a mano: si el
// tope cambia, el texto cambia solo.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { SITE_BOOKING_ITEMS } from "@/admin/catalog";
import { buildServicesReport } from "@/admin/services/report";
import { ServicesView } from "@/admin/services/services-view";
import { NOW } from "../helpers/metric-sales";

vi.mock("@/admin/interest/limits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/admin/interest/limits")>()),
  INTEREST_GLOBAL_MAX_PER_WINDOW: 350,
  INTEREST_GLOBAL_MAX_PER_HOUR: 12_345,
}));

describe("the ceilings in the notes of Servicios", () => {
  test("are written from the constants, with the thousands separator of Argentina", () => {
    const clicks = SITE_BOOKING_ITEMS.map((item) => ({ item, clicks: 1 }));
    const report = buildServicesReport([], clicks, "thisMonth", NOW);

    const markup = renderToStaticMarkup(createElement(ServicesView, { report }));

    expect(markup).toContain("350 clics por minuto o de 12.345 por hora");
    expect(markup).not.toContain("200 clics por minuto");
    expect(markup).not.toContain("2.000 por hora");
  });
});
