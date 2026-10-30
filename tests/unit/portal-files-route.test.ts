// Las dos rutas que sirven el PDF de una entrega: la del portal (`/api/portal/files/[deliveryId]`,
// solo para el alumno dueño) y la del panel (`/admin/ventas/[id]/entregas/[deliveryId]`, solo
// para Tallami). A cualquier otro les contestan 404 sin cuerpo y sin una pista de si la entrega
// existe: un alumno que cambia el id en la dirección no aprende nada.

import { NextRequest } from "next/server";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { requireAdmin } from "@/admin/auth/require-admin";
import { getDb, type Db } from "@/db/client";
import { customers, deliveries, deliveryFiles, portalAccounts, sales } from "@/db/schema";
import { addLinkDelivery, addPdfDelivery, addYoutubeDelivery, listDeliveriesForSale } from "@/portal/deliveries";
import { PORTAL_COOKIE, createPortalSession, revokePortalSession } from "@/portal/sessions";
import { PORTAL_SESSION_MS } from "@/portal/policy";
import { createTestDb } from "../helpers/db";
import { insertTestAccount, insertTestCustomer, insertTestSale } from "../helpers/portal";

vi.mock("@/admin/auth/require-admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

const NO_SESSION = "NEXT_REDIRECT /admin/login";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const DRIVE = "https://drive.google.com/file/d/1AbC/view?usp=sharing";
const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Los encabezados exactos de un PDF servido, y nada más. */
const PDF_HEADERS = {
  "content-type": "application/pdf",
  "content-disposition": 'inline; filename="entrega.pdf"',
  "cache-control": "private, no-store",
  "x-content-type-options": "nosniff",
};

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  vi.mocked(requireAdmin).mockReset();
  vi.mocked(getDb).mockReset();
  vi.mocked(getDb).mockResolvedValue(db);
  await db.delete(portalAccounts);
  await db.delete(deliveries);
  await db.delete(deliveryFiles);
  await db.delete(sales);
  await db.delete(customers);
});

/** Un PDF reconocible, con el contenido que se pide. */
function pdfWith(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(`%PDF-1.4\n${text}\n%%EOF`));
}

interface Student {
  customerId: string;
  saleId: string;
  accountId: string;
  /** La cookie de una sesión abierta de este alumno. */
  cookie: string;
}

/** Un alumno con su venta, su cuenta del portal vinculada y una sesión abierta. */
async function student(name: string): Promise<Student> {
  const customerId = await insertTestCustomer(db, name);
  const saleId = await insertTestSale(db, customerId);
  const accountId = await insertTestAccount(db, { customerId, displayName: name });
  const token = await createPortalSession(db, accountId);
  return { customerId, saleId, accountId, cookie: `${PORTAL_COOKIE}=${token}` };
}

/** El id de la única entrega de la venta. */
async function onlyDeliveryOf(saleId: string): Promise<string> {
  const list = await listDeliveriesForSale(db, saleId);
  expect(list).toHaveLength(1);
  return list[0].id;
}

/** Lo que se puede ver de una respuesta: el estado, todos los encabezados y el cuerpo. */
async function seen(response: Response) {
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers),
    bytes: Buffer.from(await response.arrayBuffer()),
  };
}

