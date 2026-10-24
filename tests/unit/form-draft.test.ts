// @vitest-environment jsdom
import {
  Activity,
  StrictMode,
  act,
  createElement,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CLAIM_KEY, DRAFT_PREFIX, markRecovery } from "@/admin/ui/draft-store";
import { useFormDraft } from "@/admin/ui/form-draft";

// El gancho de los formularios del panel: guarda lo escrito al enviar y, si al volver a
// entrar el login dejó la marca de recuperación, vuelve a llenar el formulario (en el DOM
// y en el estado de React, como los formularios del panel) y avisa. Sin marca, el
// borrador se tira: el envío anduvo o se abandonó.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SERVICES = ["lesson", "other"] as const;
const SALE_IDS = ["s1", "s2", "s3"] as const;
const KEY = "venta:nueva";
/** La página del formulario: el borrador se guarda con ella y la marca de recuperación vuelve a ella. */
const PAGE = "/admin/ventas/nueva";

interface FormState {
  name: string;
  item: string;
  description: string;
  picked: readonly string[];
}
const EMPTY_STATE: FormState = { name: "", item: "", description: "", picked: [] };

/** Un formulario como los del panel: controlado, con un campo que aparece según otro y casillas. */
function PanelLikeForm({ draftKey, children }: { draftKey: string; children?: ReactNode }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [item, setItem] = useState("");
  const [description, setDescription] = useState("");
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [password, setPassword] = useState("");
  const draft = useFormDraft(formRef, draftKey);

  function reset() {
    setName("");
    setItem("");
    setDescription("");
    setPicked([]);
  }

  const state: FormState = { name, item, description, picked };
  return createElement(
    "form",
    // La regla de refs no ve el `ref` de un elemento escrito sin JSX; es el mismo uso de los formularios del panel.
    // eslint-disable-next-line react-hooks/refs
    {
      ref: formRef,
      "data-state": JSON.stringify(state),
      "data-restored": String(draft.restored),
      onSubmit: (event: FormEvent) => event.preventDefault(),
    },
    draft.restored
      ? createElement(
          "div",
          { role: "status" },
          "Tu sesión se cerró",
          createElement(
            "button",
            {
              type: "button",
              onClick: () => {
                draft.discard();
                reset();
              },
            },
            "Descartar",
          ),
        )
      : null,
    createElement("input", {
      name: "customerName",
      value: name,
      onChange: (event: ChangeEvent<HTMLInputElement>) => setName(event.target.value),
    }),
    createElement(
      "select",
      { name: "item", value: item, onChange: (event: ChangeEvent<HTMLSelectElement>) => setItem(event.target.value) },
      createElement("option", { value: "" }, "Elegí"),
      ...SERVICES.map((service) => createElement("option", { key: service, value: service }, service)),
    ),
    item === "other"
      ? createElement("input", {
          name: "description",
          value: description,
          onChange: (event: ChangeEvent<HTMLInputElement>) => setDescription(event.target.value),
        })
      : null,
    ...SALE_IDS.map((id) =>
      createElement("input", {
        key: id,
        type: "checkbox",
        name: "ids",
        value: id,
        checked: picked.includes(id),
        onChange: () => setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id])),
      }),
    ),
    createElement("input", {
      name: "password",
      type: "password",
      value: password,
      onChange: (event: ChangeEvent<HTMLInputElement>) => setPassword(event.target.value),
    }),
    createElement("button", { type: "submit" }, "Guardar"),
    children,
  );
}

let container: HTMLDivElement;
let root: Root | null = null;

async function mount(element: ReactNode): Promise<void> {
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => mounted.render(element));
}

async function unmount(): Promise<void> {
  const mounted = root;
  root = null;
  if (mounted) await act(async () => mounted.unmount());
}

const formEl = () => container.querySelector("form") as HTMLFormElement;
const stateOf = (): FormState => JSON.parse(formEl().dataset.state ?? "{}");
const control = (name: string) => formEl().elements.namedItem(name) as HTMLInputElement;

