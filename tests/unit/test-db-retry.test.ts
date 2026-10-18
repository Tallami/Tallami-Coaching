import { count } from "drizzle-orm";
import { describe, expect, test, vi } from "vitest";
import { openPglite } from "@/db/pglite";
import { customers } from "@/db/schema";
import { createTestDb } from "../helpers/db";

// Si abrir el molde falla una vez (por ejemplo, con la máquina sin memoria), el
// resto de los tests del archivo no puede quedar condenado a ese mismo error: la
// próxima base de prueba vuelve a intentarlo.

vi.mock("@/db/pglite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/pglite")>();
  return { ...actual, openPglite: vi.fn(actual.openPglite) };
});

describe("createTestDb when the template cannot be opened", () => {
  test("fails that once, and the next call tries again instead of repeating the old error", async () => {
    vi.mocked(openPglite).mockRejectedValueOnce(new Error("no se pudo abrir la base"));

    await expect(createTestDb()).rejects.toThrow("no se pudo abrir la base");

    const db = await createTestDb();
    const [row] = await db.select({ rows: count() }).from(customers);
    expect(row.rows).toBe(0);
    expect(openPglite).toHaveBeenCalledTimes(2);
  });
});