describe("the portal route /api/portal/files/[deliveryId]", () => {
  async function portalGet(deliveryId: string, cookie?: string): Promise<Response> {
    const { GET } = await import("@/app/api/portal/files/[deliveryId]/route");
    const request = new NextRequest(`http://localhost/api/portal/files/${deliveryId}`, {
      headers: cookie ? { cookie } : {},
    });
    return GET(request, { params: Promise.resolve({ deliveryId }) });
  }

  /** La respuesta de un 404 que no dice nada: sin cuerpo. */
  async function expectNotFound(response: Response) {
    const result = await seen(response);
    expect(result.status).toBe(404);
    expect(result.bytes).toHaveLength(0);
    return result;
  }

  test("gives the PDF to its owner, with exactly the headers of the design", async () => {
    const ana = await student("Ana");
    const bytes = pdfWith("el plan de Ana");
    await addPdfDelivery(db, ana.saleId, "Plan", bytes);
    const deliveryId = await onlyDeliveryOf(ana.saleId);

    const result = await seen(await portalGet(deliveryId, ana.cookie));

    expect(result.status).toBe(200);
    expect(result.headers).toEqual(PDF_HEADERS);
    expect(result.bytes.equals(Buffer.from(bytes))).toBe(true);
  });

  test("answers 404 with no body to a request without a session, and does not open the database", async () => {
    const ana = await student("Ana");
    await addPdfDelivery(db, ana.saleId, "Plan", pdfWith("secreto"));
    const deliveryId = await onlyDeliveryOf(ana.saleId);

    const result = await expectNotFound(await portalGet(deliveryId));

    expect(getDb).not.toHaveBeenCalled();
    expect(result.headers["content-type"]).toBeUndefined();
    expect(result.headers["content-disposition"]).toBeUndefined();
  });

  test("answers 404 to the session of another student: changing the id in the address shows nothing", async () => {
    const ana = await student("Ana");
    const beto = await student("Beto");
    await addPdfDelivery(db, ana.saleId, "Plan de Ana", pdfWith("secreto de Ana"));
    const anasDelivery = await onlyDeliveryOf(ana.saleId);

    const result = await expectNotFound(await portalGet(anasDelivery, beto.cookie));

    expect(result.bytes.toString()).not.toContain("secreto");
  });

  test("the 404 for someone else's file is identical to the 404 for a file that does not exist", async () => {
    const ana = await student("Ana");
    const beto = await student("Beto");
    await addPdfDelivery(db, ana.saleId, "Plan de Ana", pdfWith("secreto de Ana"));
    const anasDelivery = await onlyDeliveryOf(ana.saleId);

    const someoneElses = await seen(await portalGet(anasDelivery, beto.cookie));
    const doesNotExist = await seen(await portalGet(UNKNOWN_ID, beto.cookie));
    const notAnId = await seen(await portalGet("no-es-un-id", beto.cookie));
    const noSession = await seen(await portalGet(anasDelivery));

    expect(someoneElses.status).toBe(404);
    expect(doesNotExist).toEqual(someoneElses);
    expect(notAnId).toEqual(someoneElses);
    expect(noSession).toEqual(someoneElses);
  });

  test.each([
    ["a session that does not exist", `${PORTAL_COOKIE}=${"a".repeat(43)}`],
    ["something that is not a token", `${PORTAL_COOKIE}=hola`],
    ["an empty cookie", `${PORTAL_COOKIE}=`],
    ["the cookie of the panel", `tallami_admin=${"b".repeat(43)}`],
  ])("answers 404 with %s", async (_label, cookie) => {
    const ana = await student("Ana");
    await addPdfDelivery(db, ana.saleId, "Plan", pdfWith("secreto"));

    await expectNotFound(await portalGet(await onlyDeliveryOf(ana.saleId), cookie));
  });

  test("answers 404 to a session that was closed or has expired", async () => {
    const ana = await student("Ana");
    await addPdfDelivery(db, ana.saleId, "Plan", pdfWith("secreto"));
    const deliveryId = await onlyDeliveryOf(ana.saleId);
    const closedToken = await createPortalSession(db, ana.accountId);
    await revokePortalSession(db, closedToken);
    const oldToken = await createPortalSession(db, ana.accountId, new Date(Date.now() - PORTAL_SESSION_MS - DAY_MS));

    await expectNotFound(await portalGet(deliveryId, `${PORTAL_COOKIE}=${closedToken}`));
    await expectNotFound(await portalGet(deliveryId, `${PORTAL_COOKIE}=${oldToken}`));
    // La sesión abierta de verdad sigue sirviendo.
    expect((await portalGet(deliveryId, ana.cookie)).status).toBe(200);
  });

  test("answers 404 to an account that is not linked to any student", async () => {
    const ana = await student("Ana");
    await addPdfDelivery(db, ana.saleId, "Plan", pdfWith("secreto"));
    const deliveryId = await onlyDeliveryOf(ana.saleId);
    const loose = await insertTestAccount(db);
    const looseToken = await createPortalSession(db, loose);

    await expectNotFound(await portalGet(deliveryId, `${PORTAL_COOKIE}=${looseToken}`));
  });

  test("answers 404 once the account is unlinked from the student", async () => {
    const ana = await student("Ana");
    await addPdfDelivery(db, ana.saleId, "Plan", pdfWith("secreto"));
    const deliveryId = await onlyDeliveryOf(ana.saleId);
    expect((await portalGet(deliveryId, ana.cookie)).status).toBe(200);

    await db.update(portalAccounts).set({ customerId: null });

    await expectNotFound(await portalGet(deliveryId, ana.cookie));
  });

  test("answers 404 for a delivery of the owner that is not a file", async () => {
    const ana = await student("Ana");
    await addYoutubeDelivery(db, ana.saleId, "Video", YOUTUBE);
    await addLinkDelivery(db, ana.saleId, "Link", DRIVE);

    for (const delivery of await listDeliveriesForSale(db, ana.saleId)) {
      await expectNotFound(await portalGet(delivery.id, ana.cookie));
    }
  });

  test("a student gets each of their own PDFs, one per purchase", async () => {
    const ana = await student("Ana");
    const secondSale = await insertTestSale(db, ana.customerId);
    await addPdfDelivery(db, ana.saleId, "Primero", pdfWith("primero"));
    await addPdfDelivery(db, secondSale, "Segundo", pdfWith("segundo"));
    const first = await onlyDeliveryOf(ana.saleId);
    const second = await onlyDeliveryOf(secondSale);

    expect((await seen(await portalGet(first, ana.cookie))).bytes.toString()).toContain("primero");
    expect((await seen(await portalGet(second, ana.cookie))).bytes.toString()).toContain("segundo");
  });
});

