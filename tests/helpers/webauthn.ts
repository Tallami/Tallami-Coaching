// Llaves de acceso para los e2e: el autenticador virtual de Chrome (dominio
// `WebAuthn` del protocolo de DevTools, por una sesión CDP de Playwright) y las
// llaves de prueba que los servidores de los e2e tienen registradas de antemano.
//
// - Cada llave de prueba sale de un "slot" (0, 1, 2…) y es siempre la misma: la
//   clave privada P-256 es el SHA-256 de "tallami-e2e-passkey-<slot>". El seed
//   (`seed-e2e-passkeys.ts`) guarda las de los slots 0 a 31 en la base del servidor
//   y cada worker de Playwright usa la de su `parallelIndex`, así los tests en
//   paralelo no comparten llave ni contador.
// - El contador de firma tiene que subir en cada uso (el servidor rechaza uno que no
//   sube). Chrome lo sube uno por cada firma; al cargar la llave en un autenticador
//   nuevo se parte de `nextSignCount`, que sube también entre procesos y contra un
//   servidor reutilizado de una corrida anterior.
//
// Solo para tests. Este archivo no importa `@playwright/test` más que sus tipos: lo
// carga también el seed, que corre con `tsx` fuera de Playwright.

import { createECDH, createHash, createPrivateKey } from "node:crypto";
import type { CDPSession, Page } from "@playwright/test";
import { coseKey } from "./virtual-authenticator";

/** Cuántos slots tienen su llave registrada en los servidores principal y de datos de ejemplo. */
export const SEEDED_SLOTS = 32;
/** El sitio de las llaves en los e2e: los servidores corren en `localhost`. */
export const TEST_RP_ID = "localhost";
/** El usuario de las llaves del panel (`USER_ID` en `src/admin/auth/ceremonies.ts`). */
const USER_HANDLE = Buffer.from("tallami-admin");
const SIGN_COUNT_EPOCH_MS = Date.UTC(2026, 0, 1);
const SECOND_MS = 1000;

export type TestPasskey = {
  /** El id de la credencial, en base64url (como lo guarda el panel). */
  credentialId: string;
  /** La clave privada en PKCS#8, en base64 (como la recibe el autenticador virtual). */
  privateKeyPkcs8: string;
  /** La clave pública en COSE, en base64url (como la guarda el panel). */
  publicKeyCose: string;
};

/** La llave de prueba del slot `slot`: siempre la misma para el mismo slot. */
export function testPasskey(slot: number): TestPasskey {
  const scalar = createHash("sha256").update(`tallami-e2e-passkey-${slot}`).digest();
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(scalar);
  // Punto sin comprimir: 0x04, X (32 bytes), Y (32 bytes).
  const point = ecdh.getPublicKey();
  const x = point.subarray(1, 33);
  const y = point.subarray(33, 65);
  const privateKey = createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: scalar.toString("base64url"), x: x.toString("base64url"), y: y.toString("base64url") },
    format: "jwk",
  });
  const credentialId = createHash("sha256").update(`tallami-e2e-credential-${slot}`).digest().subarray(0, 16);
  return {
    credentialId: credentialId.toString("base64url"),
    privateKeyPkcs8: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    publicKeyCose: coseKey(x, y).toString("base64url"),
  };
}

/** Una llave tal como la maneja el autenticador virtual (`WebAuthn.Credential` del protocolo; binarios en base64). */
export type VirtualCredential = {
  credentialId: string;
  isResidentCredential: boolean;
  rpId?: string;
  privateKey: string;
  userHandle?: string;
  signCount: number;
};

const lastSignCount = new Map<number, number>();

/**
 * El contador con el que se carga la llave del slot `slot` en un autenticador:
 * `max(último + 1, segundos desde 2026-01-01)`, por proceso. Dentro del proceso sube
 * de a uno por carga; entre procesos (otro worker con el mismo slot, otra corrida
 * contra el mismo servidor) lo sube el reloj.
 */
export function nextSignCount(slot: number, now: number = Date.now()): number {
  const seconds = Math.floor((now - SIGN_COUNT_EPOCH_MS) / SECOND_MS);
  const next = Math.max((lastSignCount.get(slot) ?? -1) + 1, seconds);
  lastSignCount.set(slot, next);
  return next;
}

/** La sesión CDP de cada página y su autenticador virtual actual (uno por página). */
const devtools = new WeakMap<Page, { session: CDPSession; authenticatorId?: string }>();

async function devtoolsFor(page: Page): Promise<{ session: CDPSession; authenticatorId?: string }> {
  const existing = devtools.get(page);
  if (existing) return existing;
  // La sesión queda abierta mientras viva la página: cerrarla borraría el autenticador.
  const session = await page.context().newCDPSession(page);
  await session.send("WebAuthn.enable", { enableUI: false });
  const created = { session };
  devtools.set(page, created);
  return created;
}

/**
 * Pone en `page` un autenticador virtual nuevo y vacío, como el del propio
 * dispositivo (huella o PIN, que siempre verifican al usuario), y devuelve su id. Si
 * la página ya tenía uno de antes, lo quita: nunca hay dos con la misma llave.
 */
export async function enableVirtualAuthenticator(page: Page): Promise<string> {
  const entry = await devtoolsFor(page);
  if (entry.authenticatorId) {
    await entry.session.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: entry.authenticatorId });
  }
  const { authenticatorId } = await entry.session.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  entry.authenticatorId = authenticatorId;
  return authenticatorId;
}

/** Carga en el autenticador la llave de prueba del slot `slot`, con su contador de `nextSignCount`. */
export async function injectTestPasskey(page: Page, authenticatorId: string, slot: number): Promise<void> {
  const passkey = testPasskey(slot);
  await addCredential(page, authenticatorId, {
    credentialId: Buffer.from(passkey.credentialId, "base64url").toString("base64"),
    isResidentCredential: true,
    rpId: TEST_RP_ID,
    privateKey: passkey.privateKeyPkcs8,
    userHandle: USER_HANDLE.toString("base64"),
    signCount: nextSignCount(slot),
  });
}

/** Las llaves que tiene el autenticador (con su contador actual): para guardar una y volver a cargarla en otro. */
export async function getCredentials(page: Page, authenticatorId: string): Promise<VirtualCredential[]> {
  const { session } = await devtoolsFor(page);
  const { credentials } = await session.send("WebAuthn.getCredentials", { authenticatorId });
  return credentials;
}

/** Carga una llave (por ejemplo, una guardada con `getCredentials`) en el autenticador. */
export async function addCredential(
  page: Page,
  authenticatorId: string,
  credential: VirtualCredential,
): Promise<void> {
  const { session } = await devtoolsFor(page);
  await session.send("WebAuthn.addCredential", { authenticatorId, credential });
}
