// Las dos ceremonias de WebAuthn con la librería SimpleWebAuthn: registrar una
// llave nueva y usar una registrada. Cada una tiene un lado que arma las opciones
// para el navegador y otro que verifica lo que el navegador contesta.
//
// - El `rpID` y el origen salen de `getWebAuthnConfig()`, nunca del pedido.
// - Siempre se exige verificar al usuario (huella, cara o PIN del dispositivo):
//   `userVerification: "required"` al pedir y `requireUserVerification: true` al
//   verificar. Sin atestación y sin restringir el tipo de autenticador (ni
//   `authenticatorAttachment`: una llave USB o el celular por Bluetooth también
//   sirven).
// - El desafío lo genera la librería y lo guarda quien llama (en la sesión o en el
//   ingreso a medio camino), de un solo uso. Acá solo se compara.
// - Las funciones de verificación no tiran: cualquier error de la librería (firma,
//   origen, desafío o contador malos) o una respuesta con forma inválida es `null`.
//   El motivo queda en el log, porque un origen mal configurado es la causa más
//   probable de que "no ande" y sin él no habría por dónde empezar.

import {
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { COSEALG, isoBase64URL } from "@simplewebauthn/server/helpers";
import type { Passkey } from "./passkeys";
import { getWebAuthnConfig } from "./webauthn-config";

/** Lo que se guarda de una llave recién registrada (el nombre lo pone quien llama). */
export type NewPasskeyData = {
  /** El id de la credencial, en base64url. */
  credentialId: string;
  /** La clave pública (COSE), en base64url. */
  publicKey: string;
  counter: number;
  transports: string[];
};

/** Hay un solo usuario: el mismo para todas las llaves, así el navegador no las trata como cuentas distintas. */
const USER_ID = new TextEncoder().encode("tallami-admin");
const USER_NAME = "Tallami";

/**
 * Los algoritmos de firma que se aceptan, los mismos al pedir y al verificar el
 * registro. Se fijan acá y no se deja la lista por defecto de la librería: desde
 * la versión 14 esa lista suma ML-DSA-44 (poscuántico) si el Node en uso lo
 * soporta, o sea que cambia con la versión de Node, y una llave registrada así
 * dejaría de verificarse si el servidor cambiara de versión. Estos tres cubren
 * los celulares, Windows Hello y las llaves USB.
 */
const SUPPORTED_ALGORITHM_IDS = [COSEALG.EdDSA, COSEALG.ES256, COSEALG.RS256];

/**
 * Los transportes que entiende el navegador (incluido `hybrid`: el celular por QR
 * y Bluetooth). Desde la versión 14 la librería los tipa como `string[]`, así que
 * esta lista es la que decide qué entra: se filtra al registrar (lo que manda el
 * navegador no llega a la columna `text[]` tal cual) y al armar las opciones.
 */
const KNOWN_TRANSPORTS: ReadonlySet<string> = new Set([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

function knownTransports(transports: string[]): string[] {
  return transports.filter((transport) => KNOWN_TRANSPORTS.has(transport));
}

function describeCredentials(passkeys: Passkey[]) {
  return passkeys.map((passkey) => ({
    id: passkey.credentialId,
    transports: knownTransports(passkey.transports),
  }));
}

/** La forma mínima de lo que contesta el navegador; la criptografía la valida la librería. */
type CredentialShape = { id: string; rawId: string; type: "public-key"; response: object };

function hasCredentialShape(value: unknown): value is CredentialShape {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.rawId === "string" &&
    candidate.type === "public-key" &&
    typeof candidate.response === "object" &&
    candidate.response !== null
  );
}

/** El id de la credencial que dice traer la respuesta del navegador, si tiene uno: para buscar con qué llave verificarla. */
export function credentialIdOf(response: unknown): string | null {
  if (typeof response !== "object" || response === null) return null;
  const { id } = response as { id?: unknown };
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** El motivo en una sola línea y corto: el mensaje de la librería repite texto que manda el navegador (origen, desafío). */
const MAX_LOGGED_REASON_LENGTH = 200;

function logRejection(ceremony: string, error: unknown): void {
  const reason = (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .slice(0, MAX_LOGGED_REASON_LENGTH);
  console.warn(`Llave de acceso: ${ceremony} rechazado. ${reason}`);
}

/** Las opciones para `navigator.credentials.create()`; `excludeCredentials` evita registrar dos veces el mismo dispositivo. */
export async function registrationOptions(existing: Passkey[]): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const { rpID, rpName } = getWebAuthnConfig();
  return generateRegistrationOptions({
    rpName,
    rpID,
    userName: USER_NAME,
    userDisplayName: USER_NAME,
    userID: USER_ID,
    attestationType: "none",
    excludeCredentials: describeCredentials(existing),
    authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
    supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
  });
}

/** Verifica el registro. `null` si algo no cierra; si cierra, lo que hay que guardar de la llave. */
export async function verifyRegistration(
  response: unknown,
  expectedChallenge: string,
): Promise<NewPasskeyData | null> {
  if (!hasCredentialShape(response)) return null;
  try {
    const { origin, rpID } = getWebAuthnConfig();
    const verification = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserPresence: true,
      requireUserVerification: true,
      supportedAlgorithmIDs: SUPPORTED_ALGORITHM_IDS,
    });
    if (!verification.verified) return null;
    const { credential } = verification.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: knownTransports(credential.transports ?? []),
    };
  } catch (error) {
    logRejection("registro", error);
    return null;
  }
}

/** Las opciones para `navigator.credentials.get()`: puede firmar cualquiera de las llaves registradas. */
export async function authenticationOptions(passkeys: Passkey[]): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const { rpID } = getWebAuthnConfig();
  return generateAuthenticationOptions({
    rpID,
    allowCredentials: describeCredentials(passkeys),
    userVerification: "required",
  });
}

/**
 * Verifica la firma de `passkey`. `null` si algo no cierra (desafío, origen,
 * firma, verificación del usuario, o un contador que no sube salvo que ambos
 * sean 0); si cierra, el contador que informó el dispositivo, para guardarlo con
 * `recordPasskeyUse`.
 */
export async function verifyAuthentication(
  response: unknown,
  expectedChallenge: string,
  passkey: Passkey,
): Promise<{ newCounter: number } | null> {
  if (!hasCredentialShape(response)) return null;
  // La librería verifica contra la clave que se le pasa; esto asegura que la
  // respuesta es de la credencial que se está comprobando y no de otra.
  if (response.id !== passkey.credentialId) return null;
  try {
    const { origin, rpID } = getWebAuthnConfig();
    const verification = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: passkey.credentialId,
        publicKey: isoBase64URL.toBuffer(passkey.publicKey),
        counter: passkey.counter,
        transports: knownTransports(passkey.transports),
      },
    });
    if (!verification.verified) return null;
    return { newCounter: verification.authenticationInfo.newCounter };
  } catch (error) {
    logRejection("ingreso", error);
    return null;
  }
}
