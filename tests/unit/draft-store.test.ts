// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  CLAIM_KEY,
  CLAIM_WINDOW_MS,
  DRAFT_PREFIX,
  clearAllDrafts,
  markRecovery,
  removeDraft,
  saveDraft,
  takeRecoverableDraft,
} from "@/admin/ui/draft-store";

// El almacenamiento de los borradores: lo que se guarda al enviar un formulario, la
// "marca de recuperación" que deja el login cuando la sesión terminó, y la regla que
// decide si un borrador pendiente vuelve (hay una marca posterior y cercana) o se tira
// (fue un envío exitoso o abandonado). Todo sobre `sessionStorage`, que se borra al
// cerrar la pestaña.

const T0 = Date.parse("2026-10-21T15:00:00Z");
const SECOND_MS = 1000;
const FIELDS = [
  ["item", "lesson"],
  ["amount", "40"],
] as const;

beforeEach(() => {
  sessionStorage.clear();
});

describe("saveDraft", () => {
  test("keeps the fields and the moment under the prefixed key", () => {
    saveDraft(sessionStorage, "venta:nueva", FIELDS, T0);

    const stored = sessionStorage.getItem(`${DRAFT_PREFIX}venta:nueva`);
    expect(JSON.parse(stored ?? "null")).toEqual({ at: T0, fields: [...FIELDS] });
  });

  test("a second save of the same form replaces the first", () => {
    saveDraft(sessionStorage, "venta:nueva", [["amount", "1"]], T0);
    saveDraft(sessionStorage, "venta:nueva", [["amount", "2"]], T0 + SECOND_MS);

    expect(sessionStorage.length).toBe(1);
    expect(JSON.parse(sessionStorage.getItem(`${DRAFT_PREFIX}venta:nueva`) ?? "null").fields).toEqual([["amount", "2"]]);
  });

  test("does not break the form when the browser refuses to store (full or blocked storage)", () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const full = {
      setItem: () => {
        throw new DOMException("lleno", "QuotaExceededError");
      },
    } as unknown as Storage;

    expect(() => saveDraft(full, "venta:nueva", FIELDS, T0)).not.toThrow();
    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});

describe("removeDraft", () => {
  test("drops only that form's draft", () => {
    saveDraft(sessionStorage, "venta:nueva", FIELDS, T0);
    saveDraft(sessionStorage, "alumno:nuevo", FIELDS, T0);

    removeDraft(sessionStorage, "venta:nueva");

    expect(sessionStorage.getItem(`${DRAFT_PREFIX}venta:nueva`)).toBeNull();
    expect(sessionStorage.getItem(`${DRAFT_PREFIX}alumno:nuevo`)).not.toBeNull();
  });
});

describe("takeRecoverableDraft", () => {
  test("gives the draft back when a recovery mark came after it, and uses the mark up", () => {
    saveDraft(sessionStorage, "venta:nueva", FIELDS, T0);
    markRecovery(sessionStorage, T0 + 3 * SECOND_MS);

    const draft = takeRecoverableDraft(sessionStorage, "venta:nueva");

    expect(draft).toEqual({ at: T0, fields: [...FIELDS] });
    expect(sessionStorage.getItem(CLAIM_KEY)).toBeNull();
    // Ya está en el formulario: no queda pendiente.
    expect(sessionStorage.getItem(`${DRAFT_PREFIX}venta:nueva`)).toBeNull();
  });

  test("throws a pending draft away when there is no mark: it was a saved or an abandoned form", () => {
    saveDraft(sessionStorage, "venta:nueva", FIELDS, T0);

    expect(takeRecoverableDraft(sessionStorage, "venta:nueva")).toBeNull();
    expect(sessionStorage.getItem(`${DRAFT_PREFIX}venta:nueva`)).toBeNull();
  });

  test("a mark older than the draft does not count (the draft was sent after it)", () => {
    markRecovery(sessionStorage, T0);
    saveDraft(sessionStorage, "venta:nueva", FIELDS, T0 + SECOND_MS);

    expect(takeRecoverableDraft(sessionStorage, "venta:nueva")).toBeNull();
    // La marca no se gasta con un borrador que no le toca.
    expect(sessionStorage.getItem(CLAIM_KEY)).not.toBeNull();
  });

  test("a mark long after the draft does not bring back a form that was saved long ago", () => {
    // Guardó bien una venta, y mucho después la sesión se cerró navegando: la marca no es de ese envío.
    saveDraft(sessionStorage, "venta:nueva", FIELDS, T0);
    markRecovery(sessionStorage, T0 + CLAIM_WINDOW_MS + SECOND_MS);

    expect(takeRecoverableDraft(sessionStorage, "venta:nueva")).toBeNull();
    expect(sessionStorage.getItem(`${DRAFT_PREFIX}venta:nueva`)).toBeNull();
  });

  test("a mark right at the edge of the window still counts", () => {
    saveDraft(sessionStorage, "venta:nueva", FIELDS, T0);
    markRecovery(sessionStorage, T0 + CLAIM_WINDOW_MS);

    expect(takeRecoverableDraft(sessionStorage, "venta:nueva")).not.toBeNull();
  });

  test("a draft of a form that was never sent gives nothing, mark or not", () => {
    markRecovery(sessionStorage, T0);

    expect(takeRecoverableDraft(sessionStorage, "venta:nueva")).toBeNull();
    expect(sessionStorage.getItem(CLAIM_KEY)).not.toBeNull();
  });

  test.each([
    ["not JSON", "{no es json"],
    ["not an object", "42"],
    ["without a time", JSON.stringify({ fields: [["a", "b"]] })],
    ["with fields that are not pairs of text", JSON.stringify({ at: T0, fields: [["a", 1]] })],
    ["with fields that are not a list", JSON.stringify({ at: T0, fields: "x" })],
  ])("treats a stored draft that is %s as no draft, and cleans it", (_label, raw) => {
    sessionStorage.setItem(`${DRAFT_PREFIX}venta:nueva`, raw);
    markRecovery(sessionStorage, T0 + SECOND_MS);

    expect(takeRecoverableDraft(sessionStorage, "venta:nueva")).toBeNull();
    expect(sessionStorage.getItem(`${DRAFT_PREFIX}venta:nueva`)).toBeNull();
  });

  test("a garbled mark is ignored", () => {
    saveDraft(sessionStorage, "venta:nueva", FIELDS, T0);
    sessionStorage.setItem(CLAIM_KEY, "mañana");

    expect(takeRecoverableDraft(sessionStorage, "venta:nueva")).toBeNull();
  });
});

describe("markRecovery", () => {
  test("leaves a mark with the moment", () => {
    markRecovery(sessionStorage, T0);

    expect(sessionStorage.getItem(CLAIM_KEY)).toBe(String(T0));
  });

  test("reloading the login page keeps the first mark, so the draft is still recoverable", () => {
    saveDraft(sessionStorage, "venta:nueva", FIELDS, T0);
    markRecovery(sessionStorage, T0 + 2 * SECOND_MS);

    // Tallami deja el login abierto un rato largo y el navegador recarga la pestaña.
    markRecovery(sessionStorage, T0 + 20 * 60 * SECOND_MS);

    expect(sessionStorage.getItem(CLAIM_KEY)).toBe(String(T0 + 2 * SECOND_MS));
    expect(takeRecoverableDraft(sessionStorage, "venta:nueva")).not.toBeNull();
  });

  test("a form sent after an old unused mark gets a new mark", () => {
    markRecovery(sessionStorage, T0);
    // Más tarde: otro envío con la sesión ya cerrada.
    const later = T0 + 60 * 60 * SECOND_MS;
    saveDraft(sessionStorage, "alumno:nuevo", FIELDS, later);

    markRecovery(sessionStorage, later + 2 * SECOND_MS);

    expect(sessionStorage.getItem(CLAIM_KEY)).toBe(String(later + 2 * SECOND_MS));
    expect(takeRecoverableDraft(sessionStorage, "alumno:nuevo")).not.toBeNull();
  });

  test("does not break the page when the browser refuses to store", () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const blocked = {
      getItem: () => null,
      key: () => null,
      length: 0,
      setItem: () => {
        throw new DOMException("bloqueado", "SecurityError");
      },
    } as unknown as Storage;

    expect(() => markRecovery(blocked, T0)).not.toThrow();
    log.mockRestore();
  });
});

describe("clearAllDrafts", () => {
  test("drops every draft and the mark, and nothing else", () => {
    saveDraft(sessionStorage, "venta:nueva", FIELDS, T0);
    saveDraft(sessionStorage, "venta:6a3f", FIELDS, T0);
    saveDraft(sessionStorage, "configuracion", FIELDS, T0);
    markRecovery(sessionStorage, T0 + SECOND_MS);
    sessionStorage.setItem("otra-cosa", "queda");

    clearAllDrafts(sessionStorage);

    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.getItem("otra-cosa")).toBe("queda");
  });
});
