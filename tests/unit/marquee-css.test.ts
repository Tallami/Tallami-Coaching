import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const CSS = readFileSync(
  fileURLToPath(
    new URL("../../src/components/motion/marquee.module.css", import.meta.url),
  ),
  "utf8",
);

type Rule = { selector: string; body: string };

/** Las reglas con su selector y su cuerpo, sin comentarios (las de dentro de `@media` también). */
function rulesOf(css: string): Rule[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }));
}

describe("marquee.module.css", () => {
  const rules = rulesOf(CSS);

  // Un navegador que no entiende `:has()` descarta toda la regla que lo nombra,
  // lista de selectores incluida: si la fila enfocada sacara su `mask-image` en
  // esa misma regla, el fundido le taparía el aro de foco.
  test("the focused row drops its fade in a rule of its own", () => {
    const own = rules.filter(({ selector }) => selector === ".row:focus-visible");

    expect(own.some(({ body }) => /mask-image:\s*none/.test(body))).toBe(true);
  });

  // El botón de pausa (WCAG 2.2.2) tiene que andar aunque el navegador no
  // entienda `:has()`: su regla no puede compartir lista con una que lo use.
  test("the pause button's rule does not depend on :has()", () => {
    const own = rules.filter(({ selector }) => selector === ".row[data-paused] .track");

    expect(own.some(({ body }) => /animation-play-state:\s*paused/.test(body))).toBe(true);
  });

  test("no rule shares its selector list with :has()", () => {
    for (const { selector } of rules) {
      if (selector.includes(":has(")) {
        expect(selector.split(","), selector).toHaveLength(1);
      }
    }
  });
});
