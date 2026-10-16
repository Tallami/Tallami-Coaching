import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { createCustomer, getCustomer, searchCustomers } from "@/admin/customers/repository";
import { saveStudent } from "@/admin/customers/save-student";
import type { Db } from "@/db/client";
import { customers } from "@/db/schema";
import { createTestDb } from "../helpers/db";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

/** El formulario de un alumno como llega del navegador. */
function form(fields: Record<string, string | undefined> = {}): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries({ name: "Ana", ...fields })) {
    if (value !== undefined) data.set(name, value);
  }
  return data;
}

async function namesLike(db: Db, text: string): Promise<string[]> {
  return (await searchCustomers(db, text, 50)).map((customer) => customer.name);
}

describe("saveStudent", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  });

  test("saves a new student with the country trimmed and in capitals", async () => {
    const outcome = await saveStudent(
      db,
      form({ name: "  Bruno Souza  ", discord: " bruninho ", country: " br ", notes: " Paga su mamá " }),
    );

    expect(outcome.saved).toBe(true);
    if (!outcome.saved) return;
    expect(await getCustomer(db, outcome.id)).toMatchObject({
      name: "Bruno Souza",
      discord: "bruninho",
      country: "BR",
      notes: "Paga su mamá",
    });
  });

  test("only the name is required", async () => {
    const outcome = await saveStudent(db, form({ name: "Solo nombre", discord: "", country: "", notes: "" }));

    expect(outcome.saved).toBe(true);
    if (!outcome.saved) return;
    expect(await getCustomer(db, outcome.id)).toMatchObject({ discord: null, country: null, notes: null });
  });

  test("edits an existing student", async () => {
    const { id } = await createCustomer(db, { name: "Carla", discord: "carla.vieja", country: "AR" });

    const outcome = await saveStudent(db, form({ name: "Carla", discord: "carla.nueva", country: "mx" }), id);

    expect(outcome).toEqual({ saved: true, id });
    expect(await getCustomer(db, id)).toMatchObject({ discord: "carla.nueva", country: "MX" });
  });

  test("rejects an empty name, a long text and a bad country, with a message for each field", async () => {
    const before = (await namesLike(db, "")).length;

    const outcome = await saveStudent(
      db,
      form({ name: "   ", discord: "d".repeat(65), country: "ARG", notes: "n".repeat(2001) }),
    );

    expect(outcome.saved).toBe(false);
    if (outcome.saved) return;
    expect(outcome.state.fieldErrors).toEqual({
      name: "Escribí el nombre del alumno.",
      discord: "El Discord es demasiado largo (máximo 64 caracteres).",
      country: "El país va con 2 letras, como AR, BR o MX.",
      notes: "Las notas son demasiado largas (máximo 2000 caracteres).",
    });
    expect(outcome.state.formError).toBe("Revisá los campos marcados.");
    expect((await namesLike(db, "")).length).toBe(before);
  });

  test("a missing name field is the same as an empty one", async () => {
    const outcome = await saveStudent(db, form({ name: undefined }));

    expect(outcome.saved).toBe(false);
    if (outcome.saved) return;
    expect(outcome.state.fieldErrors.name).toBe("Escribí el nombre del alumno.");
  });

  test("a name of 120 characters fits and 121 does not", async () => {
    expect((await saveStudent(db, form({ name: "n".repeat(120) }))).saved).toBe(true);

    const tooLong = await saveStudent(db, form({ name: "n".repeat(121) }));
    expect(tooLong.saved).toBe(false);
    if (tooLong.saved) return;
    expect(tooLong.state.fieldErrors.name).toBe("El nombre es demasiado largo (máximo 120 caracteres).");
  });

  test("drops NUL characters instead of failing to save", async () => {
    const outcome = await saveStudent(
      db,
      form({ name: "Dani\u0000 Nul", discord: "dani\u0000.nul", notes: "a\u0000b" }),
    );

    expect(outcome.saved).toBe(true);
    if (!outcome.saved) return;
    expect(await getCustomer(db, outcome.id)).toMatchObject({
      name: "Dani Nul",
      discord: "dani.nul",
      notes: "ab",
    });
  });

  test("a name that is only NUL characters counts as empty", async () => {
    const outcome = await saveStudent(db, form({ name: "\u0000\u0000" }));

    expect(outcome.saved).toBe(false);
  });

  test("tells when the student being edited is not there", async () => {
    for (const id of [UNKNOWN_ID, "no-es-un-id"]) {
      const outcome = await saveStudent(db, form(), id);

      expect(outcome.saved).toBe(false);
      if (outcome.saved) return;
      expect(outcome.state.formError).toBe(
        "No encontramos a ese alumno. Volvé a la lista de alumnos y elegilo de nuevo.",
      );
    }
  });

  test("an empty id is an edit of nobody: it never creates a student", async () => {
    // `""` es falsy, pero no es "sin id": solo `undefined` crea.
    const before = (await namesLike(db, "")).length;

    const outcome = await saveStudent(db, form({ name: "No se debería crear" }), "");

    expect(outcome.saved).toBe(false);
    if (outcome.saved) return;
    expect(outcome.state.formError).toBe(
      "No encontramos a ese alumno. Volvé a la lista de alumnos y elegilo de nuevo.",
    );
    expect(await namesLike(db, "No se debería crear")).toEqual([]);
    expect((await namesLike(db, "")).length).toBe(before);
  });

  test("a failing database is logged and reported without details", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { id } = await createCustomer(db, { name: "Eli intacta" });
    const broken = {
      update: () => {
        throw new Error("la base no contesta");
      },
    } as unknown as Db;

    const outcome = await saveStudent(broken, form({ name: "Eli rota" }), id);

    expect(outcome.saved).toBe(false);
    if (outcome.saved) return;
    expect(outcome.state.formError).toBe("No pudimos guardar al alumno. Probá de nuevo en unos minutos.");
    expect(JSON.stringify(outcome.state)).not.toContain("la base no contesta");
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
    const [stored] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, id));
    expect(stored.name).toBe("Eli intacta");
  });
});