/** Escribe como una persona: el valor cambia y el navegador avisa con `input`/`change`. */
async function userSets(name: string, value: string): Promise<void> {
  const element = control(name);
  await act(async () => {
    const proto =
      element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

async function userTicks(id: string): Promise<void> {
  const box = formEl().querySelector<HTMLInputElement>(`input[name="ids"][value="${id}"]`) as HTMLInputElement;
  await act(async () => box.click());
}

async function userSends(): Promise<void> {
  await act(async () => formEl().requestSubmit());
}

async function fillAndSend(): Promise<void> {
  await userSets("customerName", "Ana Pérez");
  await userSets("item", "other");
  await userSets("description", "Revisión extra");
  await userSets("password", "secreta-123");
  await userTicks("s1");
  await userTicks("s3");
  await userSends();
}

/**
 * Espera a que el formulario termine de volver a llenarse (temporizadores de verdad). Dentro de un
 * `act` React no dibuja hasta que termina, así que se espera de a poco, saliendo de cada `act`.
 */
async function untilRestored(): Promise<void> {
  const deadline = Date.now() + 3000;
  while (formEl().dataset.restored !== "true" && Date.now() < deadline) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  }
  expect(formEl().dataset.restored).toBe("true");
}

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState({}, "", PAGE);
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  await unmount();
  container.remove();
  vi.restoreAllMocks();
});

describe("useFormDraft: saving", () => {
  test("keeps what was typed when the form is sent, and never the password", async () => {
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));

    await fillAndSend();

    const stored = sessionStorage.getItem(`${DRAFT_PREFIX}${KEY}`) ?? "";
    expect(JSON.parse(stored).fields).toEqual([
      ["customerName", "Ana Pérez"],
      ["item", "other"],
      ["description", "Revisión extra"],
      ["ids", "s1"],
      ["ids", "s3"],
    ]);
    expect(stored).not.toContain("secreta-123");
  });

  test("keeps the page it was written on, without the one-shot flags that a result page leaves in the address", async () => {
    window.history.replaceState({}, "", `${PAGE}?guardada=creada&desde=2026-10-01`);
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));

    await userSets("customerName", "Ana");
    await userSends();

    const stored = JSON.parse(sessionStorage.getItem(`${DRAFT_PREFIX}${KEY}`) ?? "null");
    expect(stored.page).toBe(`${PAGE}?desde=2026-10-01`);
  });

  test("keeps nothing until the form is sent", async () => {
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));

    await userSets("customerName", "Ana");

    expect(sessionStorage.length).toBe(0);
  });

  test("sending again replaces the draft with the latest", async () => {
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await userSets("customerName", "Ana");
    await userSends();
    await userSets("customerName", "Ana Pérez");
    await userSends();

    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.getItem(`${DRAFT_PREFIX}${KEY}`)).toContain("Ana Pérez");
  });
});

