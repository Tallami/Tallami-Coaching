// Cada entrada nueva del panel (las dos páginas, las dos acciones y las dos
// descargas) verifica la sesión antes de tocar la base. El `proxy` es solo un
// filtro previo; esta es la protección real, y estos tests la cuidan sin pasar
// por el servidor.

import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { requireAdmin } from "@/admin/auth/require-admin";
import { eq } from "drizzle-orm";
import { getSale } from "@/admin/sales/repository";
import { getDb } from "@/db/client";
import { sales } from "@/db/schema";
import { createTestDb } from "../helpers/db";
import { seedSale } from "../helpers/sales-db";

vi.mock("@/admin/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

const NO_SESSION = "NEXT_REDIRECT /admin/login";

function withoutSession(): void {
  vi.mocked(requireAdmin).mockRejectedValue(new Error(NO_SESSION));
}

beforeEach(() => {
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(getDb).mockReset();
});

describe("without a session nothing reads or writes", () => {
  test("the sales export", async () => {
    withoutSession();
    const { GET } = await import("@/app/admin/ventas/exportar/route");

    await expect(GET(new NextRequest("http://localhost/admin/ventas/exportar"))).rejects.toThrow(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });

  test("the billing export", async () => {
    withoutSession();
    const { GET } = await import("@/app/admin/facturacion/exportar/route");

    await expect(GET(new NextRequest("http://localhost/admin/facturacion/exportar"))).rejects.toThrow(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });

  test("the invoicing action", async () => {
    withoutSession();
    const { invoicingAction } = await import("@/app/admin/facturacion/actions");

    await expect(invoicingAction({ fieldErrors: {} }, new FormData())).rejects.toThrow(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });

  test("the settings action", async () => {
    withoutSession();
    const { saveSettingsAction } = await import("@/app/admin/configuracion/actions");

    await expect(saveSettingsAction({ fieldErrors: {} }, new FormData())).rejects.toThrow(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });

  test("the undo of an invoice", async () => {
    withoutSession();
    const { markInvoicePendingAction } = await import("@/app/admin/ventas/actions");

    await expect(markInvoicePendingAction("8f4f3f64-7c5c-4a43-9d4c-3f6a3a2f1b10")).rejects.toThrow(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });

  test("the sale page, which has the invoice panel", async () => {
    withoutSession();
    const { default: EditSalePage } = await import("@/app/admin/ventas/[id]/page");

    await expect(
      EditSalePage({
        params: Promise.resolve({ id: "8f4f3f64-7c5c-4a43-9d4c-3f6a3a2f1b10" }),
        searchParams: Promise.resolve({}),
      } as never),
    ).rejects.toThrow(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });

  test("the billing page", async () => {
    withoutSession();
    const { default: BillingPage } = await import("@/app/admin/facturacion/page");

    await expect(BillingPage({ searchParams: Promise.resolve({}) } as never)).rejects.toThrow(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });

  test("the settings page", async () => {
    withoutSession();
    const { default: SettingsPage } = await import("@/app/admin/configuracion/page");

    await expect(SettingsPage({ searchParams: Promise.resolve({}) } as never)).rejects.toThrow(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("with a session the downloads are the real files", () => {
  test("the sales export checks the session first and then answers the csv", async () => {
    const db = await createTestDb();
    await seedSale(db, { customer: { mode: "new", name: "Con sesión" } });
    vi.mocked(requireAdmin).mockResolvedValue(undefined);
    vi.mocked(getDb).mockResolvedValue(db);
    const { GET } = await import("@/app/admin/ventas/exportar/route");

    const response = await GET(new NextRequest("http://localhost/admin/ventas/exportar?q=con%20sesi%C3%B3n"));

    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(await response.text()).toContain("Con sesión");
  });

  test("the billing export checks the session first and then answers the csv", async () => {
    const db = await createTestDb();
    await seedSale(db, { customer: { mode: "new", name: "Con sesión cobrada" } });
    vi.mocked(requireAdmin).mockResolvedValue(undefined);
    vi.mocked(getDb).mockResolvedValue(db);
    const { GET } = await import("@/app/admin/facturacion/exportar/route");

    const response = await GET(new NextRequest("http://localhost/admin/facturacion/exportar"));

    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="facturacion_/);
    expect(await response.text()).toContain("Con sesión cobrada");
  });
});

describe("the undo of an invoice with a session", () => {
  const INVOICED = {
    invoiceStatus: "issued",
    invoiceType: "C",
    invoiceNumber: "00003-00000045",
    invoicedOn: "2026-10-12",
  } as const;

  async function openDb() {
    const db = await createTestDb();
    vi.mocked(requireAdmin).mockResolvedValue(undefined);
    vi.mocked(getDb).mockResolvedValue(db);
    return db;
  }

  test("returns the sale to pending and goes back to it with a notice", async () => {
    const db = await openDb();
    const id = await seedSale(db);
    await db.update(sales).set(INVOICED).where(eq(sales.id, id));
    const { markInvoicePendingAction } = await import("@/app/admin/ventas/actions");

    await expect(markInvoicePendingAction(id)).rejects.toThrow(`NEXT_REDIRECT /admin/ventas/${id}?factura=pendiente`);

    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(await getSale(db, id)).toMatchObject({ invoiceStatus: "pending", invoiceNumber: null, invoiceType: null });
  });

  test("a sale that has no invoice to undo goes back with a notice and nothing changes", async () => {
    const db = await openDb();
    const id = await seedSale(db);
    const { markInvoicePendingAction } = await import("@/app/admin/ventas/actions");

    await expect(markInvoicePendingAction(id)).rejects.toThrow(`NEXT_REDIRECT /admin/ventas/${id}?factura=no-se-pudo`);

    expect((await getSale(db, id))?.invoiceStatus).toBe("pending");
  });

  test.each(["cancelled", "refunded"] as const)(
    "a replayed undo of a %s sale changes nothing and goes back with the notice about the credit note",
    async (status) => {
      const db = await openDb();
      const id = await seedSale(db);
      await db.update(sales).set({ ...INVOICED, status }).where(eq(sales.id, id));
      const { markInvoicePendingAction } = await import("@/app/admin/ventas/actions");

      await expect(markInvoicePendingAction(id)).rejects.toThrow(`NEXT_REDIRECT /admin/ventas/${id}?factura=no-cobrada`);

      expect(await getSale(db, id)).toMatchObject({ invoiceStatus: "issued", invoiceNumber: "00003-00000045", invoiceType: "C" });
    },
  );

  test("an id that is not a uuid never reaches the database", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined);
    const { markInvoicePendingAction } = await import("@/app/admin/ventas/actions");

    await expect(markInvoicePendingAction("x'; drop table sales; --")).rejects.toThrow("NEXT_REDIRECT /admin/ventas");
    expect(getDb).not.toHaveBeenCalled();
  });
});
