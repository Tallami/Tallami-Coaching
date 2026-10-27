// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ENROLLMENT_CODE_MS } from "@/admin/auth/policy";
import { EnrollmentCode } from "@/admin/security/enrollment-code";

// El código para otro dispositivo se muestra con el aviso de cuánto dura. Ese número sale de la
// política (`ENROLLMENT_CODE_MS`), no de una copia en el texto: si la política cambia, el aviso sigue.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ generate: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/admin/configuracion/seguridad/actions", () => ({
  generateEnrollmentCodeAction: mocks.generate,
  beginReauthAction: vi.fn(),
  finishReauthAction: vi.fn(),
}));

const ORIGIN = window.location.origin;

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

/** Muestra el código recién generado (la acción del servidor es un doble) y devuelve lo que se lee en pantalla. */
async function generatedCodeText(component: typeof EnrollmentCode): Promise<string> {
  mocks.generate.mockResolvedValue({
    ok: true,
    code: "ABCDE-FGHJK",
    expiresAt: new Date(Date.now() + ENROLLMENT_CODE_MS).toISOString(),
  });
  const mounted = createRoot(container);
  root = mounted;
  await act(async () => mounted.render(createElement(component, { origin: ORIGIN })));
  const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
    candidate.textContent?.includes("Generar un código"),
  );
  await act(async () => button?.click());
  return container.textContent ?? "";
}

describe("EnrollmentCode", () => {
  test("says how long the code lasts, from the policy", async () => {
    const text = await generatedCodeText(EnrollmentCode);

    expect(text).toContain("ABCDE-FGHJK");
    expect(text).toContain(`Usalo antes de ${ENROLLMENT_CODE_MS / 60_000} minutos`);
  });

  test("follows the policy: with another duration the notice says the other number", async () => {
    vi.resetModules();
    vi.doMock("@/admin/auth/policy", async (importOriginal) => ({
      ...(await importOriginal<typeof import("@/admin/auth/policy")>()),
      ENROLLMENT_CODE_MS: 20 * 60 * 1000,
    }));
    try {
      const { EnrollmentCode: WithOtherPolicy } = await import("@/admin/security/enrollment-code");

      expect(await generatedCodeText(WithOtherPolicy)).toContain("Usalo antes de 20 minutos");
    } finally {
      vi.doUnmock("@/admin/auth/policy");
      vi.resetModules();
    }
  });
});
