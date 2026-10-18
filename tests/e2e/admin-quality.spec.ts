// Calidad del panel de punta a punta: accesibilidad (axe), sin scroll
// horizontal de la página y navegación con teclado, en todas las pantallas, a
// 375, 768 y 1440 px. Corre con `playwright.demo.config.ts` (puerto 3101): con
// los datos de ejemplo las tablas y los gráficos existen, y una página vacía
// los esconde. La base es de solo lectura: nadie escribe en ella.
//
// El modelo son las verificaciones del sitio público (`quality.spec.ts`): los
// mismos tags de axe y el mismo criterio ("serious" o "critical" bloquea).

import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SetupChecklist } from "../../src/components/admin/setup-checklist";
import { expect, loginAsAdmin, test } from "../helpers/admin";
import { demoToday } from "../helpers/demo";

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];
const BLOCKING_IMPACTS = ["serious", "critical"];
const AXE_WIDTHS = [375, 1440] as const;
const SCROLL_WIDTHS = [375, 768, 1440] as const;
const VIEWPORT_HEIGHT = 900;
const PHONE_WIDTH = 375;
const DESKTOP_WIDTH = 1440;
/** Contraste mínimo de un indicador de foco contra lo que tiene detrás (WCAG 1.4.11). */
const MIN_FOCUS_CONTRAST = 3;
/** Grosor mínimo del aro de foco, en píxeles (WCAG 2.4.13). */
const MIN_FOCUS_WIDTH = 2;
/** Tope de Tab por página: sobra para la página más larga y corta un ciclo que no cierra. */
const MAX_TAB_PRESSES = 500;

const { data } = demoToday();
/** Una venta con factura emitida (la ficha muestra el panel de la factura) y una que todavía se puede facturar. */
const issuedSale = data.sales.find((sale) => sale.invoiceStatus === "issued");
const pendingSale = data.sales.find((sale) => sale.invoiceStatus === "pending" && sale.status === "paid");
const student = data.customers[0];

interface PanelPage {
  name: string;
  path: string;
  /** El `h1` con que se reconoce que la página terminó de armarse. */
  heading: string;
}

