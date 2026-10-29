import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { customers, deliveries, deliveryFiles, sales } from "@/db/schema";
import { addLinkDelivery, addPdfDelivery, addYoutubeDelivery } from "@/portal/deliveries";
import { listStudentPurchases, studentFileHref } from "@/portal/purchases";
import { createTestDb } from "../helpers/db";
import { insertTestCustomer, insertTestSale } from "../helpers/portal";

const YOUTUBE = "https://youtu.be/dQw4w9WgXcQ";
const DRIVE = "https://drive.google.com/file/d/1AbC/view?usp=sharing";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const START = new Date("2026-10-28T10:00:00.000Z");

/** Lo que el panel sabe de una venta y el alumno nunca debe ver: cada valor es único para encontrarlo en el resultado. */
const INTERNAL = {
  notes: "NOTA-INTERNA-no-mostrar",
  invoiceNumber: "FACTURA-0001-00099",
  paymentMethod: "mercadopago",
  rateSource: "bcra",
  arsPerUnit: "1517.1234",
  arsPerUsd: "1517.1234",
  amountArsMinor: 98_765_432,
  amountUsdMinor: 7_654_321,
  source: "manual",
} as const;

const PURCHASE_KEYS = ["amountMinor", "currency", "deliveries", "id", "item", "paidOn", "status"];
const YOUTUBE_KEYS = ["createdAt", "id", "kind", "title", "youtubeVideoId"];
const PDF_KEYS = ["createdAt", "fileHref", "id", "kind", "title"];
const LINK_KEYS = ["createdAt", "id", "kind", "title", "url"];

/** La hora `n` segundos después de `START`: el orden de las entregas depende de su hora de alta. */
function at(n: number): Date {
  return new Date(START.getTime() + n * 1000);
}

function pdfBytes(): Uint8Array {
  return new Uint8Array(Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n"));
}

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
  // PGlite toma la zona horaria de la máquina (en la de Tallami, Argentina); la base de verdad, la de
  // Vercel y Supabase, trabaja en UTC. El orden de las compras no puede depender de la zona de la sesión.
  await db.execute(sql`set time zone 'UTC'`);
});

beforeEach(async () => {
  await db.delete(deliveries);
  await db.delete(deliveryFiles);
  await db.delete(sales);
  await db.delete(customers);
});

