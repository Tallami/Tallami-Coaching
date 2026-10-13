import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { beforeAll, describe, expect, test } from "vitest";

const APP_DIR = fileURLToPath(new URL("../../src/app/", import.meta.url));

/** Colores de la marca (`src/app/globals.css`): fondo escenario, texto y punto del encabezado. */
const STAGE = [0x0b, 0x14, 0x33] as const;
const ON_STAGE = [0xf3, 0xf5, 0xfa] as const;
const GOLD = [0xff, 0xc9, 0x3c] as const;
/** Lo que el antialiasing puede correr un canal en una mezcla exacta del color. */
const COLOR_TOLERANCE = 6;
/** Con `rx = 18 %` del lado, las esquinas se redondean con ese radio. */
const CORNER_RADIUS_RATIO = 0.18;
const ICO_SIZES = [16, 32, 48];
/** A 16 px la punta de la esquina todavía cubre un 4 % del píxel: casi transparente. */
const CORNER_MAX_ALPHA = 64;
const PNG_SIGNATURE = "89504e470d0a1a0a";

type Rgba = readonly [number, number, number, number];

function read(name: string): Buffer {
  return readFileSync(`${APP_DIR}${name}`);
}

/** Píxeles RGBA de una imagen, de izquierda a derecha y de arriba abajo. */
async function pixelsOf(image: Buffer) {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number): Rgba => {
    const offset = (y * info.width + x) * 4;
    return [data[offset], data[offset + 1], data[offset + 2], data[offset + 3]];
  };
  return { width: info.width, height: info.height, at };
}

function isColor(pixel: Rgba, color: readonly number[]): boolean {
  return (
    pixel[3] === 255 &&
    color.every((channel, index) => Math.abs(pixel[index] - channel) <= COLOR_TOLERANCE)
  );
}

/** Los frames del `.ico`: tamaño declarado y los bytes de la imagen. */
function icoFrames(ico: Buffer) {
  const count = ico.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const entry = 6 + index * 16;
    const offset = ico.readUInt32LE(entry + 12);
    const size = ico.readUInt32LE(entry + 8);
    return {
      width: ico[entry] || 256,
      height: ico[entry + 1] || 256,
      image: ico.subarray(offset, offset + size),
    };
  });
}

/** Centro de los píxeles de un color: dónde está cada parte del monograma. */
async function centroidOf(image: Buffer, color: readonly number[]) {
  const { width, height, at } = await pixelsOf(image);
  let sumX = 0;
  let sumY = 0;
  let total = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (isColor(at(x, y), color)) {
        sumX += x / width;
        sumY += y / height;
        total += 1;
      }
    }
  }
  return { total, x: sumX / total, y: sumY / total };
}

describe("icon.svg", () => {
  let svg = "";

  beforeAll(() => {
    svg = read("icon.svg").toString("utf8");
  });

  test("is a rounded square in the stage blue, with the brand colors", () => {
    expect(svg).toMatch(/viewBox="0 0 (\d+) \1"/);
    expect(svg.toLowerCase()).toContain("#0b1433");
    expect(svg.toLowerCase()).toContain("#f3f5fa");
    expect(svg.toLowerCase()).toContain("#ffc93c");

    const side = Number(/viewBox="0 0 (\d+(?:\.\d+)?) /.exec(svg)?.[1]);
    const radius = Number(/\brx="(\d+(?:\.\d+)?)"/.exec(svg)?.[1]);
    expect(radius / side).toBeCloseTo(CORNER_RADIUS_RATIO, 2);
  });

  test("is drawn with shapes: no fonts, text or embedded images", () => {
    expect(svg).not.toMatch(/<text|font-family|<image|<style|<script/i);
  });
});

describe("favicon.ico", () => {
  let ico: Buffer;
  let frames: ReturnType<typeof icoFrames> = [];

  beforeAll(() => {
    ico = read("favicon.ico");
    frames = icoFrames(ico);
  });

  test("is an icon file with the 16, 32 and 48 px frames", () => {
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(frames.map(({ width }) => width).sort((a, b) => a - b)).toEqual(ICO_SIZES);
  });

  test("each frame is an embedded PNG of the size it declares", async () => {
    for (const { width, height, image } of frames) {
      expect(image.subarray(0, 8).toString("hex"), `${width} px`).toBe(PNG_SIGNATURE);
      const meta = await sharp(image).metadata();
      expect([meta.width, meta.height], `${width} px`).toEqual([width, height]);
    }
  });

  test("each frame is the monogram: rounded corners, blue, light T and gold dot to its lower right", async () => {
    for (const { width, image } of frames) {
      const { at } = await pixelsOf(image);

      // Esquinas redondeadas: la punta de la esquina queda (casi) transparente y el medio del borde no.
      expect(at(0, 0)[3], `${width} px`).toBeLessThan(CORNER_MAX_ALPHA);
      expect(at(width - 1, width - 1)[3], `${width} px`).toBeLessThan(CORNER_MAX_ALPHA);
      expect(at(Math.floor(width / 2), 0)[3], `${width} px`).toBe(255);
      // Abajo al centro, bajo la T: el azul escenario.
      expect(isColor(at(Math.floor(width / 2), width - 2), STAGE), `${width} px`).toBe(true);

      const light = await centroidOf(image, ON_STAGE);
      const gold = await centroidOf(image, GOLD);
      expect(light.total, `${width} px`).toBeGreaterThan(0);
      expect(gold.total, `${width} px`).toBeGreaterThan(0);
      expect(gold.x, `${width} px`).toBeGreaterThan(light.x);
      expect(gold.y, `${width} px`).toBeGreaterThan(light.y);
    }
  });
});

describe("apple-icon.png", () => {
  let png: Buffer;

  beforeAll(() => {
    png = read("apple-icon.png");
  });

  test("is 180x180 with no transparency", async () => {
    const meta = await sharp(png).metadata();

    expect(png.subarray(0, 8).toString("hex")).toBe(PNG_SIGNATURE);
    expect([meta.width, meta.height]).toEqual([180, 180]);
    // iOS rellena de negro lo transparente: el fondo azul tiene que llegar a los bordes.
    expect(meta.hasAlpha).toBe(false);
  });

  test("is blue from edge to edge, with the light T and the gold dot", async () => {
    const { width, height, at } = await pixelsOf(png);

    for (const [x, y] of [
      [0, 0],
      [width - 1, 0],
      [0, height - 1],
      [width - 1, height - 1],
    ]) {
      expect(isColor(at(x, y), STAGE), `esquina ${x},${y}`).toBe(true);
    }

    const light = await centroidOf(png, ON_STAGE);
    const gold = await centroidOf(png, GOLD);
    expect(light.total).toBeGreaterThan(0);
    expect(gold.total).toBeGreaterThan(0);
    expect(gold.x).toBeGreaterThan(light.x);
    expect(gold.y).toBeGreaterThan(light.y);
  });
});
