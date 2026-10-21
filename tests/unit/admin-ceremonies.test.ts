import { randomUUID } from "node:crypto";
import { verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  authenticationOptions,
  registrationOptions,
  verifyAuthentication,
  verifyRegistration,
  type NewPasskeyData,
} from "@/admin/auth/ceremonies";
import type { Passkey } from "@/admin/auth/passkeys";
import { getWebAuthnConfig } from "@/admin/auth/webauthn-config";
import { createVirtualAuthenticator, type VirtualAuthenticator } from "../helpers/virtual-authenticator";

// La librería queda envuelta en espías que conservan su comportamiento: casi
// todos los tests pasan por la criptografía de verdad (con un autenticador
// virtual) y solo algunos le piden a la librería que tire o que diga que no.
vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@simplewebauthn/server")>();
  return {
    ...actual,
    verifyRegistrationResponse: vi.fn(actual.verifyRegistrationResponse),
    verifyAuthenticationResponse: vi.fn(actual.verifyAuthenticationResponse),
  };
});

const mockedVerifyRegistration = vi.mocked(verifyRegistrationResponse);
const mockedVerifyAuthentication = vi.mocked(verifyAuthenticationResponse);

const ORIGIN = "http://localhost:3100";
const RP_ID = "localhost";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADMIN_WEBAUTHN_ORIGIN", ORIGIN);
  vi.stubEnv("VERCEL_ENV", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function passkeyFrom(data: NewPasskeyData, overrides: Partial<Passkey> = {}): Passkey {
  return {
    id: randomUUID(),
    ...data,
    name: "Celular",
    createdAt: new Date("2026-10-21T10:00:00.000Z"),
    lastUsedAt: null,
    ...overrides,
  };
}

function savedPasskey(overrides: Partial<Passkey> = {}): Passkey {
  return passkeyFrom(
    { credentialId: "credencial-guardada", publicKey: "clave-publica", counter: 0, transports: ["internal"] },
    overrides,
  );
}

/** Un dispositivo nuevo, ya registrado: la llave guardada y el dispositivo que la firma. */
async function registeredDevice(): Promise<{ device: VirtualAuthenticator; passkey: Passkey }> {
  const device = createVirtualAuthenticator({ rpID: RP_ID, origin: ORIGIN });
  const options = await registrationOptions([]);
  const data = await verifyRegistration(device.register(options), options.challenge);
  if (!data) throw new Error("El registro de prueba debería haber salido bien.");
  return { device, passkey: passkeyFrom(data) };
}

describe("registrationOptions", () => {
  test("asks for a key that verifies the user, with no attestation and no restriction on the kind of device", async () => {
    const options = await registrationOptions([]);

    expect(options.authenticatorSelection).toMatchObject({ userVerification: "required", residentKey: "preferred" });
    expect(options.authenticatorSelection).not.toHaveProperty("authenticatorAttachment");
    expect(options.attestation).toBe("none");
  });

  test("takes the relying party from the configuration", async () => {
    const options = await registrationOptions([]);

    expect(options.rp).toEqual({ id: getWebAuthnConfig().rpID, name: "Panel de Tallami" });
    expect(options.rp.id).toBe(RP_ID);
  });

  test("always registers for the same fixed user", async () => {
    const first = await registrationOptions([]);
    const second = await registrationOptions([]);

    expect(first.user).toMatchObject({
      id: Buffer.from("tallami-admin").toString("base64url"),
      name: "Tallami",
    });
    expect(second.user).toEqual(first.user);
  });

  test("excludes the keys already registered, with their transports", async () => {
    const options = await registrationOptions([
      savedPasskey({ credentialId: "una", transports: ["internal", "hybrid"] }),
      savedPasskey({ credentialId: "otra", transports: [] }),
    ]);

    expect(options.excludeCredentials).toEqual([
      { id: "una", type: "public-key", transports: ["internal", "hybrid"] },
      { id: "otra", type: "public-key", transports: [] },
    ]);
  });

  test("drops transports it does not know instead of passing them to the browser", async () => {
    const options = await registrationOptions([savedPasskey({ transports: ["usb", "invento", "hybrid"] })]);

    expect(options.excludeCredentials?.[0].transports).toEqual(["usb", "hybrid"]);
  });

  test("a fresh unpredictable challenge every time", async () => {
    const challenges = await Promise.all([registrationOptions([]), registrationOptions([]), registrationOptions([])]);

    const values = challenges.map((options) => options.challenge);
    expect(new Set(values).size).toBe(3);
    for (const value of values) expect(value).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });
});

describe("authenticationOptions", () => {
  test("allows every registered key, with its transports, and requires user verification", async () => {
    const options = await authenticationOptions([
      savedPasskey({ credentialId: "celular", transports: ["internal", "hybrid"] }),
      savedPasskey({ credentialId: "llave-usb", transports: ["usb"] }),
    ]);

    expect(options.allowCredentials).toEqual([
      { id: "celular", type: "public-key", transports: ["internal", "hybrid"] },
      { id: "llave-usb", type: "public-key", transports: ["usb"] },
    ]);
    expect(options.userVerification).toBe("required");
    expect(options.rpId).toBe(RP_ID);
  });

  test("a fresh challenge every time", async () => {
    const [first, second] = await Promise.all([authenticationOptions([]), authenticationOptions([])]);

    expect(first.challenge).not.toBe(second.challenge);
  });
});

describe("verifyRegistration", () => {
  test("accepts a real registration and hands back the key as the database stores it", async () => {
    const device = createVirtualAuthenticator({ rpID: RP_ID, origin: ORIGIN });
    const options = await registrationOptions([]);

    const data = await verifyRegistration(device.register(options), options.challenge);

    expect(data).toEqual({
      credentialId: device.credentialId,
      publicKey: expect.stringMatching(/^[A-Za-z0-9_-]+$/),
      counter: 0,
      transports: ["internal"],
    });
  });

  test("rejects a challenge other than the one that was given", async () => {
    const device = createVirtualAuthenticator({ rpID: RP_ID, origin: ORIGIN });
    const options = await registrationOptions([]);

    expect(await verifyRegistration(device.register(options), "otro-desafio")).toBeNull();
    expect(await verifyRegistration(device.register(options), "")).toBeNull();
  });

  test("rejects a registration made from another origin", async () => {
    const device = createVirtualAuthenticator({ rpID: RP_ID, origin: ORIGIN });
    const options = await registrationOptions([]);
    const phished = device.register(options, { origin: "https://sitio-trucho.example.com" });

    expect(await verifyRegistration(phished, options.challenge)).toBeNull();
  });

  test("rejects a registration where the device did not verify the user", async () => {
    const device = createVirtualAuthenticator({ rpID: RP_ID, origin: ORIGIN });
    const options = await registrationOptions([]);

    expect(await verifyRegistration(device.register(options, { userVerified: false }), options.challenge)).toBeNull();
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "una respuesta"],
    ["a number", 42],
    ["an array", []],
    ["an empty object", {}],
    ["an object without response", { id: "x", rawId: "x", type: "public-key" }],
    ["a response that is not an object", { id: "x", rawId: "x", type: "public-key", response: "texto" }],
    ["a type that is not public-key", { id: "x", rawId: "x", type: "password", response: {} }],
    ["an id that is not a string", { id: 7, rawId: "x", type: "public-key", response: {} }],
    ["well-shaped garbage", { id: "x", rawId: "x", type: "public-key", response: { clientDataJSON: "basura" } }],
  ])("returns null instead of throwing for %s", async (_label, garbage) => {
    await expect(verifyRegistration(garbage, "un-desafio")).resolves.toBeNull();
  });

  test("does not call the library at all when the response lacks the basic shape", async () => {
    await verifyRegistration({ nada: true }, "un-desafio");

    expect(mockedVerifyRegistration).not.toHaveBeenCalled();
  });

  test("asks the library to check the configured origin and rpID, presence and user verification", async () => {
    const device = createVirtualAuthenticator({ rpID: RP_ID, origin: ORIGIN });
    const options = await registrationOptions([]);
    const response = device.register(options);

    await verifyRegistration(response, options.challenge);

    expect(mockedVerifyRegistration).toHaveBeenCalledWith(
      expect.objectContaining({
        response,
        expectedChallenge: options.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserPresence: true,
        requireUserVerification: true,
      }),
    );
  });

  test("returns null, and logs why, when the library throws", async () => {
    mockedVerifyRegistration.mockRejectedValueOnce(new Error("origen distinto"));
    const device = createVirtualAuthenticator({ rpID: RP_ID, origin: ORIGIN });
    const options = await registrationOptions([]);

    expect(await verifyRegistration(device.register(options), options.challenge)).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("origen distinto"));
  });

  test("logs the reason on one short line, whatever text the browser managed to put in it", async () => {
    mockedVerifyRegistration.mockRejectedValueOnce(new Error(`origen ${"x".repeat(500)}\nFalsa línea de log\r\n`));
    const device = createVirtualAuthenticator({ rpID: RP_ID, origin: ORIGIN });
    const options = await registrationOptions([]);

    await verifyRegistration(device.register(options), options.challenge);

    const [logged] = vi.mocked(console.warn).mock.calls[0];
    expect(logged).not.toMatch(/[\r\n]/);
    expect(String(logged).length).toBeLessThan(300);
  });

  test("returns null when the library says it is not verified", async () => {
    mockedVerifyRegistration.mockResolvedValueOnce({ verified: false });
    const device = createVirtualAuthenticator({ rpID: RP_ID, origin: ORIGIN });
    const options = await registrationOptions([]);

    expect(await verifyRegistration(device.register(options), options.challenge)).toBeNull();
  });

  test("when the library says verified, hands back its credential with the key as base64url", async () => {
    mockedVerifyRegistration.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: {
          id: "id-de-la-credencial",
          publicKey: new Uint8Array([251, 255, 254, 1, 2, 3]),
          counter: 3,
          transports: ["usb", "hybrid"],
        },
      },
    } as Awaited<ReturnType<typeof verifyRegistrationResponse>>);
    const device = createVirtualAuthenticator({ rpID: RP_ID, origin: ORIGIN });
    const options = await registrationOptions([]);

    expect(await verifyRegistration(device.register(options), options.challenge)).toEqual({
      credentialId: "id-de-la-credencial",
      publicKey: "-__-AQID",
      counter: 3,
      transports: ["usb", "hybrid"],
    });
  });

  test("when the library does not report transports, stores an empty list", async () => {
    mockedVerifyRegistration.mockResolvedValueOnce({
      verified: true,
      registrationInfo: {
        credential: { id: "sin-transportes", publicKey: new Uint8Array([1]), counter: 0 },
      },
    } as Awaited<ReturnType<typeof verifyRegistrationResponse>>);
    const device = createVirtualAuthenticator({ rpID: RP_ID, origin: ORIGIN });
    const options = await registrationOptions([]);

    const data = await verifyRegistration(device.register(options), options.challenge);

    expect(data?.transports).toEqual([]);
  });
});

