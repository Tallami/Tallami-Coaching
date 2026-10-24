// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { parseLoginError } from "@/admin/auth/login-errors";
import { CLAIM_KEY, DRAFT_PREFIX, markRecovery, saveDraft } from "@/admin/ui/draft-store";
import { ClearDraftsOnSubmit } from "@/admin/ui/clear-drafts-on-submit";
import { LoginForm } from "@/components/admin/login-form";

// Las dos puntas de la recuperación fuera de los formularios: el login, que si llegó por una
// sesión cerrada avisa y deja la marca para recuperar lo escrito, y los botones que cierran
// sesión a propósito ("Salir"), que borran todo lo guardado.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ENDED_MESSAGE = "Tu sesión se cerró. Volvé a entrar para seguir.";
const NOW = Date.parse("2026-10-21T15:00:00Z");

let container: HTMLDivElement;
let root: Root | null = null;

async function mount(element: ReturnType<typeof createElement>): Promise<void> {
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => mounted.render(element));
}

beforeEach(() => {
  sessionStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  const mounted = root;
  root = null;
  if (mounted) await act(async () => mounted.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("the login after a session that ended", () => {
  test("knows the new error code, and still only the known ones", () => {
    expect(parseLoginError("vencida")).toBe("vencida");
    expect(parseLoginError("expired")).toBe("expired");
    expect(parseLoginError("cualquier-cosa")).toBeNull();
  });

  test("says the session was closed", async () => {
    await mount(createElement(LoginForm, { action: async () => {}, error: "vencida", next: "/admin/ventas/nueva" }));

    const alert = container.querySelector("[role=alert]");
    expect(alert?.textContent).toBe(ENDED_MESSAGE);
    expect(container.querySelector("input[name=password]")?.getAttribute("aria-describedby")).toBe(alert?.id);
  });

  test("leaves the recovery mark in the browser, so a form can come back filled after signing in", async () => {
    vi.spyOn(Date, "now").mockReturnValue(NOW);

    await mount(createElement(LoginForm, { action: async () => {}, error: "vencida", next: "/admin/ventas/nueva" }));

    expect(JSON.parse(sessionStorage.getItem(CLAIM_KEY) ?? "null")).toEqual({ at: NOW, next: "/admin/ventas/nueva" });
  });

  test.each([null, "invalid", "blocked", "unavailable", "expired"] as const)(
    "leaves no mark for %s: only a session that ended is a reason to recover",
    async (error) => {
      await mount(createElement(LoginForm, { action: async () => {}, error, next: "/admin" }));

      expect(sessionStorage.getItem(CLAIM_KEY)).toBeNull();
    },
  );

  test("opening the same login again does not move the mark later", async () => {
    saveDraft(sessionStorage, "venta:nueva", [["amount", "40"]], NOW, "/admin/ventas/nueva");
    markRecovery(sessionStorage, NOW + 2000, "/admin/ventas/nueva");
    vi.spyOn(Date, "now").mockReturnValue(NOW + 30 * 60_000);

    await mount(createElement(LoginForm, { action: async () => {}, error: "vencida", next: "/admin/ventas/nueva" }));

    expect(JSON.parse(sessionStorage.getItem(CLAIM_KEY) ?? "null")).toEqual({
      at: NOW + 2000,
      next: "/admin/ventas/nueva",
    });
  });
});

describe("ClearDraftsOnSubmit", () => {
  test("clears every draft and the mark when the form is sent, and still runs the action", async () => {
    saveDraft(sessionStorage, "venta:nueva", [["amount", "40"]], NOW, "/admin/ventas/nueva");
    saveDraft(sessionStorage, "configuracion", [["category", "C"]], NOW, "/admin/configuracion");
    markRecovery(sessionStorage, NOW + 1000, "/admin/ventas/nueva");
    sessionStorage.setItem("otra-cosa", "queda");
    const action = vi.fn(async () => {});

    await mount(createElement(ClearDraftsOnSubmit, { action }, createElement("button", { type: "submit" }, "Salir")));
    await act(async () => container.querySelector("button")?.click());

    expect(Object.keys(sessionStorage).filter((key) => key.startsWith(DRAFT_PREFIX))).toEqual([]);
    expect(sessionStorage.getItem(CLAIM_KEY)).toBeNull();
    expect(sessionStorage.getItem("otra-cosa")).toBe("queda");
    expect(action).toHaveBeenCalledOnce();
  });

  test("renders a real form with the given class, so it works without JavaScript too", async () => {
    await mount(
      createElement(
        ClearDraftsOnSubmit,
        { action: async () => {}, className: "mt-auto" },
        createElement("button", { type: "submit" }, "Salir"),
      ),
    );

    const form = container.querySelector("form");
    expect(form?.className).toBe("mt-auto");
    expect(form?.querySelector("button")?.textContent).toBe("Salir");
  });
});
