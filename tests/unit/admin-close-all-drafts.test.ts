// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CloseAllSessions } from "@/admin/security/close-all-sessions";
import { CLAIM_KEY, DRAFT_PREFIX, markRecovery, saveDraft } from "@/admin/ui/draft-store";

// «Cerrar todas las sesiones» cierra la sesión a propósito: lo que quedó guardado en la pestaña (los borradores de
// los formularios y la marca de recuperación) se borra, pero solo si la sesión se cerró de verdad.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  closeAll: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace, refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/admin/configuracion/seguridad/actions", () => ({
  closeAllSessionsAction: mocks.closeAll,
  beginReauthAction: vi.fn(),
  finishReauthAction: vi.fn(),
}));

const NOW = Date.parse("2026-10-21T15:00:00Z");
const ORIGIN = "https://panel.tallami.example";
const BUTTON = "Cerrar todas las sesiones";

let container: HTMLDivElement;
let root: Root | null = null;

function seedStorage(): void {
  saveDraft(sessionStorage, "venta:nueva", [["amount", "40"]], NOW, "/admin/ventas/nueva");
  saveDraft(sessionStorage, "venta:6a3f", [["amount", "50"]], NOW, "/admin/ventas/6a3f");
  saveDraft(sessionStorage, "configuracion", [["category", "C"]], NOW, "/admin/configuracion");
  markRecovery(sessionStorage, NOW + 1000, "/admin/ventas/nueva");
  sessionStorage.setItem("otra-cosa", "queda");
}

const draftKeys = () => Object.keys(sessionStorage).filter((key) => key.startsWith(DRAFT_PREFIX));

async function clickCloseAll(): Promise<void> {
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => mounted.render(createElement(CloseAllSessions, { origin: ORIGIN })));
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent === BUTTON);
  await act(async () => button?.click());
}

beforeEach(() => {
  sessionStorage.clear();
  mocks.replace.mockReset();
  mocks.closeAll.mockReset();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  const mounted = root;
  root = null;
  if (mounted) await act(async () => mounted.unmount());
  container.remove();
});

describe("CloseAllSessions and the drafts of the forms", () => {
  test("clears every draft and the recovery mark once the sessions are closed, then goes to the login", async () => {
    mocks.closeAll.mockResolvedValue({ ok: true, redirectTo: "/admin/login" });
    seedStorage();
    expect(draftKeys()).toHaveLength(3);

    await clickCloseAll();

    expect(mocks.closeAll).toHaveBeenCalledOnce();
    expect(draftKeys()).toEqual([]);
    expect(sessionStorage.getItem(CLAIM_KEY)).toBeNull();
    expect(sessionStorage.getItem("otra-cosa")).toBe("queda");
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith("/admin/login");
  });

  test("keeps them when the sessions could not be closed: nothing was lost, nobody left", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.closeAll.mockRejectedValue(new Error("sin conexión"));
    seedStorage();

    await clickCloseAll();

    expect(draftKeys()).toHaveLength(3);
    expect(sessionStorage.getItem(CLAIM_KEY)).not.toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(container.textContent).toContain("No pudimos completarlo");
  });
});
