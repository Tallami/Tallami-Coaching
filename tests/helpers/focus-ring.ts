// Calidad de teclado de las pantallas del panel, compartida por los e2e de calidad
// (`admin-quality.spec.ts`, con los datos de ejemplo) y de seguridad
// (`admin-security.spec.ts`): un recorrido con Tab que mide que todo lo que se puede
// enfocar tenga un aro visible con contraste de al menos 3:1, y un Tab hasta un elemento.

import { expect, type Locator, type Page } from "@playwright/test";

/** Contraste mínimo de un indicador de foco contra lo que tiene detrás (WCAG 1.4.11). */
const MIN_FOCUS_CONTRAST = 3;
/** Grosor mínimo del aro de foco, en píxeles (WCAG 2.4.13). */
const MIN_FOCUS_WIDTH = 2;
/** Tope de Tab por página: sobra para la página más larga y corta un ciclo que no cierra. */
const MAX_TAB_PRESSES = 500;

/** Lo que mide el navegador del elemento con foco: su aro y el contraste con lo que tiene detrás. */
interface FocusReading {
  /** Identifica al elemento entre una pulsación y otra (el mismo elemento puede tener varias paradas). */
  seq: string;
  /** Para el mensaje de error: etiqueta y texto del elemento. */
  label: string;
  /**
   * El foco está en una parte interna del navegador (el botón del calendario de
   * un campo de fecha): el navegador le dibuja su propio aro, que no es del panel.
   */
  isNativeInnerControl: boolean;
  outlineStyle: string;
  outlineWidth: number;
  /** Contraste del aro contra el fondo de los ancestros (el aro se dibuja afuera del elemento). */
  contrast: number;
}

/**
 * Se ejecuta en el navegador. `null` si el foco está en la página misma (el
 * documento) y no en un elemento.
 */
function readFocusRing(): FocusReading | null {
  const element = document.activeElement as HTMLElement | null;
  if (!element || element === document.body || element === document.documentElement) return null;

  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("El navegador no dio un canvas para leer colores.");

  // Pasa cualquier sintaxis de color de CSS (`rgb()`, `color-mix()`, `oklab()`) a sRGB.
  const toRgba = (css: string): [number, number, number, number] => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = "#000";
    context.fillStyle = css;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
    return [red, green, blue, alpha / 255];
  };
  const luminance = ([red, green, blue]: readonly number[]) => {
    const [r, g, b] = [red, green, blue].map((channel) => {
      const unit = channel / 255;
      return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };

  // Lo que hay detrás del aro: el primer fondo opaco hacia arriba, con los translúcidos de por medio encima.
  const layers: [number, number, number, number][] = [];
  for (let node = element.parentElement; node; node = node.parentElement) {
    const layer = toRgba(getComputedStyle(node).backgroundColor);
    if (layer[3] === 0) continue;
    layers.push(layer);
    if (layer[3] === 1) break;
  }
  let backdrop: [number, number, number] = [255, 255, 255];
  for (const [red, green, blue, alpha] of layers.reverse()) {
    backdrop = [
      red * alpha + backdrop[0] * (1 - alpha),
      green * alpha + backdrop[1] * (1 - alpha),
      blue * alpha + backdrop[2] * (1 - alpha),
    ];
  }

  const style = getComputedStyle(element);
  const ring = toRgba(style.outlineColor);
  const [lighter, darker] = [luminance(ring), luminance(backdrop)].sort((a, b) => b - a);
  const text = (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().replace(/\s+/g, " ");
  const type = element.getAttribute("type");
  const name = element.getAttribute("name") ?? element.id;
  element.dataset.focusAuditSeq ??= String(document.querySelectorAll("[data-focus-audit-seq]").length);

  return {
    seq: element.dataset.focusAuditSeq,
    label: `<${element.tagName.toLowerCase()}${type ? ` type=${type}` : ""}${name ? ` name=${name}` : ""}> ${text.slice(0, 50)}`,
    isNativeInnerControl:
      ["date", "datetime-local", "month", "week", "time"].includes(type ?? "") && !element.matches(":focus-visible"),
    outlineStyle: style.outlineStyle,
    outlineWidth: parseFloat(style.outlineWidth),
    contrast: (lighter + 0.05) / (darker + 0.05),
  };
}

/**
 * Recorre la página con Tab hasta que el foco vuelve al primer elemento y
 * devuelve lo que no cumple: sin aro, aro fino o con poco contraste. Un Tab que
 * no cierra el ciclo (trampa de teclado) se corta en el tope y falla. Si no llega a
 * medir ningún elemento también falla: una revisión que no midió nada no prueba nada.
 */
export async function focusRingProblems(page: Page): Promise<string[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const problems: string[] = [];
  let firstSeq: string | null = null;
  let measured = 0;
  let closedCycle = false;

  for (let press = 0; press < MAX_TAB_PRESSES; press += 1) {
    await page.keyboard.press("Tab");
    const reading = await page.evaluate(readFocusRing);
    // Antes del primer elemento, un Tab que cae fuera de la página (la barra del navegador) no cierra nada: se sigue.
    if (reading === null && measured === 0) continue;
    if (reading === null || reading.seq === firstSeq) {
      closedCycle = true;
      break;
    }
    measured += 1;
    firstSeq ??= reading.seq;
    if (reading.isNativeInnerControl) continue;
    if (reading.outlineStyle === "none" || reading.outlineWidth < MIN_FOCUS_WIDTH) {
      problems.push(`${reading.label}: sin aro de foco visible (${reading.outlineStyle} ${reading.outlineWidth}px)`);
    } else if (reading.contrast < MIN_FOCUS_CONTRAST) {
      problems.push(`${reading.label}: el aro de foco contrasta ${reading.contrast.toFixed(2)}:1 (mínimo ${MIN_FOCUS_CONTRAST}:1)`);
    }
  }
  if (measured === 0) problems.push("Tab no llegó a ningún elemento: la revisión no midió nada");
  else if (!closedCycle) problems.push(`Tab no cierra el ciclo en ${MAX_TAB_PRESSES} pulsaciones: ¿trampa de teclado?`);
  return problems;
}

/** Tab hasta que el foco cae en `target`; falla si no llega en el tope. */
export async function tabTo(page: Page, target: Locator, maxPresses = 30): Promise<void> {
  for (let press = 0; press < maxPresses; press += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}
