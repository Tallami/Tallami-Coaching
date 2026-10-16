import { describe, expect, test } from "vitest";
import { saveInvoicing } from "@/admin/billing/save-invoicing";
import { getSale } from "@/admin/sales/repository";
import type { Db } from "@/db/client";
import { createTestDb } from "../helpers/db";
import { seedSale } from "../helpers/sales-db";

/** Martes 13/10/2026, 15:00 en Argentina. */
const NOW = new Date("2026-10-13T18:00:00.000Z");

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) data.append(name, entry);
  }
  return data;
}

const INVOICED = { intent: "invoiced", type: "C", number: "00003-00000045", issuedOn: "2026-10-13" };

async function statusOf(db: Db, id: string) {
  return (await getSale(db, id))?.invoiceStatus;
}

describe("saveInvoicing", () => {
  test("marks the chosen sales as invoiced and says how many", async () => {
    const db = await createTestDb();
    const first = await seedSale(db);
    const second = await seedSale(db);
    const untouched = await seedSale(db);

    const outcome = await saveInvoicing(db, form({ ...INVOICED, ids: [first, second] }), NOW);

    expect(outcome).toEqual({ saved: true, intent: "invoiced", updated: 2 });
    expect(await statusOf(db, first)).toBe("issued");
    expect(await statusOf(db, second)).toBe("issued");
    expect(await statusOf(db, untouched)).toBe("pending");
  });

  test("marks the chosen sales as not requiring an invoice, whatever the invoice fields say", async () => {
    const db = await createTestDb();
    const id = await seedSale(db);

    const outcome = await saveInvoicing(
      db,
      form({ intent: "not_required", ids: [id], type: "Q", number: "", issuedOn: "nunca" }),
      NOW,
    );

    expect(outcome).toEqual({ saved: true, intent: "not_required", updated: 1 });
    expect(await statusOf(db, id)).toBe("not_required");
  });

  test("with nothing chosen it asks to choose, and writes nothing", async () => {
    const db = await createTestDb();
    const id = await seedSale(db);

    const outcome = await saveInvoicing(db, form(INVOICED), NOW);

    expect(outcome).toEqual({
      saved: false,
      state: {
        fieldErrors: { ids: "Elegí al menos una venta." },
        formError: "Revisá los campos marcados.",
      },
    });
    expect(await statusOf(db, id)).toBe("pending");
  });

  test("reports each wrong invoice field, keeps the selection and writes nothing", async () => {
    const db = await createTestDb();
    const id = await seedSale(db);

    const outcome = await saveInvoicing(
      db,
      form({ intent: "invoiced", ids: [id], type: "", number: "   ", issuedOn: "2026-02-30" }),
      NOW,
    );

    expect(outcome.saved).toBe(false);
    if (outcome.saved) return;
    expect(Object.keys(outcome.state.fieldErrors).sort()).toEqual(["issuedOn", "number", "type"]);
    expect(outcome.state.fieldErrors.number).toBe("Escribí el número de la factura.");
    expect(await statusOf(db, id)).toBe("pending");
  });

  test("a sale that can no longer be marked gives a message for the whole form and changes nothing", async () => {
    const db = await createTestDb();
    const good = await seedSale(db);
    const cancelled = await seedSale(db, { status: "cancelled", paidOn: "" });

    const outcome = await saveInvoicing(db, form({ ...INVOICED, ids: [good, cancelled] }), NOW);

    expect(outcome.saved).toBe(false);
    if (outcome.saved) return;
    expect(outcome.state.fieldErrors).toEqual({});
    expect(outcome.state.formError).toContain("No se cambió ninguna");
    expect(await statusOf(db, good)).toBe("pending");
  });

  test("ids that are not ids are an error for the list, not a crash", async () => {
    const db = await createTestDb();

    const outcome = await saveInvoicing(db, form({ ...INVOICED, ids: ["__proto__", "x'; --"] }), NOW);

    expect(outcome.saved).toBe(false);
    if (outcome.saved) return;
    expect(outcome.state.fieldErrors.ids).toEqual(expect.any(String));
  });

  test.each([[undefined], ["borrar"], ["__proto__"], ["constructor"], [""]])(
    "an unknown action (%j) is refused",
    async (intent) => {
      const db = await createTestDb();
      const id = await seedSale(db);

      const fields = { type: INVOICED.type, number: INVOICED.number, issuedOn: INVOICED.issuedOn };

      const outcome = await saveInvoicing(
        db,
        form({ ...fields, ...(intent === undefined ? {} : { intent }), ids: [id] }),
        NOW,
      );

      expect(outcome.saved).toBe(false);
      if (outcome.saved) return;
      expect(outcome.state.formError).toBe("No entendimos qué querías hacer. Volvé a intentar.");
      expect(await statusOf(db, id)).toBe("pending");
    },
  );

  test("a file in place of a field is not text and is refused", async () => {
    const db = await createTestDb();
    const id = await seedSale(db);
    const data = form({ ...INVOICED, ids: [id] });
    data.set("number", new File(["x"], "factura.pdf"));

    const outcome = await saveInvoicing(db, data, NOW);

    expect(outcome.saved).toBe(false);
    expect(await statusOf(db, id)).toBe("pending");
  });
});
