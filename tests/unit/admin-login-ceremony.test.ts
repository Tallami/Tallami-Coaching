import { describe, expect, test, vi } from "vitest";
import { UNAVAILABLE_MESSAGE, runCeremony, type Ceremony } from "@/components/admin/login-ceremony";

// La ceremonia del lado del navegador: lo que importa es que lo que falla en el
// navegador (cancelar, no tener la llave, otra dirección) nunca llega al servidor,
// así no cuenta como intento fallido, y que cada respuesta del servidor termine en
// la pantalla que corresponde.

const ORIGIN = "http://localhost:3100";
const OPTIONS = { challenge: "desafio" };

function ceremony(overrides: Partial<Ceremony<typeof OPTIONS>> = {}) {
  return {
    begin: vi.fn(async () => ({ ok: true as const, options: OPTIONS })),
    ask: vi.fn(async () => ({ id: "respuesta" })),
    finish: vi.fn(async () => ({ ok: true as const, redirectTo: "/admin/ventas" })),
    ...overrides,
  };
}

describe("runCeremony", () => {
  test("hands the options to the browser and its answer to the server, and ends where it was going", async () => {
    const steps = ceremony();

    expect(await runCeremony(steps, ORIGIN)).toEqual({ kind: "done", redirectTo: "/admin/ventas" });
    expect(steps.ask).toHaveBeenCalledWith(OPTIONS);
    expect(steps.finish).toHaveBeenCalledWith({ id: "respuesta" });
  });

  test("a cancelled prompt never reaches the server: it is not a failed attempt", async () => {
    const steps = ceremony({
      ask: vi.fn(async () => {
        throw new DOMException("The operation either timed out or was not allowed.", "NotAllowedError");
      }),
    });

    const outcome = await runCeremony(steps, ORIGIN);

    expect(outcome).toEqual({
      kind: "message",
      message:
        "Cancelaste o tu dispositivo no tiene una llave para este panel. Probá de nuevo, o usá tu celular con el código QR.",
    });
    expect(steps.finish).not.toHaveBeenCalled();
  });

  test("the wrong address says where the keys work, and does not reach the server either", async () => {
    const steps = ceremony({
      ask: vi.fn(async () => {
        throw new DOMException("The relying party ID is not a registrable domain suffix.", "SecurityError");
      }),
    });

    expect(await runCeremony(steps, ORIGIN)).toEqual({
      kind: "message",
      message: "Las llaves solo funcionan en http://localhost:3100.",
    });
    expect(steps.finish).not.toHaveBeenCalled();
  });

  test.each(["expired", "blocked"] as const)("a %s login at the start goes back to the login, without asking the browser", async (error) => {
    const steps = ceremony({ begin: vi.fn(async () => ({ ok: false as const, error })) });

    expect(await runCeremony(steps, ORIGIN)).toEqual({ kind: "restart", error });
    expect(steps.ask).not.toHaveBeenCalled();
  });

  test.each(["expired", "blocked"] as const)("a %s login at the end goes back to the login too", async (error) => {
    const steps = ceremony({ finish: vi.fn(async () => ({ ok: false as const, error })) });

    expect(await runCeremony(steps, ORIGIN)).toEqual({ kind: "restart", error });
  });

  test("a key the server could not verify stays on the step, to try again", async () => {
    const steps = ceremony({ finish: vi.fn(async () => ({ ok: false as const, error: "failed" as const })) });

    expect(await runCeremony(steps, ORIGIN)).toEqual({ kind: "failed" });
  });

  test("a server that does not answer gives a plain message, never an exception", async () => {
    const down = vi.fn(async () => {
      throw new Error("fetch failed");
    });

    expect(await runCeremony(ceremony({ begin: down }), ORIGIN)).toEqual({ kind: "message", message: UNAVAILABLE_MESSAGE });
    expect(await runCeremony(ceremony({ finish: down }), ORIGIN)).toEqual({ kind: "message", message: UNAVAILABLE_MESSAGE });
  });
});
