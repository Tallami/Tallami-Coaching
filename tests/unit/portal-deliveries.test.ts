import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";
import type { Db } from "@/db/client";
import { customers, deliveries, deliveryFiles, sales } from "@/db/schema";
import {
  addLinkDelivery,
  addPdfDelivery,
  addYoutubeDelivery,
  deleteDelivery,
  deliveryForStudent,
  getDeliveryOfSale,
  listDeliveriesForSale,
} from "@/portal/deliveries";
import { dbFileStore, isPdf } from "@/portal/files";
import { DELIVERY_PDF_MAX_BYTES, DELIVERY_TITLE_MAX_LENGTH } from "@/portal/policy";
import { createTestDb } from "../helpers/db";
import { insertTestCustomer, insertTestSale } from "../helpers/portal";

const YOUTUBE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
const DRIVE = "https://drive.google.com/file/d/1AbC/view?usp=sharing";
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const START = new Date("2026-10-28T10:00:00.000Z");

/** La hora `n` segundos después de `START`: los tests que miran el orden fijan la hora de alta de cada entrega. */
function at(n: number): Date {
  return new Date(START.getTime() + n * 1000);
}

let db: Db;

beforeAll(async () => {
  db = await createTestDb();
});

beforeEach(async () => {
  await db.delete(deliveries);
  await db.delete(deliveryFiles);
  await db.delete(sales);
  await db.delete(customers);
});

/** Bytes que empiezan como un PDF, del tamaño pedido. */
function pdfBytes(size = 64): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(Buffer.from("%PDF-1.4\n"));
  return bytes;
}

/** Lo que hay en la base de entregas y de archivos: lo que "no se guardó nada" quiere decir. */
async function counts(): Promise<{ deliveries: number; files: number }> {
  return {
    deliveries: (await db.select({ id: deliveries.id }).from(deliveries)).length,
    files: (await db.select({ id: deliveryFiles.id }).from(deliveryFiles)).length,
  };
}

/** Una venta de un alumno nuevo; devuelve los dos ids. */
async function saleOfNewStudent(name = "Alumno de prueba"): Promise<{ customerId: string; saleId: string }> {
  const customerId = await insertTestCustomer(db, name);
  return { customerId, saleId: await insertTestSale(db, customerId) };
}

describe("isPdf", () => {
  test("is true for bytes that start with %PDF-", () => {
    expect(isPdf(Buffer.from("%PDF-1.7\n%âãÏÓ"))).toBe(true);
    expect(isPdf(Buffer.from("%PDF-"))).toBe(true);
  });

  test.each([
    ["nothing", Buffer.alloc(0)],
    ["a prefix of the mark", Buffer.from("%PDF")],
    ["the mark without the hyphen", Buffer.from("%PDF1.4")],
    ["a space before the mark", Buffer.from(" %PDF-1.4")],
    ["a line break before the mark", Buffer.from("\n%PDF-1.4")],
    ["a Windows executable", Buffer.from("MZ\x90\x00\x03\x00\x00\x00")],
    ["the mark in lowercase", Buffer.from("%pdf-1.4")],
    ["the mark later in the file", Buffer.from("GIF89a....%PDF-1.4")],
  ])("is false for %s", (_label, bytes) => {
    expect(isPdf(bytes)).toBe(false);
  });
});

describe("the database file store", () => {
  test("keeps the bytes, the type and the size, and gives them back", async () => {
    const bytes = pdfBytes(300);

    const id = await dbFileStore.put(db, bytes, "application/pdf");
    const file = await dbFileStore.get(db, id);

    expect(file).not.toBeNull();
    expect(file?.contentType).toBe("application/pdf");
    expect(file?.size).toBe(300);
    expect(Buffer.from(file?.bytes ?? []).equals(Buffer.from(bytes))).toBe(true);
  });

  test("get is null for a file that does not exist or an id that is not a uuid", async () => {
    expect(await dbFileStore.get(db, UNKNOWN_ID)).toBeNull();
    expect(await dbFileStore.get(db, "no-es-un-uuid")).toBeNull();
    expect(await dbFileStore.get(db, "")).toBeNull();
  });

  test("remove deletes the file, and removing it again does nothing", async () => {
    const id = await dbFileStore.put(db, pdfBytes(), "application/pdf");

    await dbFileStore.remove(db, id);
    await dbFileStore.remove(db, id);
    await dbFileStore.remove(db, "no-es-un-uuid");

    expect(await dbFileStore.get(db, id)).toBeNull();
    expect((await counts()).files).toBe(0);
  });
});

