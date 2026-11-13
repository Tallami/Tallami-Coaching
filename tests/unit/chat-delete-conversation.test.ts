// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DeleteConversation } from "@/admin/chat/delete-conversation";
import { deleteConversationAction } from "@/app/admin/mensajes/actions";

// El botón «Borrar la conversación» del panel, en el navegador: si la acción no pudo borrar (la base no
// contestó, o el pedido no llegó), lo dice y el botón vuelve a poder usarse. La acción es un doble.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@/app/admin/mensajes/actions", () => ({ deleteConversationAction: vi.fn() }));

const FAILED = "No se pudo borrar la conversación. Probá de nuevo.";
const ID = "11111111-1111-1111-1111-111111111111";

let container: HTMLDivElement;
let root: Root;

function button(name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((element) => element.textContent?.startsWith(name));
  if (!found) throw new Error(`no button ${name}`);
  return found;
}

async function click(name: string): Promise<void> {
  await act(async () => button(name).click());
  await act(async () => {});
}

async function confirmDelete(): Promise<void> {
  await act(async () => root.render(createElement(DeleteConversation, { customerId: ID, studentName: "Ana" })));
  await click("Borrar la conversación");
  await click("Sí, borrarla");
}

beforeEach(() => {
  vi.mocked(deleteConversationAction).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("DeleteConversation", () => {
  test("a delete that fails in the database shows the notice and the buttons can be used again", async () => {
    vi.mocked(deleteConversationAction).mockResolvedValue({ ok: false });

    await confirmDelete();

    expect(deleteConversationAction).toHaveBeenCalledWith(ID);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(FAILED);
    expect(button("Sí, borrarla").disabled).toBe(false);
    expect(button("No, conservarla").disabled).toBe(false);
  });

  test("a request that does not arrive shows the same notice", async () => {
    vi.mocked(deleteConversationAction).mockRejectedValue(new TypeError("Failed to fetch"));

    await confirmDelete();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(FAILED);
    expect(button("Sí, borrarla").disabled).toBe(false);
  });

  test("trying again hides the notice while it deletes", async () => {
    vi.mocked(deleteConversationAction).mockResolvedValueOnce({ ok: false }).mockReturnValueOnce(new Promise(() => {}));

    await confirmDelete();
    await click("Sí, borrarla");

    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(button("Borrando…").disabled).toBe(true);
  });
});