describe("listStudentPurchases", () => {
  test("returns only the sales of that student, never those of another", async () => {
    const ana = await insertTestCustomer(db, "Ana");
    const beto = await insertTestCustomer(db, "Beto");
    const anaSale = await insertTestSale(db, ana);
    await insertTestSale(db, beto);
    await addYoutubeDelivery(db, anaSale, "Review de Ana", YOUTUBE, at(1));

    const forAna = await listStudentPurchases(db, ana);
    const forBeto = await listStudentPurchases(db, beto);

    expect(forAna.map((purchase) => purchase.id)).toEqual([anaSale]);
    expect(forAna[0].deliveries).toHaveLength(1);
    expect(forBeto).toHaveLength(1);
    expect(forBeto[0].id).not.toBe(anaSale);
    expect(forBeto[0].deliveries).toEqual([]);
  });

  test("is empty for a student without sales, a student that does not exist and something that is not an id", async () => {
    const lonely = await insertTestCustomer(db, "Sin compras");

    expect(await listStudentPurchases(db, lonely)).toEqual([]);
    expect(await listStudentPurchases(db, UNKNOWN_ID)).toEqual([]);
    expect(await listStudentPurchases(db, "no-es-un-id")).toEqual([]);
    expect(await listStudentPurchases(db, "")).toEqual([]);
  });

  test("the keys of every purchase and every delivery are exactly those of the type, whatever the panel stores", async () => {
    const customerId = await insertTestCustomer(db);
    const saleId = await insertTestSale(db, customerId, {
      ...INTERNAL,
      invoiceStatus: "issued",
      invoiceType: "C",
      invoicedOn: "2026-10-13",
      rateQuotedOn: "2026-10-12",
      description: "DESCRIPCION-INTERNA",
    });
    await addYoutubeDelivery(db, saleId, "Video", YOUTUBE, at(1));
    await addLinkDelivery(db, saleId, "Guía", DRIVE, at(2));
    await addPdfDelivery(db, saleId, "Plan", pdfBytes(), at(3));

    const [purchase] = await listStudentPurchases(db, customerId);

    expect(Object.keys(purchase).sort()).toEqual(PURCHASE_KEYS);
    const [video, link, pdf] = purchase.deliveries;
    expect(Object.keys(video).sort()).toEqual(YOUTUBE_KEYS);
    expect(Object.keys(link).sort()).toEqual(LINK_KEYS);
    expect(Object.keys(pdf).sort()).toEqual(PDF_KEYS);
    // Y nada de lo interno aparece en ninguna parte del resultado serializado.
    const everything = JSON.stringify(purchase);
    for (const value of Object.values(INTERNAL)) expect(everything).not.toContain(String(value));
    expect(everything).not.toContain("DESCRIPCION-INTERNA");
    expect(everything).not.toContain("FACTURA");
    expect(everything).not.toContain(customerId);
  });

  test("a purchase carries the item, status, day of payment and the amount in the currency of the sale", async () => {
    const customerId = await insertTestCustomer(db);
    const saleId = await insertTestSale(db, customerId, {
      item: "vodRecorded",
      status: "delivered",
      paidOn: "2026-10-05",
      currency: "BRL",
      amountMinor: 15_050,
    });

    const [purchase] = await listStudentPurchases(db, customerId);

    expect(purchase).toEqual({
      id: saleId,
      item: "vodRecorded",
      status: "delivered",
      paidOn: "2026-10-05",
      amountMinor: 15_050,
      currency: "BRL",
      deliveries: [],
    });
  });

  test("a sale that is still pending has no day of payment", async () => {
    const customerId = await insertTestCustomer(db);
    await insertTestSale(db, customerId, { status: "pending", paidOn: null });

    const [purchase] = await listStudentPurchases(db, customerId);

    expect(purchase.status).toBe("pending");
    expect(purchase.paidOn).toBeNull();
  });

  test("lists the newest first, by day of payment and then by when they were created", async () => {
    const customerId = await insertTestCustomer(db);
    const september = await insertTestSale(db, customerId, {
      paidOn: "2026-09-01",
      createdAt: new Date("2026-09-01T12:00:00Z"),
    });
    const octoberEarly = await insertTestSale(db, customerId, {
      paidOn: "2026-10-12",
      createdAt: new Date("2026-10-12T09:00:00Z"),
    });
    const octoberLate = await insertTestSale(db, customerId, {
      paidOn: "2026-10-12",
      createdAt: new Date("2026-10-12T18:00:00Z"),
    });

    const purchases = await listStudentPurchases(db, customerId);

    expect(purchases.map((purchase) => purchase.id)).toEqual([octoberLate, octoberEarly, september]);
  });

  test("a purchase that was not paid counts from the day it was created: a new pending one is on top, an old cancelled one does not stay there", async () => {
    const customerId = await insertTestCustomer(db);
    const paid = await insertTestSale(db, customerId, {
      paidOn: "2026-09-01",
      createdAt: new Date("2026-09-01T12:00:00Z"),
    });
    const oldCancelled = await insertTestSale(db, customerId, {
      status: "cancelled",
      paidOn: null,
      createdAt: new Date("2026-08-01T12:00:00Z"),
    });
    const newPending = await insertTestSale(db, customerId, {
      status: "pending",
      paidOn: null,
      createdAt: new Date("2026-10-20T12:00:00Z"),
    });

    const purchases = await listStudentPurchases(db, customerId);

    expect(purchases.map((purchase) => purchase.id)).toEqual([newPending, paid, oldCancelled]);
  });

  test("the day a purchase was created is the day in Argentina: one made at 01:00 UTC still belongs to the day before", async () => {
    const customerId = await insertTestCustomer(db);
    // 01:00 UTC del 11 son las 22:00 del 10 en Buenos Aires: va después de una cobrada el 11. Se cargó más tarde
    // que esa (en UTC los dos serían del 11 y ganaría por la hora de alta), así que solo la zona horaria las ordena.
    const lateEvening = await insertTestSale(db, customerId, {
      status: "pending",
      paidOn: null,
      createdAt: new Date("2026-10-11T01:00:00Z"),
    });
    const paidThe11th = await insertTestSale(db, customerId, {
      paidOn: "2026-10-11",
      createdAt: new Date("2026-10-10T12:00:00Z"),
    });

    const purchases = await listStudentPurchases(db, customerId);

    expect(purchases.map((purchase) => purchase.id)).toEqual([paidThe11th, lateEvening]);
  });

  test("lists the deliveries of each sale in the order they were added, with their own fields only", async () => {
    const customerId = await insertTestCustomer(db);
    const first = await insertTestSale(db, customerId, { paidOn: "2026-10-01" });
    const second = await insertTestSale(db, customerId, { paidOn: "2026-10-02" });
    await addLinkDelivery(db, first, "B segundo", DRIVE, at(20));
    await addYoutubeDelivery(db, first, "A primero", YOUTUBE, at(10));
    await addPdfDelivery(db, second, "Plan", pdfBytes(), at(5));

    const purchases = await listStudentPurchases(db, customerId);

    // La más nueva primero; adentro de cada una, las entregas en el orden en que se cargaron.
    expect(purchases.map((purchase) => purchase.id)).toEqual([second, first]);
    expect(purchases[1].deliveries.map((delivery) => delivery.title)).toEqual(["A primero", "B segundo"]);
    expect(purchases[0].deliveries.map((delivery) => delivery.title)).toEqual(["Plan"]);
  });

  test("a YouTube delivery carries the id of the video, a link its address and a PDF the address of the portal route", async () => {
    const customerId = await insertTestCustomer(db);
    const saleId = await insertTestSale(db, customerId);
    await addYoutubeDelivery(db, saleId, "Video", YOUTUBE, at(1));
    await addLinkDelivery(db, saleId, "Guía", DRIVE, at(2));
    await addPdfDelivery(db, saleId, "Plan", pdfBytes(), at(3));

    const [{ deliveries: list }] = await listStudentPurchases(db, customerId);

    expect(list[0]).toMatchObject({ kind: "youtube", title: "Video", youtubeVideoId: "dQw4w9WgXcQ" });
    expect(list[1]).toMatchObject({ kind: "link", title: "Guía", url: DRIVE });
    expect(list[2]).toMatchObject({ kind: "pdf", title: "Plan" });
    expect(list[2].fileHref).toBe(studentFileHref(list[2].id));
    expect(list[2].fileHref).toBe(`/api/portal/files/${list[2].id}`);
  });

  test("the creation moment of a delivery is an ISO text, not a Date", async () => {
    const customerId = await insertTestCustomer(db);
    const saleId = await insertTestSale(db, customerId);
    await addYoutubeDelivery(db, saleId, "Video", YOUTUBE, at(0));

    const [{ deliveries: list }] = await listStudentPurchases(db, customerId);

    expect(list[0].createdAt).toBe("2026-10-28T10:00:00.000Z");
  });

  test("a sale with several deliveries comes out once, not once per delivery", async () => {
    const customerId = await insertTestCustomer(db);
    const saleId = await insertTestSale(db, customerId);
    await addYoutubeDelivery(db, saleId, "Uno", YOUTUBE, at(1));
    await addLinkDelivery(db, saleId, "Dos", DRIVE, at(2));
    await addLinkDelivery(db, saleId, "Tres", DRIVE, at(3));

    const purchases = await listStudentPurchases(db, customerId);

    expect(purchases).toHaveLength(1);
    expect(purchases[0].deliveries).toHaveLength(3);
  });

  test("the delivery of another student's sale never shows up, even with the same title", async () => {
    const ana = await insertTestCustomer(db, "Ana");
    const beto = await insertTestCustomer(db, "Beto");
    const anaSale = await insertTestSale(db, ana);
    const betoSale = await insertTestSale(db, beto);
    await addPdfDelivery(db, anaSale, "Plan secreto de Ana", pdfBytes(), at(1));
    await addLinkDelivery(db, betoSale, "Guía de Beto", DRIVE, at(2));

    const forBeto = await listStudentPurchases(db, beto);

    expect(JSON.stringify(forBeto)).not.toContain("Plan secreto de Ana");
    expect(forBeto[0].deliveries.map((delivery) => delivery.title)).toEqual(["Guía de Beto"]);
  });
});