describe("a YouTube delivery", () => {
  test("keeps only the video id, with the title", async () => {
    const { saleId } = await saleOfNewStudent();

    const result = await addYoutubeDelivery(db, saleId, "Review de tu partida", YOUTUBE);

    expect(result).toEqual({ ok: true });
    const [row] = await db.select().from(deliveries);
    expect(row).toMatchObject({
      saleId,
      kind: "youtube",
      title: "Review de tu partida",
      youtubeVideoId: "dQw4w9WgXcQ",
      url: null,
      fileId: null,
    });
  });

  test.each([
    ["http", "http://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["a look-alike domain", "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ"],
    ["another site", "https://vimeo.com/123456"],
    ["an id that is too short", "https://youtu.be/dQw4w9WgXc"],
    ["javascript", "javascript:alert(1)"],
    ["empty", ""],
  ])("refuses %s as invalid-url and saves nothing", async (_label, link) => {
    const { saleId } = await saleOfNewStudent();

    expect(await addYoutubeDelivery(db, saleId, "Un video", link)).toEqual({ ok: false, error: "invalid-url" });
    expect(await counts()).toEqual({ deliveries: 0, files: 0 });
  });
});

describe("a link delivery", () => {
  test("keeps the https link", async () => {
    const { saleId } = await saleOfNewStudent();

    expect(await addLinkDelivery(db, saleId, "Guía completa", DRIVE)).toEqual({ ok: true });

    const [row] = await db.select().from(deliveries);
    expect(row).toMatchObject({ saleId, kind: "link", title: "Guía completa", url: DRIVE, youtubeVideoId: null, fileId: null });
  });

  test("keeps the link as the browser would read it, without the spaces around it", async () => {
    const { saleId } = await saleOfNewStudent();

    await addLinkDelivery(db, saleId, "Sitio", "  HTTPS://Ejemplo.COM  ", at(1));
    await addLinkDelivery(db, saleId, "Con ruta", "https://ejemplo.com/a b?x=1#parte", at(2));

    const urls = (await listDeliveriesForSale(db, saleId)).map((delivery) => delivery.url);
    expect(urls).toEqual(["https://ejemplo.com/", "https://ejemplo.com/a%20b?x=1#parte"]);
  });

  test.each([
    ["http", "http://ejemplo.com/guia"],
    ["javascript", "javascript:alert(1)"],
    ["javascript in capitals", "JavaScript:alert(1)"],
    ["data", "data:text/html,<script>alert(1)</script>"],
    ["a file path", "file:///C:/Windows/win.ini"],
    ["ftp", "ftp://ejemplo.com/guia.pdf"],
    ["a bare https://", "https://"],
    ["https: and nothing else", "https:"],
    ["https with only a slash", "https:///"],
    ["a link with no protocol", "ejemplo.com/guia"],
    ["a protocol-relative link", "//ejemplo.com/guia"],
    ["a relative path", "/admin/ventas"],
    ["user and password in the link", "https://usuario:clave@ejemplo.com/guia"],
    ["only a user in the link", "https://usuario@ejemplo.com/guia"],
    ["a space in the host", "https://ejemplo .com/guia"],
    ["a text that is not a link", "mirá la guía"],
    ["empty", ""],
    ["only spaces", "   "],
    ["a link longer than 2048 characters", `https://ejemplo.com/${"a".repeat(2048)}`],
  ])("refuses %s as invalid-url and saves nothing", async (_label, link) => {
    const { saleId } = await saleOfNewStudent();

    expect(await addLinkDelivery(db, saleId, "Una guía", link)).toEqual({ ok: false, error: "invalid-url" });
    expect(await counts()).toEqual({ deliveries: 0, files: 0 });
  });

  test("accepts a link of exactly 2048 characters", async () => {
    const { saleId } = await saleOfNewStudent();
    const link = `https://ejemplo.com/${"a".repeat(2048 - "https://ejemplo.com/".length)}`;

    expect(link).toHaveLength(2048);
    expect(await addLinkDelivery(db, saleId, "Largo", link)).toEqual({ ok: true });
  });
});

describe("the title of any delivery", () => {
  /** Las tres formas de agregar, con un título cualquiera. */
  const adders: [string, (saleId: string, title: string) => Promise<unknown>][] = [
    ["youtube", (saleId, title) => addYoutubeDelivery(db, saleId, title, YOUTUBE)],
    ["link", (saleId, title) => addLinkDelivery(db, saleId, title, DRIVE)],
    ["pdf", (saleId, title) => addPdfDelivery(db, saleId, title, pdfBytes())],
  ];

  describe.each(adders)("%s", (_kind, add) => {
    test.each([
      ["empty", ""],
      ["only spaces", "   "],
      ["only tabs, line breaks and non-breaking spaces", "\t\n \u00a0\u2003"],
      ["121 characters", "a".repeat(DELIVERY_TITLE_MAX_LENGTH + 1)],
      ["121 characters of emoji", "\u{1F600}".repeat(DELIVERY_TITLE_MAX_LENGTH + 1)],
      ["a line break in the middle", "Primera línea\nsegunda"],
      ["a NUL character", "Con\u0000nulo"],
      ["a control character", "Con\u0007campana"],
    ])("refuses a title that is %s, and saves nothing", async (_label, title) => {
      const { saleId } = await saleOfNewStudent();

      expect(await add(saleId, title)).toEqual({ ok: false, error: "invalid-title" });
      expect(await counts()).toEqual({ deliveries: 0, files: 0 });
    });

    test("accepts 120 characters, counting an emoji as one", async () => {
      const { saleId } = await saleOfNewStudent();

      expect(DELIVERY_TITLE_MAX_LENGTH).toBe(120);
      expect(await add(saleId, "a".repeat(120))).toEqual({ ok: true });
      expect(await add(saleId, "\u{1F600}".repeat(120))).toEqual({ ok: true });
    });

    test("keeps the title without the spaces around it", async () => {
      const { saleId } = await saleOfNewStudent();

      expect(await add(saleId, "  \u00a0Plan de juego\t ")).toEqual({ ok: true });

      const [delivery] = await listDeliveriesForSale(db, saleId);
      expect(delivery.title).toBe("Plan de juego");
    });

    test("measures the title once the spaces around it are gone", async () => {
      const { saleId } = await saleOfNewStudent();

      expect(await add(saleId, ` ${"a".repeat(120)} `)).toEqual({ ok: true });
    });
  });
});

describe("a PDF delivery", () => {
  test("keeps the file apart, and the delivery points to it", async () => {
    const { saleId } = await saleOfNewStudent();
    const bytes = pdfBytes(2048);

    expect(await addPdfDelivery(db, saleId, "Tu plan de juego", bytes)).toEqual({ ok: true });

    const [row] = await db.select().from(deliveries);
    expect(row).toMatchObject({ saleId, kind: "pdf", title: "Tu plan de juego", youtubeVideoId: null, url: null });
    expect(row.fileId).not.toBeNull();
    const file = await dbFileStore.get(db, row.fileId ?? "");
    expect(file).toMatchObject({ contentType: "application/pdf", size: 2048 });
    expect(Buffer.from(file?.bytes ?? []).equals(Buffer.from(bytes))).toBe(true);
  });

  test("accepts a file of exactly 4 MB", async () => {
    const { saleId } = await saleOfNewStudent();

    expect(DELIVERY_PDF_MAX_BYTES).toBe(4 * 1024 * 1024);
    expect(await addPdfDelivery(db, saleId, "Justo", pdfBytes(DELIVERY_PDF_MAX_BYTES))).toEqual({ ok: true });
    const [row] = await db.select({ fileId: deliveries.fileId }).from(deliveries);
    expect((await dbFileStore.get(db, row.fileId ?? ""))?.size).toBe(DELIVERY_PDF_MAX_BYTES);
  });

  test("refuses 4 MB plus one byte as too-large, and saves nothing", async () => {
    const { saleId } = await saleOfNewStudent();

    expect(await addPdfDelivery(db, saleId, "Pasado", pdfBytes(DELIVERY_PDF_MAX_BYTES + 1))).toEqual({
      ok: false,
      error: "too-large",
    });
    expect(await counts()).toEqual({ deliveries: 0, files: 0 });
  });

  test("refuses bytes that do not start with %PDF- as not-pdf, and saves nothing", async () => {
    const { saleId } = await saleOfNewStudent();
    const executable = new Uint8Array(1024);
    executable.set(Buffer.from("MZ\x90\x00\x03\x00\x00\x00This program cannot be run in DOS mode."));

    expect(await addPdfDelivery(db, saleId, "Parece un PDF", executable)).toEqual({ ok: false, error: "not-pdf" });
    expect(await addPdfDelivery(db, saleId, "Vacío", new Uint8Array(0))).toEqual({ ok: false, error: "not-pdf" });
    expect(await addPdfDelivery(db, saleId, "Casi", Buffer.from("%PDF"))).toEqual({ ok: false, error: "not-pdf" });
    expect(await counts()).toEqual({ deliveries: 0, files: 0 });
  });

  test("a big file that is not a PDF is too-large, and still saves nothing", async () => {
    const { saleId } = await saleOfNewStudent();

    expect(await addPdfDelivery(db, saleId, "Un exe de 5 MB", new Uint8Array(5 * 1024 * 1024))).toEqual({
      ok: false,
      error: "too-large",
    });
    expect(await counts()).toEqual({ deliveries: 0, files: 0 });
  });

  test("a sale that does not exist leaves no orphan file", async () => {
    expect(await addPdfDelivery(db, UNKNOWN_ID, "Sin venta", pdfBytes())).toEqual({ ok: false, error: "sale-not-found" });
    expect(await counts()).toEqual({ deliveries: 0, files: 0 });
  });
});

describe("a sale that does not exist", () => {
  test.each([
    ["an unknown uuid", UNKNOWN_ID],
    ["something that is not a uuid", "no-es-un-uuid"],
    ["an empty id", ""],
  ])("with %s every kind answers sale-not-found", async (_label, saleId) => {
    const notFound = { ok: false, error: "sale-not-found" };

    expect(await addYoutubeDelivery(db, saleId, "Video", YOUTUBE)).toEqual(notFound);
    expect(await addLinkDelivery(db, saleId, "Link", DRIVE)).toEqual(notFound);
    expect(await addPdfDelivery(db, saleId, "PDF", pdfBytes())).toEqual(notFound);
    expect(await counts()).toEqual({ deliveries: 0, files: 0 });
  });
});

describe("deleteDelivery", () => {
  test("removes a YouTube delivery and leaves the rest of the sale alone", async () => {
    const { saleId } = await saleOfNewStudent();
    await addYoutubeDelivery(db, saleId, "Se va", YOUTUBE, at(1));
    await addLinkDelivery(db, saleId, "Se queda", DRIVE, at(2));
    const [gone] = await listDeliveriesForSale(db, saleId);

    expect(await deleteDelivery(db, gone.id)).toBe(true);

    expect((await listDeliveriesForSale(db, saleId)).map((delivery) => delivery.title)).toEqual(["Se queda"]);
  });

  test("removes the file of a PDF delivery in the same go: no orphan file row remains", async () => {
    const { saleId } = await saleOfNewStudent();
    await addPdfDelivery(db, saleId, "El PDF", pdfBytes(500));
    const [pdf] = await listDeliveriesForSale(db, saleId);
    expect(pdf.fileId).not.toBeNull();
    expect((await counts()).files).toBe(1);

    expect(await deleteDelivery(db, pdf.id)).toBe(true);

    expect(await counts()).toEqual({ deliveries: 0, files: 0 });
    expect(await dbFileStore.get(db, pdf.fileId ?? "")).toBeNull();
  });

  test("removes only its own file when the sale has several PDFs", async () => {
    const { saleId } = await saleOfNewStudent();
    await addPdfDelivery(db, saleId, "Primero", pdfBytes(100), at(1));
    await addPdfDelivery(db, saleId, "Segundo", pdfBytes(200), at(2));
    const [first, second] = await listDeliveriesForSale(db, saleId);

    await deleteDelivery(db, first.id);

    expect(await counts()).toEqual({ deliveries: 1, files: 1 });
    expect((await dbFileStore.get(db, second.fileId ?? ""))?.size).toBe(200);
  });

  test("answers false for a delivery that is already gone, an unknown one or an id that is not a uuid", async () => {
    const { saleId } = await saleOfNewStudent();
    await addLinkDelivery(db, saleId, "Una vez", DRIVE);
    const [delivery] = await listDeliveriesForSale(db, saleId);

    expect(await deleteDelivery(db, delivery.id)).toBe(true);
    expect(await deleteDelivery(db, delivery.id)).toBe(false);
    expect(await deleteDelivery(db, UNKNOWN_ID)).toBe(false);
    expect(await deleteDelivery(db, "no-es-un-uuid")).toBe(false);
  });
});

describe("listDeliveriesForSale", () => {
  test("lists only the deliveries of that sale, in the order they were added", async () => {
    const { saleId } = await saleOfNewStudent("Ana");
    const other = await saleOfNewStudent("Beto");
    await addLinkDelivery(db, saleId, "Uno", DRIVE, at(1));
    await addLinkDelivery(db, other.saleId, "De Beto", DRIVE, at(2));
    await addYoutubeDelivery(db, saleId, "Dos", YOUTUBE, at(3));
    await addPdfDelivery(db, saleId, "Tres", pdfBytes(), at(4));

    const list = await listDeliveriesForSale(db, saleId);

    expect(list.map((delivery) => delivery.title)).toEqual(["Uno", "Dos", "Tres"]);
    expect(list.map((delivery) => delivery.kind)).toEqual(["link", "youtube", "pdf"]);
    expect((await listDeliveriesForSale(db, other.saleId)).map((delivery) => delivery.title)).toEqual(["De Beto"]);
  });

  test("puts the time of the call on each delivery unless the caller gives another", async () => {
    const { saleId } = await saleOfNewStudent();
    const before = Date.now();

    await addLinkDelivery(db, saleId, "Ahora", DRIVE);
    await addLinkDelivery(db, saleId, "Antes", DRIVE, at(0));

    const [antes, ahora] = await listDeliveriesForSale(db, saleId);
    expect(antes.createdAt).toEqual(at(0));
    expect(ahora.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(ahora.createdAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test("gives explicit fields and never the bytes of a file", async () => {
    const { saleId } = await saleOfNewStudent();
    await addPdfDelivery(db, saleId, "Con archivo", pdfBytes(900));

    const [delivery] = await listDeliveriesForSale(db, saleId);

    expect(Object.keys(delivery).sort()).toEqual(
      ["createdAt", "fileId", "id", "kind", "saleId", "title", "url", "youtubeVideoId"],
    );
    expect(delivery.createdAt).toBeInstanceOf(Date);
    expect(JSON.stringify(delivery)).not.toContain("bytes");
  });

  test("is empty for a sale with nothing, an unknown sale or an id that is not a uuid", async () => {
    const { saleId } = await saleOfNewStudent();

    expect(await listDeliveriesForSale(db, saleId)).toEqual([]);
    expect(await listDeliveriesForSale(db, UNKNOWN_ID)).toEqual([]);
    expect(await listDeliveriesForSale(db, "no-es-un-uuid")).toEqual([]);
  });
});

describe("getDeliveryOfSale", () => {
  test("finds a delivery by its sale, and not by another sale", async () => {
    const { saleId } = await saleOfNewStudent("Ana");
    const other = await saleOfNewStudent("Beto");
    await addLinkDelivery(db, saleId, "De Ana", DRIVE);
    const [delivery] = await listDeliveriesForSale(db, saleId);

    expect(await getDeliveryOfSale(db, saleId, delivery.id)).toEqual(delivery);
    expect(await getDeliveryOfSale(db, other.saleId, delivery.id)).toBeNull();
    expect(await getDeliveryOfSale(db, saleId, UNKNOWN_ID)).toBeNull();
    expect(await getDeliveryOfSale(db, "no-es-un-uuid", delivery.id)).toBeNull();
    expect(await getDeliveryOfSale(db, saleId, "no-es-un-uuid")).toBeNull();
  });
});

describe("deliveryForStudent", () => {
  test("gives the delivery to the student whose sale it is", async () => {
    const { saleId, customerId } = await saleOfNewStudent("Ana");
    await addPdfDelivery(db, saleId, "Para Ana", pdfBytes());
    const [mine] = await listDeliveriesForSale(db, saleId);

    expect(await deliveryForStudent(db, mine.id, customerId)).toEqual(mine);
  });

  test("gives nothing to a student who changes the id of the delivery to one of someone else's", async () => {
    const ana = await saleOfNewStudent("Ana");
    const beto = await saleOfNewStudent("Beto");
    await addPdfDelivery(db, ana.saleId, "Para Ana", pdfBytes());
    await addYoutubeDelivery(db, beto.saleId, "Para Beto", YOUTUBE);
    const [anas] = await listDeliveriesForSale(db, ana.saleId);
    const [betos] = await listDeliveriesForSale(db, beto.saleId);

    expect(await deliveryForStudent(db, anas.id, beto.customerId)).toBeNull();
    expect(await deliveryForStudent(db, betos.id, ana.customerId)).toBeNull();
    expect(await deliveryForStudent(db, betos.id, beto.customerId)).toEqual(betos);
  });

  test("gives nothing for a student that does not exist, a delivery that does not exist or ids that are not uuids", async () => {
    const { saleId, customerId } = await saleOfNewStudent();
    await addLinkDelivery(db, saleId, "Algo", DRIVE);
    const [delivery] = await listDeliveriesForSale(db, saleId);

    expect(await deliveryForStudent(db, delivery.id, randomUUID())).toBeNull();
    expect(await deliveryForStudent(db, randomUUID(), customerId)).toBeNull();
    expect(await deliveryForStudent(db, "no-es-un-uuid", customerId)).toBeNull();
    expect(await deliveryForStudent(db, delivery.id, "no-es-un-uuid")).toBeNull();
    expect(await deliveryForStudent(db, "", "")).toBeNull();
  });

  test("keeps answering with the sale of each purchase when a student has several", async () => {
    const customerId = await insertTestCustomer(db);
    const firstSale = await insertTestSale(db, customerId);
    const secondSale = await insertTestSale(db, customerId);
    await addLinkDelivery(db, firstSale, "De la primera", DRIVE);
    await addLinkDelivery(db, secondSale, "De la segunda", DRIVE);
    const [first] = await listDeliveriesForSale(db, firstSale);
    const [second] = await listDeliveriesForSale(db, secondSale);

    expect(await deliveryForStudent(db, first.id, customerId)).toEqual(first);
    expect(await deliveryForStudent(db, second.id, customerId)).toEqual(second);
  });
});
