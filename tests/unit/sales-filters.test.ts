import { describe, expect, test } from "vitest";
import {
  countActiveFilters,
  hasActiveFilters,
  parseSalesQuery,
  salesQueryString,
} from "@/admin/sales/filters";

describe("parseSalesQuery", () => {
  test("reads every filter from the address", () => {
    const query = parseSalesQuery({
      desde: "2026-10-01",
      hasta: "2026-10-31",
      servicio: "gamePlan",
      estado: "paid",
      medio: "pix",
      factura: "issued",
      q: "  ana  ",
      pagina: "3",
    });

    expect(query).toEqual({
      filter: {
        from: "2026-10-01",
        to: "2026-10-31",
        item: "gamePlan",
        status: "paid",
        paymentMethod: "pix",
        invoiceStatus: "issued",
        q: "ana",
      },
      page: 3,
    });
  });

  test("an empty address means no filter and the first page", () => {
    expect(parseSalesQuery({})).toEqual({ filter: {}, page: 1 });
  });

  test("ignores values it does not know instead of failing", () => {
    const query = parseSalesQuery({
      desde: "ayer",
      hasta: "2026-02-30",
      servicio: "autos",
      estado: "perdida",
      medio: "bitcoin",
      factura: "tal vez",
      q: "   ",
      pagina: "dos",
    });

    expect(query).toEqual({ filter: {}, page: 1 });
  });

  test("takes the first value of a repeated parameter", () => {
    expect(parseSalesQuery({ estado: ["paid", "pending"], q: ["ana", "bruno"] }).filter).toEqual({
      status: "paid",
      q: "ana",
    });
  });

  test("pages are whole numbers from one", () => {
    expect(parseSalesQuery({ pagina: "0" }).page).toBe(1);
    expect(parseSalesQuery({ pagina: "-4" }).page).toBe(1);
    expect(parseSalesQuery({ pagina: "2.5" }).page).toBe(1);
    expect(parseSalesQuery({ pagina: "99999999999999999999" }).page).toBe(1);
    expect(parseSalesQuery({ pagina: "12" }).page).toBe(12);
  });

  test("cuts a very long search", () => {
    expect(parseSalesQuery({ q: "x".repeat(500) }).filter.q).toHaveLength(100);
  });
});

describe("salesQueryString", () => {
  test("is empty when nothing is set, so the plain list keeps its clean address", () => {
    expect(salesQueryString({}, 1)).toBe("");
    expect(salesQueryString({})).toBe("");
  });

  test("writes the filters and the page, skipping page one", () => {
    expect(salesQueryString({ status: "paid", q: "ana pérez" }, 1)).toBe(
      "?estado=paid&q=ana+p%C3%A9rez",
    );
    expect(salesQueryString({ status: "paid" }, 2)).toBe("?estado=paid&pagina=2");
    expect(salesQueryString({}, 4)).toBe("?pagina=4");
  });

  test("round-trips through parseSalesQuery", () => {
    const filter = {
      from: "2026-10-01",
      to: "2026-10-31",
      item: "lesson",
      status: "delivered",
      paymentMethod: "paypal",
      invoiceStatus: "pending",
      q: "100% & más",
    } as const;

    const search = new URLSearchParams(salesQueryString(filter, 5));

    expect(parseSalesQuery(Object.fromEntries(search))).toEqual({ filter, page: 5 });
  });
});

describe("countActiveFilters", () => {
  test("counts the filters that are set, and not the page", () => {
    expect(countActiveFilters({})).toBe(0);
    expect(countActiveFilters({ q: "ana" })).toBe(1);
    expect(countActiveFilters({ q: "ana", status: "paid", from: "2026-10-01" })).toBe(3);
  });
});

describe("hasActiveFilters", () => {
  test("is true as soon as one filter is set", () => {
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ q: "ana" })).toBe(true);
    expect(hasActiveFilters({ from: "2026-10-01" })).toBe(true);
  });
});