function requireDemo<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Los datos de ejemplo no tienen ${what}.`);
  return value;
}

/** Las pantallas del panel que se abren con sesión. */
const PANEL_PAGES: readonly PanelPage[] = [
  { name: "Resumen", path: "/admin", heading: "Resumen" },
  { name: "Ventas", path: "/admin/ventas", heading: "Ventas" },
  { name: "Nueva venta", path: "/admin/ventas/nueva", heading: "Nueva venta" },
  {
    name: "Ficha de una venta facturada",
    path: `/admin/ventas/${requireDemo(issuedSale, "una venta facturada").id}`,
    heading: "Editar venta",
  },
  {
    name: "Ficha de una venta por facturar",
    path: `/admin/ventas/${requireDemo(pendingSale, "una venta cobrada sin facturar").id}`,
    heading: "Editar venta",
  },
  { name: "Alumnos", path: "/admin/alumnos", heading: "Alumnos" },
  { name: "Ficha de un alumno", path: `/admin/alumnos/${requireDemo(student, "alumnos").id}`, heading: student.name },
  { name: "Servicios", path: "/admin/servicios", heading: "Servicios" },
  { name: "Facturación", path: "/admin/facturacion", heading: "Facturación" },
  { name: "Configuración", path: "/admin/configuracion", heading: "Configuración" },
];

async function openPanelPage(page: Page, target: PanelPage, width: number): Promise<void> {
  await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
  await page.goto(target.path);
  await expect(page.getByRole("heading", { name: target.heading, level: 1 })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

/** Violaciones serias o críticas de axe en la página abierta. */
async function blockingViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();

  return results.violations
    .filter(({ impact }) => impact && BLOCKING_IMPACTS.includes(impact))
    .map(({ id, impact, help, nodes }) => ({
      id,
      impact,
      help,
      targets: nodes.map(({ target }) => target),
    }));
}

/** Cuánto sobra de ancho: positivo = la página se puede desplazar hacia los costados. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

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
  const text = (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().replace(/s+/g, " ");
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
 * no cierra el ciclo (trampa de teclado) se corta en el tope y falla.
 */
async function focusRingProblems(page: Page): Promise<string[]> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const problems: string[] = [];
  let firstSeq: string | null = null;
  let closedCycle = false;

  for (let press = 0; press < MAX_TAB_PRESSES; press += 1) {
    await page.keyboard.press("Tab");
    const reading = await page.evaluate(readFocusRing);
    if (reading === null || (press > 0 && reading.seq === firstSeq)) {
      closedCycle = true;
      break;
    }
    firstSeq ??= reading.seq;
    if (reading.isNativeInnerControl) continue;
    if (reading.outlineStyle === "none" || reading.outlineWidth < MIN_FOCUS_WIDTH) {
      problems.push(`${reading.label}: sin aro de foco visible (${reading.outlineStyle} ${reading.outlineWidth}px)`);
    } else if (reading.contrast < MIN_FOCUS_CONTRAST) {
      problems.push(`${reading.label}: el aro de foco contrasta ${reading.contrast.toFixed(2)}:1 (mínimo ${MIN_FOCUS_CONTRAST}:1)`);
    }
  }
  if (!closedCycle) problems.push(`Tab no cierra el ciclo en ${MAX_TAB_PRESSES} pulsaciones: ¿trampa de teclado?`);
  return problems;
}

/** El nombre accesible del elemento con foco. */
async function focusedName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return (active?.getAttribute("aria-label") ?? active?.textContent ?? "").trim().replace(/\s+/g, " ");
  });
}

/** Tab hasta que el foco cae en `target`; falla si no llega en el tope. */
async function tabTo(page: Page, target: Locator, maxPresses = 30): Promise<void> {
  for (let press = 0; press < maxPresses; press += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test.describe("panel accessibility with the demo data", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  for (const target of PANEL_PAGES) {
    test(`no serious or critical axe violations on ${target.name}`, async ({ page }) => {
      for (const width of AXE_WIDTHS) {
        await openPanelPage(page, target, width);
        expect(await blockingViolations(page), `${target.path} a ${width}px`).toEqual([]);
      }
    });
  }

  test("the overview has no serious or critical axe violations with the pending list open", async ({ page }) => {
    await openPanelPage(page, PANEL_PAGES[0], PHONE_WIDTH);
    for (const summary of await page.locator("main details > summary").all()) await summary.click();

    expect(await blockingViolations(page)).toEqual([]);
  });
});

test.describe("panel pages without a session", () => {
  for (const width of AXE_WIDTHS) {
    test(`login has no serious or critical axe violations at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await page.goto("/admin/login");
      await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();

      expect(await blockingViolations(page)).toEqual([]);
    });

    // Con el panel configurado `/admin/setup` manda al login: la lista se arma
    // con el mismo componente y se pone en la página real, con sus estilos.
    test(`setup has no serious or critical axe violations at ${width}px`, async ({ page }) => {
      const markup = renderToStaticMarkup(
        createElement(SetupChecklist, {
          items: [
            { name: "ADMIN_PASSWORD_HASH", problem: "missing" },
            { name: "ADMIN_SESSION_SECRET", problem: "too-short" },
            { name: "DATABASE_URL", problem: "invalid" },
          ],
        }),
      );
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await page.goto("/admin/login");
      await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();
      await page.evaluate((html) => {
        document.body.innerHTML = html;
      }, markup);
      await expect(page.getByRole("heading", { name: "Falta configurar el panel", level: 1 })).toBeVisible();

      expect(await blockingViolations(page)).toEqual([]);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  for (const width of SCROLL_WIDTHS) {
    test(`login has no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
      await page.goto("/admin/login");
      await expect(page.getByRole("button", { name: "Ingresar" })).toBeVisible();

      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }
});

test.describe("panel has no horizontal page scroll", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  for (const target of PANEL_PAGES) {
    test(`${target.name} at 375, 768 and 1440 px`, async ({ page }) => {
      for (const width of SCROLL_WIDTHS) {
        await openPanelPage(page, target, width);
        expect(await horizontalOverflow(page), `${target.path} a ${width}px`).toBeLessThanOrEqual(0);
      }
    });
  }

  test("a wide table scrolls inside its own box, never the page", async ({ page }) => {
    await openPanelPage(page, PANEL_PAGES[1], PHONE_WIDTH);

    const region = page.getByRole("region", { name: "Ventas" });
    const sizes = await region.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));

    expect(sizes.scrollWidth).toBeGreaterThan(sizes.clientWidth);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});

test.describe("panel keyboard", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("Tab walks the sidebar in order at 1440 px", async ({ page }) => {
    await openPanelPage(page, PANEL_PAGES[0], DESKTOP_WIDTH);

    const order = [
      "Saltar al contenido",
      "Tallami, panel de administración",
      "Resumen",
      "Ventas",
      "Servicios",
      "Alumnos",
      "Facturación",
      "Configuración",
      "Salir",
    ];
    const reached: string[] = [];
    for (let index = 0; index < order.length; index += 1) {
      await page.keyboard.press("Tab");
      reached.push(await focusedName(page));
    }

    expect(reached).toEqual(order);
    // La página actual queda marcada para quien no ve el color.
    await expect(page.getByRole("link", { name: "Resumen" })).toHaveAttribute("aria-current", "page");
  });

  test("the skip link moves focus past the sidebar to the content", async ({ page }) => {
    await openPanelPage(page, PANEL_PAGES[1], DESKTOP_WIDTH);

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#contenido$/);
    await page.keyboard.press("Tab");
    // El próximo Tab cae en el contenido, no de vuelta en la barra lateral.
    expect(await page.evaluate(() => document.activeElement?.closest("aside") === null)).toBe(true);
  });

  for (const key of ["Enter", "Space"] as const) {
    test(`the phone menu opens with ${key}, Escape closes it and gives focus back to the button`, async ({ page }) => {
      await openPanelPage(page, PANEL_PAGES[0], PHONE_WIDTH);

      const toggle = page.getByRole("button", { name: "Menú" });
      const nav = page.getByRole("navigation", { name: "Secciones del panel" });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(nav).toBeHidden();

      await tabTo(page, toggle);
      await page.keyboard.press(key);
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(nav).toBeVisible();

      // Con el menú abierto, Tab entra a las secciones.
      await page.keyboard.press("Tab");
      await expect(nav.getByRole("link", { name: "Resumen" })).toBeFocused();

      await page.keyboard.press("Escape");
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(nav).toBeHidden();
      await expect(toggle).toBeFocused();
    });
  }

  test("the phone menu closes after choosing a section and the next page starts closed", async ({ page }) => {
    await openPanelPage(page, PANEL_PAGES[0], PHONE_WIDTH);

    await page.getByRole("button", { name: "Menú" }).click();
    await page.getByRole("navigation", { name: "Secciones del panel" }).getByRole("link", { name: "Ventas" }).click();

    await expect(page).toHaveURL(/\/admin\/ventas$/);
    await expect(page.getByRole("button", { name: "Menú" })).toHaveAttribute("aria-expanded", "false");
  });

  test("the focus style exists and is not removed without a replacement", async ({ page }) => {
    await openPanelPage(page, PANEL_PAGES[0], DESKTOP_WIDTH);

    const hasFocusVisibleRule = await page.evaluate(() =>
      [...document.styleSheets].some((sheet) => {
        try {
          return [...sheet.cssRules].some((rule) => JSON.stringify(rule.cssText).includes(":focus-visible"));
        } catch {
          return false;
        }
      }),
    );

    expect(hasFocusVisibleRule).toBe(true);
  });

  for (const [name, width] of [
    ["1440", DESKTOP_WIDTH],
    ["375", PHONE_WIDTH],
  ] as const) {
    for (const target of PANEL_PAGES.filter((candidate) =>
      ["Resumen", "Ventas", "Nueva venta", "Facturación", "Configuración", "Ficha de un alumno"].includes(candidate.name),
    )) {
      test(`every focusable element of ${target.name} shows a focus ring at ${name}px`, async ({ page }) => {
        await openPanelPage(page, target, width);
        if (width === PHONE_WIDTH) {
          // Con el menú cerrado sus enlaces no se pueden enfocar: se revisa la página con él abierto.
          await page.getByRole("button", { name: "Menú" }).click();
        }

        expect(await focusRingProblems(page)).toEqual([]);
      });
    }
  }
});
