// Las dos acciones de la tarjeta "Entregas" de la ficha de la venta. Como todas las del panel,
// verifican la sesión antes de tocar la base (el patrón de `portal-admin-actions.test.ts`); con
// sesión, validan lo que llega del navegador (que no es de fiar: el tipo, el título, los bytes
// del archivo y su tamaño) y guardan o borran.

import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { requireAdmin } from "@/admin/auth/require-admin";
import { getDb, type Db } from "@/db/client";
import { customers, deliveries, deliveryFiles, sales } from "@/db/schema";
import { listDeliveriesForSale } from "@/portal/deliveries";
import { dbFileStore } from "@/portal/files";
import { DELIVERY_PDF_MAX_BYTES } from "@/portal/policy";
import { createTestDb } from "../helpers/db";
import { insertTestCustomer, insertTestSale } from "../helpers/portal";

vi.mock("@/admin/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

const NO_SESSION = "NEXT_REDIRECT /admin/login";
const SOME_ID = "8f4f3f64-7c5c-4a43-9d4c-3f6a3a2f1b10";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const YOUTUBE = "https://youtu.be/dQw4w9WgXcQ";
const DRIVE = "https://drive.google.com/file/d/1AbC/view?usp=sharing";

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(getDb).mockReset();
  await db.delete(deliveries);
  await db.delete(deliveryFiles);
  await db.delete(sales);
  await db.delete(customers);
});

function withoutSession(): void {
  vi.mocked(requireAdmin).mockRejectedValue(new Error(NO_SESSION));
}

function withSession(): void {
  vi.mocked(requireAdmin).mockResolvedValue(undefined);
  vi.mocked(getDb).mockResolvedValue(db);
}

async function actions() {
  return import("@/app/admin/ventas/[id]/delivery-actions");
}

function pdfBytes(size = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(size);
  bytes.set(Buffer.from("%PDF-1.4\n"));
  return bytes;
}

/** Lo que manda el formulario de la tarjeta: tipo, título y el link o el archivo. */
function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function counts(): Promise<{ deliveries: number; files: number }> {
  return {
    deliveries: (await db.select({ id: deliveries.id }).from(deliveries)).length,
    files: (await db.select({ id: deliveryFiles.id }).from(deliveryFiles)).length,
  };
}

async function newSale(): Promise<string> {
  return insertTestSale(db, await insertTestCustomer(db));
}