describe("verifyAuthentication", () => {
  test("accepts a real signature from the registered key and reports the new counter", async () => {
    const { device, passkey } = await registeredDevice();
    const options = await authenticationOptions([passkey]);

    const result = await verifyAuthentication(device.authenticate(options, { counter: 1 }), options.challenge, passkey);

    expect(result).toEqual({ newCounter: 1 });
  });

  test("a key whose counter stays at zero keeps working", async () => {
    const { device, passkey } = await registeredDevice();
    const options = await authenticationOptions([passkey]);

    expect(await verifyAuthentication(device.authenticate(options, { counter: 0 }), options.challenge, passkey)).toEqual({
      newCounter: 0,
    });
  });

  test("rejects a challenge other than the one that was given", async () => {
    const { device, passkey } = await registeredDevice();
    const options = await authenticationOptions([passkey]);

    expect(await verifyAuthentication(device.authenticate(options, { counter: 1 }), "otro-desafio", passkey)).toBeNull();
  });

  test("rejects a signature that was made for a different challenge (replay)", async () => {
    const { device, passkey } = await registeredDevice();
    const oldOptions = await authenticationOptions([passkey]);
    const newOptions = await authenticationOptions([passkey]);
    const replayed = device.authenticate(oldOptions, { counter: 1 });

    expect(await verifyAuthentication(replayed, newOptions.challenge, passkey)).toBeNull();
  });

  test("rejects a counter that does not go up", async () => {
    const { device, passkey } = await registeredDevice();
    const options = await authenticationOptions([passkey]);
    const used = { ...passkey, counter: 5 };

    expect(await verifyAuthentication(device.authenticate(options, { counter: 5 }), options.challenge, used)).toBeNull();
    expect(await verifyAuthentication(device.authenticate(options, { counter: 4 }), options.challenge, used)).toBeNull();
    expect(await verifyAuthentication(device.authenticate(options, { counter: 6 }), options.challenge, used)).toEqual({
      newCounter: 6,
    });
  });

  test("rejects an assertion where the device did not verify the user", async () => {
    const { device, passkey } = await registeredDevice();
    const options = await authenticationOptions([passkey]);
    const unverified = device.authenticate(options, { counter: 1, userVerified: false });

    expect(await verifyAuthentication(unverified, options.challenge, passkey)).toBeNull();
  });

  test("rejects an assertion made from another origin", async () => {
    const { device, passkey } = await registeredDevice();
    const options = await authenticationOptions([passkey]);
    const phished = device.authenticate(options, { counter: 1, origin: "https://sitio-trucho.example.com" });

    expect(await verifyAuthentication(phished, options.challenge, passkey)).toBeNull();
  });

  test("rejects a signature from a different device, even one that claims the same credential id", async () => {
    const { device, passkey } = await registeredDevice();
    const impostor = createVirtualAuthenticator({ rpID: RP_ID, origin: ORIGIN });
    const options = await authenticationOptions([passkey]);
    const forged = { ...impostor.authenticate(options, { counter: 1 }), id: device.credentialId, rawId: device.credentialId };

    expect(await verifyAuthentication(forged, options.challenge, passkey)).toBeNull();
  });

  test("rejects an assertion from a key other than the one it is checked against", async () => {
    const { device } = await registeredDevice();
    const { passkey: otherPasskey } = await registeredDevice();
    const options = await authenticationOptions([otherPasskey]);

    expect(await verifyAuthentication(device.authenticate(options, { counter: 1 }), options.challenge, otherPasskey)).toBeNull();
  });

  test.each([
    ["null", null],
    ["a string", "una respuesta"],
    ["an array", []],
    ["an empty object", {}],
    ["an object without response", { id: "x", rawId: "x", type: "public-key" }],
    ["a type that is not public-key", { id: "x", rawId: "x", type: "otro", response: {} }],
    ["well-shaped garbage", { id: "x", rawId: "x", type: "public-key", response: { clientDataJSON: "basura" } }],
  ])("returns null instead of throwing for %s", async (_label, garbage) => {
    await expect(verifyAuthentication(garbage, "un-desafio", savedPasskey())).resolves.toBeNull();
  });

  test("asks the library to check the configured origin and rpID and to require user verification", async () => {
    const { device, passkey } = await registeredDevice();
    const options = await authenticationOptions([passkey]);
    const response = device.authenticate(options, { counter: 2 });
    const stored = { ...passkey, counter: 1 };

    await verifyAuthentication(response, options.challenge, stored);

    expect(mockedVerifyAuthentication).toHaveBeenCalledWith(
      expect.objectContaining({
        response,
        expectedChallenge: options.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
        credential: {
          id: stored.credentialId,
          publicKey: expect.any(Uint8Array),
          counter: 1,
          transports: stored.transports,
        },
      }),
    );
  });

  test("returns null, and logs why, when the library throws", async () => {
    mockedVerifyAuthentication.mockRejectedValueOnce(new Error("contador menor"));
    const { device, passkey } = await registeredDevice();
    const options = await authenticationOptions([passkey]);

    expect(await verifyAuthentication(device.authenticate(options, { counter: 1 }), options.challenge, passkey)).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("contador menor"));
  });

  test("returns null when the library says it is not verified", async () => {
    mockedVerifyAuthentication.mockResolvedValueOnce({
      verified: false,
      authenticationInfo: { newCounter: 9 },
    } as Awaited<ReturnType<typeof verifyAuthenticationResponse>>);
    const { device, passkey } = await registeredDevice();
    const options = await authenticationOptions([passkey]);

    expect(await verifyAuthentication(device.authenticate(options, { counter: 1 }), options.challenge, passkey)).toBeNull();
  });

  test("when the library says verified, hands back its new counter", async () => {
    mockedVerifyAuthentication.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 42 },
    } as Awaited<ReturnType<typeof verifyAuthenticationResponse>>);
    const { device, passkey } = await registeredDevice();
    const options = await authenticationOptions([passkey]);

    expect(await verifyAuthentication(device.authenticate(options, { counter: 1 }), options.challenge, passkey)).toEqual({
      newCounter: 42,
    });
  });
});