describe("useFormDraft: coming back", () => {
  test("a form that was sent and saved comes back empty, with no notice, and the draft is thrown away", async () => {
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await fillAndSend();
    await unmount();

    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));

    expect(stateOf()).toEqual(EMPTY_STATE);
    expect(formEl().dataset.restored).toBe("false");
    expect(sessionStorage.getItem(`${DRAFT_PREFIX}${KEY}`)).toBeNull();
  });

  test("after the session ended, the form comes back filled, in the page and in React, with the notice", async () => {
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await fillAndSend();
    await unmount();
    markRecovery(sessionStorage, Date.now(), PAGE);

    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await untilRestored();

    expect(stateOf()).toEqual({
      name: "Ana Pérez",
      item: "other",
      description: "Revisión extra",
      picked: ["s1", "s3"],
    });
    expect(control("customerName").value).toBe("Ana Pérez");
    expect(control("item").value).toBe("other");
    expect(control("description").value).toBe("Revisión extra");
    expect(control("password").value).toBe("");
    expect(sessionStorage.getItem(CLAIM_KEY)).toBeNull();
    expect(sessionStorage.getItem(`${DRAFT_PREFIX}${KEY}`)).toBeNull();
  });

  test("what came back is what React renders, not only what the DOM shows (a later render keeps it)", async () => {
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await fillAndSend();
    await unmount();
    markRecovery(sessionStorage, Date.now(), PAGE);
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await untilRestored();

    await userSets("customerName", "Ana Pérez Gómez");

    expect(stateOf().name).toBe("Ana Pérez Gómez");
    expect(stateOf().item).toBe("other");
    expect(control("description").value).toBe("Revisión extra");
    expect(
      Array.from(formEl().querySelectorAll<HTMLInputElement>('input[name="ids"]')).map((box) => box.checked),
    ).toEqual([true, false, true]);
  });

  test("works under StrictMode, where React runs the effects twice", async () => {
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await fillAndSend();
    await unmount();
    markRecovery(sessionStorage, Date.now(), PAGE);

    await mount(createElement(StrictMode, null, createElement(PanelLikeForm, { draftKey: KEY })));
    await untilRestored();

    expect(stateOf().name).toBe("Ana Pérez");
    expect(stateOf().picked).toEqual(["s1", "s3"]);
  });

  test("a page that the router hides and shows again (Activity) keeps what was typed after it came back", async () => {
    // Next conserva las pantallas anteriores ocultas: al volver a mostrarse sus efectos corren de nuevo, y el
    // borrador que ya se recuperó no se vuelve a poner por encima de lo que se escribió después.
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await fillAndSend();
    await unmount();
    markRecovery(sessionStorage, Date.now(), PAGE);
    // (`Activity` exige `children` en sus props; `createElement` los recibe aparte.)
    const Screen = Activity as unknown as ComponentType<{ mode: "visible" | "hidden"; children?: ReactNode }>;
    const page = (mode: "visible" | "hidden") =>
      createElement(Screen, { mode }, createElement(PanelLikeForm, { draftKey: KEY }));
    root = createRoot(container);
    const mounted = root;
    await act(async () => mounted.render(page("visible")));
    await untilRestored();
    await userSets("customerName", "Ana Pérez Gómez");

    await act(async () => mounted.render(page("hidden")));
    await act(async () => mounted.render(page("visible")));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));

    expect(stateOf().name).toBe("Ana Pérez Gómez");
    expect(stateOf().picked).toEqual(["s1", "s3"]);
  });

  test("a recovery mark does not bring back the draft of another form", async () => {
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await fillAndSend();
    await unmount();
    markRecovery(sessionStorage, Date.now(), PAGE);

    await mount(createElement(PanelLikeForm, { draftKey: "alumno:nuevo" }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));

    expect(stateOf()).toEqual(EMPTY_STATE);
    expect(sessionStorage.getItem(CLAIM_KEY)).not.toBeNull();
    expect(sessionStorage.getItem(`${DRAFT_PREFIX}${KEY}`)).not.toBeNull();
  });

  test("a mark written for another page does not bring it back: a sale that was saved stays saved", async () => {
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await fillAndSend();
    await unmount();
    // La sesión terminó en otra pantalla y el login volvería a esa.
    markRecovery(sessionStorage, Date.now(), "/admin/alumnos/nuevo");

    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));

    expect(stateOf()).toEqual(EMPTY_STATE);
    expect(formEl().dataset.restored).toBe("false");
    expect(sessionStorage.getItem(`${DRAFT_PREFIX}${KEY}`)).toBeNull();
  });

  test("the notice goes away and the draft is gone when it is discarded", async () => {
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await fillAndSend();
    await unmount();
    markRecovery(sessionStorage, Date.now(), PAGE);
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await untilRestored();

    const discard = container.querySelector("button[type=button]") as HTMLButtonElement;
    await act(async () => discard.click());

    expect(formEl().dataset.restored).toBe("false");
    expect(container.querySelector("[role=status]")).toBeNull();
    expect(stateOf()).toEqual(EMPTY_STATE);
    expect(sessionStorage.length).toBe(0);
  });

  test("a form that comes back can be sent again, and the new send is the pending draft", async () => {
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await fillAndSend();
    await unmount();
    markRecovery(sessionStorage, Date.now(), PAGE);
    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await untilRestored();

    await userSets("customerName", "Ana Pérez Gómez");
    await userSends();

    expect(sessionStorage.getItem(`${DRAFT_PREFIX}${KEY}`)).toContain("Ana Pérez Gómez");
  });
});

describe("useFormDraft: when the browser gives no storage", () => {
  test("the form works as if there were no drafts", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("bloqueado", "SecurityError");
    });

    await mount(createElement(PanelLikeForm, { draftKey: KEY }));
    await userSets("customerName", "Ana");
    await userSends();

    expect(stateOf().name).toBe("Ana");
    expect(formEl().dataset.restored).toBe("false");
  });
});