describe("without a session nothing reads or writes", () => {
  test("adding a delivery", async () => {
    withoutSession();
    const { addDeliveryAction } = await actions();

    await expect(addDeliveryAction(SOME_ID, form({ kind: "link", title: "Guía", url: DRIVE }))).rejects.toThrow(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });

  test("deleting a delivery", async () => {
    withoutSession();
    const { deleteDeliveryAction } = await actions();

    await expect(deleteDeliveryAction(SOME_ID)).rejects.toThrow(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });
});

describe("addDeliveryAction", () => {
  test("adds a YouTube video by its link", async () => {
    withSession();
    const saleId = await newSale();
    const { addDeliveryAction } = await actions();

    const result = await addDeliveryAction(saleId, form({ kind: "youtube", title: "  Review  ", url: YOUTUBE }));

    expect(result).toEqual({ ok: true });
    expect(await listDeliveriesForSale(db, saleId)).toMatchObject([
      { kind: "youtube", title: "Review", youtubeVideoId: "dQw4w9WgXcQ", url: null, fileId: null },
    ]);
  });

  test("adds a link", async () => {
    withSession();
    const saleId = await newSale();
    const { addDeliveryAction } = await actions();

    expect(await addDeliveryAction(saleId, form({ kind: "link", title: "Guía", url: DRIVE }))).toEqual({ ok: true });

    expect(await listDeliveriesForSale(db, saleId)).toMatchObject([{ kind: "link", title: "Guía", url: DRIVE }]);
  });

  test("adds a PDF, judging it by its bytes and not by its name or by the type the browser says", async () => {
    withSession();
    const saleId = await newSale();
    const { addDeliveryAction } = await actions();
    const odd = new File([pdfBytes(200)], "plan.exe", { type: "application/octet-stream" });

    expect(await addDeliveryAction(saleId, form({ kind: "pdf", title: "Plan", file: odd }))).toEqual({ ok: true });

    const [delivery] = await listDeliveriesForSale(db, saleId);
    expect(delivery).toMatchObject({ kind: "pdf", title: "Plan" });
    const stored = await dbFileStore.get(db, delivery.fileId ?? "");
    expect(stored).toMatchObject({ contentType: "application/pdf", size: 200 });
  });

  test("refuses an executable renamed to .pdf that says it is a PDF, and saves nothing", async () => {
    withSession();
    const saleId = await newSale();
    const { addDeliveryAction } = await actions();
    const exe = new File([Buffer.from("MZ\x90\x00\x03\x00\x00\x00 programa de Windows")], "plan.pdf", {
      type: "application/pdf",
    });

    expect(await addDeliveryAction(saleId, form({ kind: "pdf", title: "Plan", file: exe }))).toEqual({
      ok: false,
      error: "not-pdf",
    });
    expect(await counts()).toEqual({ deliveries: 0, files: 0 });
  });

  test("refuses a file of 5 MB, even a real PDF, and saves nothing", async () => {
    withSession();
    const saleId = await newSale();
    const { addDeliveryAction } = await actions();
    const big = new File([pdfBytes(5 * 1024 * 1024)], "grande.pdf", { type: "application/pdf" });

    expect(await addDeliveryAction(saleId, form({ kind: "pdf", title: "Grande", file: big }))).toEqual({
      ok: false,
      error: "too-large",
    });
    expect(await counts()).toEqual({ deliveries: 0, files: 0 });
  });

  test("refuses 4 MB plus one byte and accepts exactly 4 MB, whatever the client checked", async () => {
    withSession();
    const saleId = await newSale();
    const { addDeliveryAction } = await actions();
    const over = new File([pdfBytes(DELIVERY_PDF_MAX_BYTES + 1)], "pasado.pdf", { type: "application/pdf" });
    const exact = new File([pdfBytes(DELIVERY_PDF_MAX_BYTES)], "justo.pdf", { type: "application/pdf" });

    expect(await addDeliveryAction(saleId, form({ kind: "pdf", title: "Pasado", file: over }))).toEqual({
      ok: false,
      error: "too-large",
    });
    expect(await counts()).toEqual({ deliveries: 0, files: 0 });
    expect(await addDeliveryAction(saleId, form({ kind: "pdf", title: "Justo", file: exact }))).toEqual({ ok: true });
  });

  test("refuses a PDF with no file, an empty file, or a text where the file should be", async () => {
    withSession();
    const saleId = await newSale();
    const { addDeliveryAction } = await actions();
    const notPdf = { ok: false, error: "not-pdf" };

    expect(await addDeliveryAction(saleId, form({ kind: "pdf", title: "Sin archivo" }))).toEqual(notPdf);
    expect(await addDeliveryAction(saleId, form({ kind: "pdf", title: "Vacío", file: new File([], "") }))).toEqual(notPdf);
    expect(await addDeliveryAction(saleId, form({ kind: "pdf", title: "Texto", file: "%PDF-1.4 en texto" }))).toEqual(notPdf);
    expect(await counts()).toEqual({ deliveries: 0, files: 0 });
  });

  test("a kind that is not on the list is refused, and so is a missing one", async () => {
    withSession();
    const saleId = await newSale();
    const { addDeliveryAction } = await actions();
    const invalid = { ok: false, error: "invalid-kind" };

    expect(await addDeliveryAction(saleId, form({ kind: "video", title: "Algo", url: YOUTUBE }))).toEqual(invalid);
    expect(await addDeliveryAction(saleId, form({ kind: "", title: "Algo", url: YOUTUBE }))).toEqual(invalid);
    expect(await addDeliveryAction(saleId, form({ title: "Algo", url: YOUTUBE }))).toEqual(invalid);
    expect(await counts()).toEqual({ deliveries: 0, files: 0 });
  });

  test("refuses a bad title, a bad link and a missing field", async () => {
    withSession();
    const saleId = await newSale();
    const { addDeliveryAction } = await actions();

    expect(await addDeliveryAction(saleId, form({ kind: "link", title: "   ", url: DRIVE }))).toEqual({
      ok: false,
      error: "invalid-title",
    });
    expect(await addDeliveryAction(saleId, form({ kind: "link", url: DRIVE }))).toEqual({
      ok: false,
      error: "invalid-title",
    });
    expect(await addDeliveryAction(saleId, form({ kind: "link", title: "Guía", url: "javascript:alert(1)" }))).toEqual({
      ok: false,
      error: "invalid-url",
    });
    expect(await addDeliveryAction(saleId, form({ kind: "link", title: "Guía" }))).toEqual({
      ok: false,
      error: "invalid-url",
    });
    expect(await addDeliveryAction(saleId, form({ kind: "youtube", title: "Video", url: DRIVE }))).toEqual({
      ok: false,
      error: "invalid-url",
    });
    // Un archivo donde va el link no es un link.
    expect(
      await addDeliveryAction(saleId, form({ kind: "link", title: "Guía", url: new File(["https://a.com"], "x.txt") })),
    ).toEqual({ ok: false, error: "invalid-url" });
    expect(await counts()).toEqual({ deliveries: 0, files: 0 });
  });

  test("a sale that does not exist, or an id that is not a uuid, is sale-not-found", async () => {
    withSession();
    const { addDeliveryAction } = await actions();
    const link = form({ kind: "link", title: "Guía", url: DRIVE });

    expect(await addDeliveryAction(UNKNOWN_ID, link)).toEqual({ ok: false, error: "sale-not-found" });
    expect(await addDeliveryAction("no-es-un-uuid", link)).toEqual({ ok: false, error: "sale-not-found" });
    expect(await counts()).toEqual({ deliveries: 0, files: 0 });
  });

  test("only the field of the chosen kind counts: a link sent along with a file is ignored", async () => {
    withSession();
    const saleId = await newSale();
    const { addDeliveryAction } = await actions();
    const file = new File([pdfBytes()], "plan.pdf", { type: "application/pdf" });

    expect(await addDeliveryAction(saleId, form({ kind: "pdf", title: "Plan", url: "no es un link", file }))).toEqual({
      ok: true,
    });
  });
});

describe("deleteDeliveryAction", () => {
  test("deletes the delivery and its file", async () => {
    withSession();
    const saleId = await newSale();
    const { addDeliveryAction, deleteDeliveryAction } = await actions();
    const file = new File([pdfBytes()], "plan.pdf", { type: "application/pdf" });
    await addDeliveryAction(saleId, form({ kind: "pdf", title: "Plan", file }));
    await addDeliveryAction(saleId, form({ kind: "link", title: "Guía", url: DRIVE }));
    const [pdf] = await listDeliveriesForSale(db, saleId);
    expect(pdf.kind).toBe("pdf");

    expect(await deleteDeliveryAction(pdf.id)).toEqual({ ok: true });

    expect(await counts()).toEqual({ deliveries: 1, files: 0 });
  });

  test("says not-found for a delivery that is already gone, an unknown one or an id that is not a uuid", async () => {
    withSession();
    const saleId = await newSale();
    const { addDeliveryAction, deleteDeliveryAction } = await actions();
    await addDeliveryAction(saleId, form({ kind: "link", title: "Guía", url: DRIVE }));
    const [delivery] = await listDeliveriesForSale(db, saleId);

    expect(await deleteDeliveryAction(delivery.id)).toEqual({ ok: true });
    expect(await deleteDeliveryAction(delivery.id)).toEqual({ ok: false, error: "not-found" });
    expect(await deleteDeliveryAction(UNKNOWN_ID)).toEqual({ ok: false, error: "not-found" });
    expect(await deleteDeliveryAction("no-es-un-uuid")).toEqual({ ok: false, error: "not-found" });
  });
});
