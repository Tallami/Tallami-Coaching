// Contraseña del panel: hash con scrypt (`node:crypto`, sin dependencias).
//
// Formato guardado: `scrypt$N$r$p$saltBase64$hashBase64`. Los parámetros viajan
// dentro del texto, así que subir el costo más adelante no invalida los hashes
// anteriores: cada uno se verifica con los parámetros con que se creó.
//
// Parámetros (OWASP, "Password Storage Cheat Sheet", primera opción para scrypt):
//   N = 2^17 (costo de CPU y memoria; el bloque ocupa 128 MiB)
//   r = 8    (tamaño de bloque)
//   p = 1    (paralelismo)
//   sal de 16 bytes al azar y clave derivada de 32 bytes.
//
// Este archivo no importa nada del proyecto: lo cargan el script
// `npm run admin:password` y la configuración de Playwright.

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const SCRYPT_PARAMS = { N: 2 ** 17, r: 8, p: 1 } as const;

const SALT_BYTES = 16;
const KEY_BYTES = 32;

// Límites de lo que se acepta al leer un hash guardado: el valor sale de una
// variable de entorno (de confianza), pero un error de tipeo no debería
// agotar la memoria del servidor ni dejar la clave sin protección.
const MIN_COST = 2 ** 14;
const MAX_COST = 2 ** 18;
const MAX_BLOCK_SIZE = 16;
const MAX_PARALLELISM = 8;
const MAX_MEMORY_BYTES = 512 * 1024 * 1024;
const MIN_SALT_BYTES = 8;
const MIN_HASH_BYTES = 16;
const MAX_HASH_BYTES = 128;
/** scrypt tira error si la memoria que necesita (128·N·r) pasa de `maxmem`: se deja el doble de margen. */
const MEMORY_HEADROOM = 2;
const BYTES_PER_BLOCK = 128;

const DIGITS = /^\d+$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

export interface ParsedPasswordHash extends ScryptParams {
  salt: Buffer;
  hash: Buffer;
}

function isPowerOfTwo(value: number): boolean {
  return Number.isInteger(Math.log2(value));
}

function parseNumber(text: string | undefined): number {
  return text !== undefined && DIGITS.test(text) ? Number(text) : Number.NaN;
}

function parseBase64(text: string | undefined): Buffer | null {
  if (text === undefined || text.length % 4 !== 0 || !BASE64.test(text)) return null;
  return Buffer.from(text, "base64");
}

/**
 * Lee `scrypt$N$r$p$sal$hash`. `null` si no tiene ese formato o si los
 * parámetros están fuera de lo razonable. Nunca tira.
 */
export function parseStoredHash(stored: string): ParsedPasswordHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;

  const N = parseNumber(parts[1]);
  const r = parseNumber(parts[2]);
  const p = parseNumber(parts[3]);
  if (!(N >= MIN_COST && N <= MAX_COST && isPowerOfTwo(N))) return null;
  if (!(r >= 1 && r <= MAX_BLOCK_SIZE && p >= 1 && p <= MAX_PARALLELISM)) return null;
  if (BYTES_PER_BLOCK * N * r > MAX_MEMORY_BYTES) return null;

  const salt = parseBase64(parts[4]);
  const hash = parseBase64(parts[5]);
  if (!salt || salt.length < MIN_SALT_BYTES) return null;
  if (!hash || hash.length < MIN_HASH_BYTES || hash.length > MAX_HASH_BYTES) return null;

  return { N, r, p, salt, hash };
}

/**
 * Letras acentuadas escritas de una forma o de la otra (é entera o e + acento)
 * dan la misma clave: NFKC, como recomienda NIST SP 800-63B.
 */
function prepare(plain: string): string {
  return plain.normalize("NFKC");
}

function deriveKey(
  plain: string,
  salt: Buffer,
  keyLength: number,
  { N, r, p }: ScryptParams,
): Promise<Buffer> {
  const maxmem = MEMORY_HEADROOM * BYTES_PER_BLOCK * N * r;
  return new Promise((resolve, reject) => {
    scrypt(prepare(plain), salt, keyLength, { N, r, p, maxmem }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/** Hash de `plain` listo para guardar en `ADMIN_PASSWORD_HASH`. */
export async function hashPassword(plain: string): Promise<string> {
  if (plain.length === 0) {
    throw new RangeError("La contraseña no puede estar vacía.");
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = await deriveKey(plain, salt, KEY_BYTES, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return ["scrypt", N, r, p, salt.toString("base64"), hash.toString("base64")].join("$");
}

/**
 * ¿`plain` es la contraseña de `stored`? Compara en tiempo constante
 * (`timingSafeEqual`) y devuelve `false`, sin tirar, si `stored` no es un hash
 * válido.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;
  const derived = await deriveKey(plain, parsed.salt, parsed.hash.length, parsed);
  return derived.length === parsed.hash.length && timingSafeEqual(derived, parsed.hash);
}
