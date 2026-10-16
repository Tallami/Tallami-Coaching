// La página Servicios de punta a punta contra una base de prueba: lee los clics
// descartados de `interest_drops` en el período y los muestra. La sesión se
// simula (la guarda de verdad está en `admin-guards.test.ts`).

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { requireAdmin } from "@/admin/auth/require-admin";
import { addMonths, todayInArgentina } from "@/admin/metrics/period";
import { getDb, type Db } from "@/db/client";
import { interestDrops } from "@/db/schema";
import { createTestDb } from "../helpers/db";

vi.mock("@/admin/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  vi.mocked(requireAdmin).mockReset().mockResolvedValue(undefined);
  vi.mocked(getDb).mockReset().mockResolvedValue(db);
  await db.delete(interestDrops);
});

async function renderPage(searchParams: Record<string, string> = {}): Promise<string> {
  const { default: ServicesPage } = await import("@/app/admin/servicios/page");
  const element = await ServicesPage({ searchParams: Promise.resolve(searchParams) } as never);
  return renderToStaticMarkup(element);
}

describe("the Servicios page and the dropped clicks", () => {
  test("shows how many clicks were dropped in the period", async () => {
    await db.insert(interestDrops).values({ day: todayInArgentina(), dropped: 7 });

    const markup = await renderPage();

    expect(markup).toMatch(/data-testid="services-dropped"[^>]*>7 clics descartados por exceso/);
  });

  test("adds up the days of the period and leaves out the days outside it", async () => {
    const today = todayInArgentina();
    await db.insert(interestDrops).values([
      { day: today, dropped: 3 },
      { day: addMonths(today, -1), dropped: 4 },
      { day: addMonths(today, -13), dropped: 500 },
    ]);

    // Últimos 12 meses: hoy y hace un mes, no hace 13.
    expect(await renderPage({ periodo: "12-meses" })).toContain("7 clics descartados por exceso");
    expect(await renderPage({ periodo: "12-meses" })).not.toContain("500");
  });

  test("says nothing when no clicks were dropped in the period", async () => {
    // Hubo descartes, pero hace más de un año.
    await db.insert(interestDrops).values({ day: addMonths(todayInArgentina(), -14), dropped: 9 });

    const markup = await renderPage({ periodo: "12-meses" });

    expect(markup).not.toContain("services-dropped");
    expect(markup).not.toContain("descartado");
  });

  test("checks the session before reading anything", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("NEXT_REDIRECT /admin/login"));

    await expect(renderPage()).rejects.toThrow("NEXT_REDIRECT /admin/login");
    expect(getDb).not.toHaveBeenCalled();
  });
});
