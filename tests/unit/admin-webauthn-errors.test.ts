import { describe, expect, test } from "vitest";
import { describeWebAuthnError } from "@/components/admin/webauthn-errors";

// Lo que dice el panel cuando el navegador no completa la llave. Estos errores
// nunca llegan al servidor (no cuentan como intento fallido): el texto es lo único
// que tiene Tallami para saber qué hacer.

const ORIGIN = "https://tallami.com";

const CANCELLED =
  "Cancelaste o tu dispositivo no tiene una llave para este panel. Probá de nuevo, usá tu celular con el código QR o tocá «Tengo un código».";
const ALREADY_REGISTERED = "Este dispositivo ya tiene una llave registrada.";
const GENERIC = "No se pudo usar la llave. Probá de nuevo.";

/** Así envuelve SimpleWebAuthn los errores del navegador: otro mensaje, el mismo `name`. */
function wrappedByTheLibrary(name: string): Error {
  return Object.assign(new Error("Mensaje de la librería, en inglés"), { name, code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" });
}

describe("describeWebAuthnError", () => {
  test("a cancelled prompt, or a device without a key for this panel, says what to try next", () => {
    const error = new DOMException("The operation either timed out or was not allowed.", "NotAllowedError");

    expect(describeWebAuthnError(error, ORIGIN)).toBe(CANCELLED);
  });

  test("the wrong address names the one where the keys work", () => {
    const error = new DOMException("The relying party ID is not a registrable domain suffix.", "SecurityError");

    expect(describeWebAuthnError(error, ORIGIN)).toBe("Las llaves solo funcionan en https://tallami.com.");
    expect(describeWebAuthnError(error, "http://localhost:3100")).toBe(
      "Las llaves solo funcionan en http://localhost:3100.",
    );
  });

  test("a device that already has a key says so", () => {
    const error = new DOMException("The user attempted to register an authenticator that contains one of the credentials already registered.", "InvalidStateError");

    expect(describeWebAuthnError(error, ORIGIN)).toBe(ALREADY_REGISTERED);
  });

  test.each([
    ["an abort", new DOMException("The operation was aborted.", "AbortError")],
    ["an unknown browser error", new DOMException("Unknown.", "UnknownError")],
    ["a plain error", new Error("WebAuthn is not supported in this browser")],
    ["a text", "algo salió mal"],
    ["nothing", undefined],
    ["null", null],
    ["an object with a strange name", { name: 42 }],
  ])("anything else (%s) is a plain try again", (_label, error) => {
    expect(describeWebAuthnError(error, ORIGIN)).toBe(GENERIC);
  });

  test("reads the name through the wrapper of the library too", () => {
    expect(describeWebAuthnError(wrappedByTheLibrary("NotAllowedError"), ORIGIN)).toBe(CANCELLED);
    expect(describeWebAuthnError(wrappedByTheLibrary("SecurityError"), ORIGIN)).toBe(
      "Las llaves solo funcionan en https://tallami.com.",
    );
    expect(describeWebAuthnError(wrappedByTheLibrary("InvalidStateError"), ORIGIN)).toBe(ALREADY_REGISTERED);
  });

  test("never shows the English message of the browser", () => {
    const error = new DOMException("The operation either timed out or was not allowed.", "NotAllowedError");

    expect(describeWebAuthnError(error, ORIGIN)).not.toContain("operation");
  });
});
