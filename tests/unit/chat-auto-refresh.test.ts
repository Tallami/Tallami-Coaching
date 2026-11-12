// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MESSAGES_REFRESH_MS } from "@/chat/policy";
import { AutoRefresh } from "@/components/chat/auto-refresh";

// El refresco de la página de mensajes: pide la página cada 20 segundos solo con la pestaña a la vista,
// y marca la conversación como leída al abrirse y cuando llegan mensajes del otro lado a la vista.
// `router.refresh` y la acción de marcar son dobles; el reloj y la visibilidad, falsos.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: vi.fn(), push: vi.fn() }) }));

let visibility: DocumentVisibilityState = "visible";
let container: HTMLDivElement;
let root: Root;
const markRead = vi.fn(async () => undefined);

function render(incoming: number): Promise<void> {
  return act(async () => root.render(createElement(AutoRefresh, { intervalMs: MESSAGES_REFRESH_MS, incoming, markRead })));
}

async function setVisibility(next: DocumentVisibilityState): Promise<void> {
  visibility = next;
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
}

async function advance(ms: number): Promise<void> {
  await act(async () => vi.advanceTimersByTime(ms));
}

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  mocks.refresh.mockReset();
  markRead.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AutoRefresh", () => {
  test("with the tab visible, asks for the page once every interval, and not before", async () => {
    await render(0);

    await advance(MESSAGES_REFRESH_MS - 1);
    expect(mocks.refresh).not.toHaveBeenCalled();
    await advance(1);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    await advance(MESSAGES_REFRESH_MS);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  test("with the tab hidden, asks for nothing and marks nothing", async () => {
    visibility = "hidden";
    await render(2);

    await advance(MESSAGES_REFRESH_MS * 5);
    await render(3); // llegó otro mensaje con la pestaña oculta

    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
  });

  test("marks read when the page opens with the tab visible, and not again while `incoming` stays the same", async () => {
    await render(1);
    expect(markRead).toHaveBeenCalledTimes(1);

    await advance(MESSAGES_REFRESH_MS * 3);
    await render(1); // el refresco trajo la misma conversación
    await render(1);

    expect(markRead).toHaveBeenCalledTimes(1);
  });

  test("a message from the other side that arrives with the tab visible is marked read", async () => {
    await render(1);
    await render(2);

    expect(markRead).toHaveBeenCalledTimes(2);
  });

  test("becoming visible asks for the page and marks read at once, after a hidden stretch that asked for nothing", async () => {
    visibility = "hidden";
    await render(1);
    await advance(MESSAGES_REFRESH_MS * 2);
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();

    await setVisibility("visible");

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledTimes(1);
    // Y vuelve al ritmo de siempre.
    await advance(MESSAGES_REFRESH_MS);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  test("becoming visible with nothing new asks for the page but does not mark again", async () => {
    await render(1);
    await setVisibility("hidden");
    await setVisibility("visible");

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledTimes(1);
  });

  test("a failed mark does not throw, and the next message marks again", async () => {
    markRead.mockRejectedValueOnce(new Error("sin red"));
    await render(1);
    await render(2);

    expect(markRead).toHaveBeenCalledTimes(2);
  });

  test("stops asking once unmounted", async () => {
    await render(0);
    await act(async () => root.unmount());
    root = createRoot(container);

    await advance(MESSAGES_REFRESH_MS * 3);

    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
