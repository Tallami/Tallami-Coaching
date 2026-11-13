// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CHAT_IDLE, type ChatFormState } from "@/chat/form-state";
import { ComposeForm, type ComposeLabels } from "@/components/chat/compose-form";

// El formulario de un mensaje, en el navegador: guarda lo que se escribe en la pestaña (`sessionStorage`)
// para que vuelva si el refresco cambia la vista y el formulario desaparece, pero solo a su dueño; y sus
// avisos (el de error y el de estado) son nodos distintos, para que el lector de pantalla anuncie el error.
// La acción del servidor es un doble que contesta lo que pide cada test.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLOT = "tallami.chat.draft.portal";
const OWNER = "portal:11111111-1111-1111-1111-111111111111";
const OTHER = "portal:22222222-2222-2222-2222-222222222222";

const LABELS: ComposeLabels = {
  label: "Tu mensaje",
  submit: "Enviar",
  submitting: "Enviando…",
  sent: "Mensaje enviado.",
  invalid: "Escribí algo.",
  rateLimited: "Esperá un rato.",
  signedOut: "Tu sesión se cerró; tu mensaje sigue acá.",
  failed: "No se pudo enviar.",
};

let container: HTMLDivElement;
let root: Root;
const action = vi.fn<(previous: ChatFormState, form: FormData) => Promise<ChatFormState>>(async () => CHAT_IDLE);

function render(draftKey?: string): Promise<void> {
  return act(async () =>
    root.render(createElement(ComposeForm, { action, initialState: CHAT_IDLE, labels: LABELS, maxLength: 2000, draftKey })),
  );
}

function box(): HTMLTextAreaElement {
  const found = container.querySelector("textarea");
  if (!found) throw new Error("no textarea");
  return found;
}

async function type(text: string): Promise<void> {
  await act(async () => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setValue?.call(box(), text);
    box().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function send(result: ChatFormState): Promise<void> {
  action.mockImplementationOnce(async () => result);
  await act(async () => container.querySelector("form")?.requestSubmit());
  await act(async () => {});
}

function stored(): unknown {
  const raw = window.sessionStorage.getItem(SLOT);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(() => {
  // jsdom no mueve la página: el formulario pide quedar a la vista al abrirse.
  Element.prototype.scrollIntoView = () => {};
  window.sessionStorage.clear();
  action.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("ComposeForm, the draft kept in the tab", () => {
  test("what is typed is saved under the surface's slot with its owner", async () => {
    await render(OWNER);
    await type("todavía no lo mando");

    expect(stored()).toEqual({ owner: OWNER, body: "todavía no lo mando" });
  });

  test("a fresh form of the same owner gets the draft back in the box", async () => {
    window.sessionStorage.setItem(SLOT, JSON.stringify({ owner: OWNER, body: "lo que había escrito" }));

    await render(OWNER);

    expect(box().value).toBe("lo que había escrito");
  });

  test("a draft of another owner is not shown, and the slot is removed", async () => {
    window.sessionStorage.setItem(SLOT, JSON.stringify({ owner: OTHER, body: "lo de otro alumno" }));

    await render(OWNER);

    expect(box().value).toBe("");
    expect(window.sessionStorage.getItem(SLOT)).toBeNull();
  });

  test("a sent message clears the slot and the box", async () => {
    await render(OWNER);
    await type("ya lo mando");

    await send({ outcome: "sent", body: "" });

    expect(box().value).toBe("");
    expect(window.sessionStorage.getItem(SLOT)).toBeNull();
  });

  test("a send that found the session closed keeps the text in the box and in the slot", async () => {
    await render(OWNER);
    await type("se me cerró la sesión");

    await send({ outcome: "signed-out", body: "se me cerró la sesión" });

    expect(box().value).toBe("se me cerró la sesión");
    expect(stored()).toEqual({ owner: OWNER, body: "se me cerró la sesión" });
  });

  test("without a draftKey nothing is stored", async () => {
    await render();
    await type("sin borrador");

    expect(window.sessionStorage.length).toBe(0);
  });

  test("storage that throws does not break the form", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });

    await render(OWNER);
    await type("igual se escribe");
    expect(box().value).toBe("igual se escribe");
    await send({ outcome: "sent", body: "" });

    expect(action).toHaveBeenCalledTimes(1);
    expect(box().value).toBe("");
  });

  test("a storage that cannot even be reached does not break the form", async () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError");
    });

    await render(OWNER);
    await type("sin almacenamiento");
    await send({ outcome: "failed", body: "sin almacenamiento" });

    expect(box().value).toBe("sin almacenamiento");
  });
});

describe("ComposeForm, the notices", () => {
  test("after a failed send the alert is a different element from the status of the previous successful send", async () => {
    await render(OWNER);
    await type("primero");
    await send({ outcome: "sent", body: "" });
    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toBe(LABELS.sent);

    await type("segundo");
    await send({ outcome: "signed-out", body: "segundo" });
    const alert = container.querySelector('[role="alert"]');

    expect(alert?.textContent).toContain(LABELS.signedOut);
    expect(alert).not.toBe(status);
    expect(status?.isConnected).toBe(false);
  });
});
