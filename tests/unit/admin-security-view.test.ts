import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { Passkey } from "@/admin/auth/passkeys";
import type { AdminSession } from "@/admin/auth/sessions";
import { SecurityView } from "@/admin/security/security-view";

// Lo que se ve en Configuración → Seguridad, dibujado en el servidor. Los botones
// llaman a acciones del servidor y al router de Next: acá solo se mira el texto y la
// estructura, así que el router es un doble.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }) }));

const ORIGIN = "https://panel.tallami.example";
const CURRENT = "sesion-actual";

function passkey(overrides: Partial<Passkey> = {}): Passkey {
  return {
    id: "llave-1",
    credentialId: "credencial-1",
    publicKey: "clave-publica",
    counter: 0,
    transports: ["internal"],
    name: "Celular",
    createdAt: new Date("2026-10-15T17:30:00.000Z"),
    lastUsedAt: null,
    ...overrides,
  };
}

function session(overrides: Partial<AdminSession> = {}): AdminSession {
  return {
    id: CURRENT,
    passkeyId: "llave-1",
    device: "Chrome en Windows",
    createdAt: new Date("2026-10-16T01:15:00.000Z"),
    lastSeenAt: new Date("2026-10-16T01:40:00.000Z"),
    reauthAt: null,
    ...overrides,
  };
}

function render(props: Partial<Parameters<typeof SecurityView>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(SecurityView, {
      passkeys: [passkey()],
      sessions: [session()],
      currentSessionId: CURRENT,
      defaultKeyName: "Chrome en Windows",
      origin: ORIGIN,
      alerts: { kind: "off" },
      ...props,
    }),
  );
}

describe("SecurityView", () => {
  test("lists each key with its name, when it was added and when it was last used, in Argentine time", () => {
    const markup = render({
      passkeys: [
        passkey({ lastUsedAt: new Date("2026-10-20T18:00:00.000Z") }),
        passkey({ id: "llave-2", credentialId: "credencial-2", name: "Notebook" }),
      ],
    });

    expect(markup).toContain("Celular");
    expect(markup).toContain("Agregada el 15/10/2026, 14:30");
    expect(markup).toContain("Último uso: 20/10/2026, 15:00");
    expect(markup).toContain("Notebook");
    // Una llave que nunca se usó no inventa una fecha.
    expect(markup).toContain("Todavía no la usaste para ingresar");
  });

  test("gives each key a rename and a delete button named after it", () => {
    const markup = render();

    expect(markup).toContain("Renombrar<span class=\"sr-only\"> Celular</span>");
    expect(markup).toContain("Borrar<span class=\"sr-only\"> Celular</span>");
  });

  test("does not say which key is this device's: the panel cannot know it", () => {
    const markup = render({
      passkeys: [passkey(), passkey({ id: "llave-2", credentialId: "credencial-2", name: "Notebook" })],
    });

    expect(markup).not.toContain("Este dispositivo");
    expect(markup).not.toContain("Esta llave");
  });

  test("lists the open sessions with the device and both times, and marks only this one", () => {
    const markup = render({
      sessions: [
        session(),
        session({ id: "otra", device: "Safari en iPhone", createdAt: new Date("2026-10-15T12:00:00.000Z"), lastSeenAt: new Date("2026-10-15T12:10:00.000Z") }),
      ],
    });

    expect(markup).toContain("Chrome en Windows");
    expect(markup).toContain("Inició el 15/10/2026, 22:15 · Último uso: 15/10/2026, 22:40");
    expect(markup).toContain("Safari en iPhone");
    expect(markup).toContain("Inició el 15/10/2026, 09:00 · Último uso: 15/10/2026, 09:10");
    expect(markup.match(/Esta sesión/g)).toHaveLength(1);
  });

  test("has the buttons of the design: add a key, a code for another device, close every session", () => {
    const markup = render();

    expect(markup).toContain("Agregar una llave en este dispositivo");
    expect(markup).toContain("Generar un código");
    expect(markup).toContain("Cerrar todas las sesiones");
  });

  test("proposes the name of this device for the new key", () => {
    expect(render({ defaultKeyName: "Edge en Windows" })).toContain('value="Edge en Windows"');
  });

  test("says the email alerts are not configured when there is nothing to send them with", () => {
    const markup = render({ alerts: { kind: "off" } });

    expect(markup).toContain("Avisos por email: sin configurar");
    expect(markup).not.toContain("activos");
    expect(markup).not.toContain("inválida");
  });

  test("says the configuration is not valid, and which variable to fix, when the address is wrong", () => {
    const markup = render({ alerts: { kind: "invalid", variable: "ADMIN_ALERT_EMAIL" } });

    expect(markup).toContain("Avisos por email: configuración inválida");
    expect(markup).toContain("ADMIN_ALERT_EMAIL");
    expect(markup).not.toContain("sin configurar");
    expect(markup).not.toContain("activos");
  });

  test("says where the email alerts go, with the address masked", () => {
    const markup = render({ alerts: { kind: "active", maskedEmail: "t***@gmail.com", usesTestSender: false } });

    expect(markup).toContain("Avisos por email: activos (a t***@gmail.com)");
    expect(markup).not.toContain("sin configurar");
    expect(markup).not.toContain("dirección de prueba");
  });

  test("warns that Resend's test address only delivers to the Resend account's own email", () => {
    const markup = render({ alerts: { kind: "active", maskedEmail: "t***@gmail.com", usesTestSender: true } });

    expect(markup).toContain("Avisos por email: activos (a t***@gmail.com)");
    expect(markup).toContain("dirección de prueba de Resend");
    expect(markup).toContain("solo entrega al email de tu cuenta de Resend");
  });

  test("never prints a code before one is asked for", () => {
    expect(render()).not.toMatch(/[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}/);
  });
});
