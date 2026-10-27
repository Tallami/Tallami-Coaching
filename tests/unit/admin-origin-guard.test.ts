// @vitest-environment jsdom
import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AddPasskey } from "@/admin/security/add-passkey";
import { ReauthError, withReauth } from "@/admin/security/with-reauth";
import { EnrollmentCodeStep } from "@/components/admin/enrollment-code-step";
import { FirstPasskey } from "@/components/admin/first-passkey";
import { runCeremony, type Ceremony } from "@/components/admin/login-ceremony";
import { PasskeyStep } from "@/components/admin/passkey-step";
import { originMismatchMessage } from "@/components/admin/webauthn-errors";

// Las llaves valen para UNA dirección (el origen configurado). En `www.tallami.com`, con
// el sitio configurado en `https://tallami.com`, el navegador acepta el dominio de la
// llave (es el padre) y no hay `SecurityError`: el que rechaza es el servidor, y cada
// intento cuenta como fallo hasta el bloqueo. Por eso cada puerta del navegador compara
// la dirección de la pestaña con la configurada ANTES de pedirle nada al servidor.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  beginAdd: vi.fn(),
  finishAdd: vi.fn(),
  beginReauth: vi.fn(),
  finishReauth: vi.fn(),
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/app/admin/configuracion/seguridad/actions", () => ({
  beginAddPasskeyAction: mocks.beginAdd,
  finishAddPasskeyAction: mocks.finishAdd,
  beginReauthAction: mocks.beginReauth,
  finishReauthAction: mocks.finishReauth,
}));
vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: mocks.startRegistration,
  startAuthentication: mocks.startAuthentication,
}));

/** La dirección de esta pestaña (en jsdom, la de la prueba) y otra, la configurada, que no coincide. */
const HERE = window.location.origin;
const OTHER = "https://tallami.com";
const WRONG_ORIGIN = `Las llaves solo funcionan en ${OTHER}.`;
const REAUTH_REQUIRED = { ok: false, error: "reauth-required" } as const;

let container: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  vi.resetAllMocks();
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  const mounted = root;
  root = null;
  if (mounted) await act(async () => mounted.unmount());
  container.remove();
});

async function mount(element: Parameters<Root["render"]>[0]): Promise<void> {
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => mounted.render(element));
}

async function click(label: string): Promise<void> {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!button) throw new Error(`No hay un botón «${label}».`);
  await act(async () => button.click());
}

