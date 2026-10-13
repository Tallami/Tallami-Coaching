// Genera los íconos de la web a partir de `src/app/icon.svg` (el monograma de la
// marca: una "T" y el punto dorado de "Tallami."). Es un script de una vez: se
// corre solo si cambia el SVG, y los resultados se suben al repo.
//
//   node scripts/build-icons.mjs
//
// - `src/app/apple-icon.png`: 180x180 sin transparencia. iOS redondea solo las
//   esquinas, así que el azul llega hasta los bordes (lo transparente de las
//   esquinas redondeadas del SVG se rellena con el mismo azul).
// - `src/app/favicon.ico`: 16, 32 y 48 px. Un `.ico` con PNGs adentro es válido.
//
// `src/app/icon.svg` lo usan tal cual los navegadores modernos. `sharp` ya
// viene con Next (lo usa para optimizar imágenes) y está en `devDependencies`.

import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const APP_DIR = new URL("../src/app/", import.meta.url);
/** Lado del `viewBox` del SVG: a 72 dpi, un SVG de 64 px mide 64 px. */
const SVG_SIDE = 64;
const SVG_DPI = 72;
/** Azul escenario (`--color-stage`): el fondo del ícono. */
const STAGE = "#0B1433";
const APPLE_ICON_SIZE = 180;
const ICO_SIZES = [16, 32, 48];
const ICO_HEADER_BYTES = 6;
const ICO_ENTRY_BYTES = 16;

/** El SVG dibujado a `size` x `size` px, con transparencia en las esquinas. */
function renderPng(svg, size) {
  // La densidad escala el dibujo vectorial: así sale nítido a cualquier tamaño.
  return sharp(svg, { density: (SVG_DPI * size) / SVG_SIDE })
    .resize(size, size)
    .png({ compressionLevel: 9 });
}

/** Arma un `.ico` con una imagen PNG por tamaño (formato ICONDIR + ICONDIRENTRY + PNG). */
function buildIco(frames) {
  const header = Buffer.alloc(ICO_HEADER_BYTES);
  header.writeUInt16LE(1, 2); // tipo: ícono
  header.writeUInt16LE(frames.length, 4);

  let offset = ICO_HEADER_BYTES + ICO_ENTRY_BYTES * frames.length;
  const entries = frames.map(({ size, png }) => {
    const entry = Buffer.alloc(ICO_ENTRY_BYTES);
    entry[0] = size; // ancho (0 significaría 256)
    entry[1] = size; // alto
    entry.writeUInt16LE(1, 4); // planos
    entry.writeUInt16LE(32, 6); // bits por píxel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...frames.map(({ png }) => png)]);
}

const svg = await readFile(new URL("icon.svg", APP_DIR));

const appleIcon = await renderPng(svg, APPLE_ICON_SIZE)
  .flatten({ background: STAGE })
  .toBuffer();
await writeFile(new URL("apple-icon.png", APP_DIR), appleIcon);

const frames = await Promise.all(
  ICO_SIZES.map(async (size) => ({
    size,
    png: await renderPng(svg, size).toBuffer(),
  })),
);
const ico = buildIco(frames);
await writeFile(new URL("favicon.ico", APP_DIR), ico);

console.log(
  `src/app/apple-icon.png (${appleIcon.length} bytes), src/app/favicon.ico (${ICO_SIZES.join(", ")} px; ${ico.length} bytes)`,
);
