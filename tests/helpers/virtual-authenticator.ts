// Un autenticador de mentira para los tests unitarios: una llave de acceso (ES256)
// que registra y firma como lo haría un dispositivo, con criptografía de verdad,
// para pasar por la librería sin simularla. Así los tests de `ceremonies.ts`
// prueban de punta a punta lo que de otro modo solo se vería en el navegador: que
// la clave pública sobrevive a guardarse como texto y que un desafío, un origen,
// un contador o una verificación de usuario incorrectos se rechazan.
//
// Es solo para tests: no hay manera de que llegue al código de producción.

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from "@simplewebauthn/server";

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_ATTESTED_CREDENTIAL_DATA = 0x40;

const CBOR_BYTES = 2;
const CBOR_TEXT = 3;

/** Encabezado CBOR de un valor de `length` bytes (alcanza para valores de hasta 65535). */
function cborHead(majorType: number, length: number): Buffer {
  const type = majorType << 5;
  if (length < 24) return Buffer.from([type | length]);
  if (length < 256) return Buffer.from([type | 24, length]);
  return Buffer.from([type | 25, length >> 8, length & 0xff]);
}

function cborText(text: string): Buffer {
  return Buffer.concat([cborHead(CBOR_TEXT, text.length), Buffer.from(text)]);
}

function cborBytes(bytes: Buffer): Buffer {
  return Buffer.concat([cborHead(CBOR_BYTES, bytes.length), bytes]);
}

/** La clave pública en COSE (EC2, ES256, P-256), como la guarda un autenticador. */
export function coseKey(x: Buffer, y: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0xa5]), // mapa de 5 pares
    Buffer.from([0x01, 0x02]), // kty: EC2
    Buffer.from([0x03, 0x26]), // alg: ES256 (-7)
    Buffer.from([0x20, 0x01]), // crv: P-256
    Buffer.from([0x21]),
    cborBytes(x),
    Buffer.from([0x22]),
    cborBytes(y),
  ]);
}

/** El objeto de atestación sin atestación (`fmt: "none"`). */
function attestationObject(authData: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0xa3]), // mapa de 3 pares
    cborText("fmt"),
    cborText("none"),
    cborText("attStmt"),
    Buffer.from([0xa0]), // mapa vacío
    cborText("authData"),
    cborBytes(authData),
  ]);
}

function sha256(data: Buffer | string): Buffer {
  return createHash("sha256").update(data).digest();
}

function counterBytes(counter: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32BE(counter);
  return bytes;
}

type CeremonyOptions = {
  /** Origen desde el que "actúa" el navegador; por defecto el esperado. */
  origin?: string;
  /** Si el dispositivo verificó al usuario (huella, PIN); por defecto sí. */
  userVerified?: boolean;
  /** El sitio (`rpID`) para el que firma el dispositivo; por defecto el esperado. Otro es una llave de otro sitio. */
  rpID?: string;
};

export type VirtualAuthenticator = {
  /** El id de la credencial, en base64url. */
  credentialId: string;
  register(
    options: PublicKeyCredentialCreationOptionsJSON,
    ceremony?: CeremonyOptions & {
      /** Lo que el navegador dice del transporte de la llave; por defecto `["internal"]`. */
      transports?: string[];
    },
  ): RegistrationResponseJSON;
  authenticate(
    options: PublicKeyCredentialRequestOptionsJSON,
    ceremony: CeremonyOptions & { counter: number },
  ): AuthenticationResponseJSON;
};

/** Una llave ya hecha: la clave privada P-256 en PKCS#8 (base64) y el id de la credencial (base64url). */
export type FixedKey = { privateKeyPkcs8: string; credentialId: string };

/**
 * Un dispositivo que se comporta bien en el sitio `site`, con una llave nueva o, con
 * `fixedKey`, con esa (por ejemplo, una de las llaves de prueba de los e2e).
 */
export function createVirtualAuthenticator(
  site: { rpID: string; origin: string },
  fixedKey?: FixedKey,
): VirtualAuthenticator {
  const privateKey = fixedKey
    ? createPrivateKey({ key: Buffer.from(fixedKey.privateKeyPkcs8, "base64"), format: "der", type: "pkcs8" })
    : generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey;
  const { x, y } = createPublicKey(privateKey).export({ format: "jwk" });
  const credentialId = fixedKey ? Buffer.from(fixedKey.credentialId, "base64url") : randomBytes(16);
  const rpIdHashFor = (rpID: string) => sha256(rpID);

  const flags = (userVerified: boolean, extra = 0) =>
    FLAG_USER_PRESENT | (userVerified ? FLAG_USER_VERIFIED : 0) | extra;

  const clientDataJSON = (type: string, challenge: string, origin: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));

  return {
    credentialId: credentialId.toString("base64url"),

    register(options, { origin = site.origin, userVerified = true, rpID = site.rpID, transports = ["internal"] } = {}) {
      const authData = Buffer.concat([
        rpIdHashFor(rpID),
        Buffer.from([flags(userVerified, FLAG_ATTESTED_CREDENTIAL_DATA)]),
        counterBytes(0),
        Buffer.alloc(16), // aaguid
        Buffer.from([0, credentialId.length]),
        credentialId,
        coseKey(Buffer.from(x as string, "base64url"), Buffer.from(y as string, "base64url")),
      ]);
      return {
        id: credentialId.toString("base64url"),
        rawId: credentialId.toString("base64url"),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientDataJSON("webauthn.create", options.challenge, origin).toString("base64url"),
          attestationObject: attestationObject(authData).toString("base64url"),
          transports,
        },
      };
    },

    authenticate(options, { counter, origin = site.origin, userVerified = true, rpID = site.rpID }) {
      const authData = Buffer.concat([rpIdHashFor(rpID), Buffer.from([flags(userVerified)]), counterBytes(counter)]);
      const clientData = clientDataJSON("webauthn.get", options.challenge, origin);
      const signature = sign("sha256", Buffer.concat([authData, sha256(clientData)]), privateKey);
      return {
        id: credentialId.toString("base64url"),
        rawId: credentialId.toString("base64url"),
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: clientData.toString("base64url"),
          authenticatorData: authData.toString("base64url"),
          signature: signature.toString("base64url"),
        },
      };
    },
  };
}