describe("the panel route /admin/ventas/[id]/entregas/[deliveryId]", () => {
  async function adminGet(saleId: string, deliveryId: string): Promise<Response> {
    const { GET } = await import("@/app/admin/ventas/[id]/entregas/[deliveryId]/route");
    const request = new NextRequest(`http://localhost/admin/ventas/${saleId}/entregas/${deliveryId}`);
    return GET(request, { params: Promise.resolve({ id: saleId, deliveryId }) });
  }

  test("without a session nothing is read", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error(NO_SESSION));
    const ana = await student("Ana");
    await addPdfDelivery(db, ana.saleId, "Plan", pdfWith("secreto"));
    const deliveryId = await onlyDeliveryOf(ana.saleId);
    vi.mocked(getDb).mockClear();

    await expect(adminGet(ana.saleId, deliveryId)).rejects.toThrow(NO_SESSION);
    expect(getDb).not.toHaveBeenCalled();
  });

  test("gives the PDF to the signed-in admin, with exactly the headers of the design", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined);
    const ana = await student("Ana");
    const bytes = pdfWith("el plan de Ana");
    await addPdfDelivery(db, ana.saleId, "Plan", bytes);

    const result = await seen(await adminGet(ana.saleId, await onlyDeliveryOf(ana.saleId)));

    expect(result.status).toBe(200);
    expect(result.headers).toEqual(PDF_HEADERS);
    expect(result.bytes.equals(Buffer.from(bytes))).toBe(true);
  });

  test("answers 404 with no body for another sale's id, a delivery that is not a file, unknown ids and ids that are not uuids", async () => {
    vi.mocked(requireAdmin).mockResolvedValue(undefined);
    const ana = await student("Ana");
    const beto = await student("Beto");
    await addPdfDelivery(db, ana.saleId, "Plan", pdfWith("secreto"));
    await addYoutubeDelivery(db, beto.saleId, "Video", YOUTUBE);
    const pdfId = await onlyDeliveryOf(ana.saleId);
    const videoId = await onlyDeliveryOf(beto.saleId);

    const attempts: [string, string][] = [
      [beto.saleId, pdfId],
      [ana.saleId, videoId],
      [beto.saleId, videoId],
      [ana.saleId, UNKNOWN_ID],
      [UNKNOWN_ID, pdfId],
      [ana.saleId, "no-es-un-id"],
      ["no-es-un-id", pdfId],
    ];
    for (const [saleId, deliveryId] of attempts) {
      const result = await seen(await adminGet(saleId, deliveryId));
      expect(result.status, `${saleId} ${deliveryId}`).toBe(404);
      expect(result.bytes, `${saleId} ${deliveryId}`).toHaveLength(0);
    }
  });
});