async function submit(label: string): Promise<void> {
  const form = container.querySelector("form");
  if (!form) throw new Error("No hay un formulario.");
  const button = Array.from(form.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  if (!button) throw new Error(`No hay un botón «${label}».`);
  await act(async () => button.click());
}

function typeInto(selector: string, value: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`No hay un campo ${selector}.`);
  return act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const hrefs = { restartHref: "/admin/login", expiredHref: "/admin/login?error=expired", blockedHref: "/admin/login?error=blocked" };
const codeActions = {
  redeem: vi.fn(),
  begin: vi.fn(),
  finish: vi.fn(),
};

describe("originMismatchMessage", () => {
  test("is null on the configured address, and says where the keys work on any other", () => {
    expect(originMismatchMessage(HERE)).toBeNull();
    expect(originMismatchMessage(OTHER)).toBe(WRONG_ORIGIN);
  });

  test("is the same text the browser's SecurityError gets", async () => {
    const { describeWebAuthnError } = await import("@/components/admin/webauthn-errors");

    expect(originMismatchMessage(OTHER)).toBe(
      describeWebAuthnError(new DOMException("The relying party ID is not a registrable domain suffix.", "SecurityError"), OTHER),
    );
  });

  test("is null where there is no browser, so the server renders and tests in node are untouched", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(originMismatchMessage(OTHER)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("runCeremony", () => {
  function steps(): Ceremony<{ challenge: string }> {
    return {
      begin: vi.fn(async () => ({ ok: true as const, options: { challenge: "desafio" } })),
      ask: vi.fn(async () => ({ id: "respuesta" })),
      finish: vi.fn(async () => ({ ok: true as const, redirectTo: "/admin" })),
    };
  }

  test("on another address than the configured one, never reaches the server or the browser", async () => {
    const ceremony = steps();

    expect(await runCeremony(ceremony, OTHER)).toEqual({ kind: "message", message: WRONG_ORIGIN });

    expect(ceremony.begin).not.toHaveBeenCalled();
    expect(ceremony.ask).not.toHaveBeenCalled();
    expect(ceremony.finish).not.toHaveBeenCalled();
  });

  test("on the configured address it goes on as always", async () => {
    const ceremony = steps();

    expect(await runCeremony(ceremony, HERE)).toEqual({ kind: "done", redirectTo: "/admin" });
    expect(ceremony.begin).toHaveBeenCalledOnce();
  });
});

describe("withReauth", () => {
  test("on another address than the configured one, does not ask the server for the key and says where the keys work", async () => {
    const run = vi.fn(async () => REAUTH_REQUIRED);

    const error = await withReauth(run, OTHER).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ReauthError);
    expect((error as ReauthError).message).toBe(WRONG_ORIGIN);
    expect(mocks.beginReauth).not.toHaveBeenCalled();
    expect(mocks.startAuthentication).not.toHaveBeenCalled();
    expect(mocks.finishReauth).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledOnce();
  });
});

describe("the screens that ask for a key", () => {
  test("the key step: «Usar mi llave» says where the keys work and never reaches the server", async () => {
    const begin = vi.fn();
    const finish = vi.fn();
    await mount(createElement(PasskeyStep, { begin, finish, origin: OTHER, ...hrefs, code: { ...codeActions, defaultName: "PC" } }));

    await click("Usar mi llave");

    expect(container.textContent).toContain(WRONG_ORIGIN);
    expect(begin).not.toHaveBeenCalled();
    expect(mocks.startAuthentication).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  test("the first key: «Registrar mi llave» says where the keys work and never reaches the server", async () => {
    const begin = vi.fn();
    const finish = vi.fn();
    await mount(createElement(FirstPasskey, { begin, finish, origin: OTHER, defaultName: "PC", ...hrefs }));

    await submit("Registrar mi llave");

    expect(container.textContent).toContain(WRONG_ORIGIN);
    expect(begin).not.toHaveBeenCalled();
    expect(mocks.startRegistration).not.toHaveBeenCalled();
    expect(finish).not.toHaveBeenCalled();
  });

  test("the key of a new device after a code: registering says where the keys work and never reaches the server", async () => {
    await mount(
      createElement(EnrollmentCodeStep, { initialPhase: "register", ...codeActions, origin: OTHER, defaultName: "PC", ...hrefs }),
    );

    await submit("Registrar la llave de este dispositivo");

    expect(container.textContent).toContain(WRONG_ORIGIN);
    expect(codeActions.begin).not.toHaveBeenCalled();
    expect(mocks.startRegistration).not.toHaveBeenCalled();
  });

  test("typing a code on another address does not burn it: it says where the keys work and never reaches the server", async () => {
    await mount(
      createElement(EnrollmentCodeStep, { initialPhase: "enter", ...codeActions, origin: OTHER, defaultName: "PC", ...hrefs }),
    );
    await typeInto("input[name=code]", "ABCDE-FGHJK");

    await submit("Continuar");

    expect(container.textContent).toContain(WRONG_ORIGIN);
    expect(codeActions.redeem).not.toHaveBeenCalled();
  });

  test("Configuración → Seguridad: «Agregar una llave» says where the keys work and never reaches the server", async () => {
    await mount(createElement(AddPasskey, { defaultName: "Chrome en Windows", origin: OTHER }));

    await submit("Agregar una llave en este dispositivo");

    expect(container.textContent).toContain(WRONG_ORIGIN);
    expect(mocks.beginAdd).not.toHaveBeenCalled();
    expect(mocks.startRegistration).not.toHaveBeenCalled();
    expect(mocks.finishAdd).not.toHaveBeenCalled();
  });

  test("on the configured address the key step asks the server as always", async () => {
    const begin = vi.fn(async () => ({ ok: false as const, error: "expired" as const }));
    await mount(createElement(PasskeyStep, { begin, finish: vi.fn(), origin: HERE, ...hrefs, code: { ...codeActions, defaultName: "PC" } }));

    await click("Usar mi llave");

    expect(begin).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain("Las llaves solo funcionan");
  });
});
