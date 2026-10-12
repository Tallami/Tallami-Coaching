// Baja la foto de perfil de X de un jugador desde unavatar.io y la guarda en
// `src/assets/players/<usuario en minúsculas>.jpg`, lista para importarla en
// `src/content/players.ts`. Se corre una vez por jugador nuevo:
//
//   npm run players:photo -- <usuario de X>
//
// `fallback=false`: si unavatar no encuentra la foto responde 404 en lugar de
// devolver su avatar genérico, que se guardaría como si fuera del jugador.
// unavatar entrega la foto en el formato en que la subió el jugador (algunas
// son PNG): lo que no sea JPEG se convierte con `sharp`, que ya viene con Next.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Usuarios de X: letras, números y guion bajo, hasta 15 caracteres. */
const HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
const TIMEOUT_MS = 20_000;
const JPEG_QUALITY = 88;
/** Fondo del escenario (`--color-stage`) para las fotos PNG con transparencia. */
const STAGE_COLOR = "#0b1433";
const OUTPUT_DIR = fileURLToPath(
  new URL("../src/assets/players/", import.meta.url),
);

/** Primeros bytes de cada formato de imagen que puede devolver unavatar. */
const SIGNATURES = {
  jpeg: [[0, [0xff, 0xd8, 0xff]]],
  png: [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]],
  gif: [[0, [0x47, 0x49, 0x46, 0x38]]],
  // "RIFF" al principio y "WEBP" en el byte 8.
  webp: [
    [0, [0x52, 0x49, 0x46, 0x46]],
    [8, [0x57, 0x45, 0x42, 0x50]],
  ],
};

/** Error esperado: se muestra el mensaje solo, sin la traza. */
class PhotoError extends Error {}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** Formato según los primeros bytes, o `null` si no es una imagen conocida. */
function detectFormat(bytes) {
  const match = Object.entries(SIGNATURES).find(([, parts]) =>
    parts.every(([offset, signature]) =>
      signature.every((byte, index) => bytes[offset + index] === byte),
    ),
  );
  return match ? match[0] : null;
}

async function convertToJpeg(bytes, format) {
  let sharp;
  try {
    ({ default: sharp } = await import("sharp"));
  } catch {
    throw new PhotoError(
      `la foto es ${format} y no se encontró "sharp" para pasarla a JPEG. Corré "npm install" o convertila a mano.`,
    );
  }

  try {
    return await sharp(bytes)
      .flatten({ background: STAGE_COLOR })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    throw new PhotoError(
      `no se pudo convertir la foto ${format} a JPEG: ${errorMessage(error)}`,
    );
  }
}

async function download(url, handle) {
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    throw new PhotoError(`no se pudo bajar ${url}: ${errorMessage(error)}`);
  }

  if (!response.ok) {
    await response.body?.cancel();
    throw new PhotoError(
      `${url} respondió ${response.status}. ¿Existe @${handle} en X y tiene foto?`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const bytes = new Uint8Array(await response.arrayBuffer());
  const format = detectFormat(bytes);

  if (!contentType.startsWith("image/") || !format) {
    throw new PhotoError(
      `${url} no devolvió una imagen (content-type: ${contentType || "vacío"}). No se guardó nada.`,
    );
  }

  return { bytes, format };
}

async function main(handle) {
  if (!handle || !HANDLE_PATTERN.test(handle)) {
    throw new PhotoError(
      "uso: npm run players:photo -- <usuario de X> (letras, números y _, hasta 15 caracteres).",
    );
  }

  const url = `https://unavatar.io/x/${handle}?fallback=false`;
  const { bytes, format } = await download(url, handle);
  const jpeg = format === "jpeg" ? bytes : await convertToJpeg(bytes, format);
  const file = path.join(OUTPUT_DIR, `${handle.toLowerCase()}.jpg`);

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(file, jpeg);

  const converted = format === "jpeg" ? "" : `, convertida desde ${format}`;
  console.log(
    `Guardada ${path.relative(process.cwd(), file)} (${jpeg.length} bytes${converted}).`,
  );
}

// `exitCode` en lugar de `process.exit()`: en Windows, salir con un socket de
// `fetch` todavía abierto hace fallar a Node con un assert de libuv.
try {
  await main(process.argv[2]);
} catch (error) {
  console.error(
    `fetch-player-photo: ${error instanceof PhotoError ? error.message : (error?.stack ?? error)}`,
  );
  process.exitCode = 1;
}
