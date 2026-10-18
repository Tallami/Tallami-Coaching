import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { BarChart, type BarDatum } from "@/admin/charts/bar-chart";
import { DeltaBadge } from "@/admin/charts/delta-badge";
import { HBarChart, type HBarRow } from "@/admin/charts/hbar-chart";
import { Meter, type MeterTone } from "@/admin/charts/meter";
import { MiniBars, type MiniBar } from "@/admin/charts/mini-bars";

function html(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(element);
}

const MONTHS: BarDatum[] = [
  { key: "2026-08", axisLabel: "ago", name: "agosto de 2026", value: 100_000, valueText: "USD 1.000,00" },
  { key: "2026-09", axisLabel: "sep", name: "septiembre de 2026", value: 0, valueText: "USD 0,00" },
  {
    key: "2026-10",
    axisLabel: "oct",
    yearLabel: "2026",
    name: "octubre de 2026",
    value: 50_000,
    valueText: "USD 500,00",
    shortText: "USD 500",
    isPartial: true,
  },
];

function barChart(data: BarDatum[] = MONTHS): string {
  return html(
    createElement(BarChart, {
      id: "demo",
      title: "Ingresos por mes",
      description: "Tres meses de ejemplo.",
      data,
      formatTick: (minor: number) => String(minor / 100),
      unitLabel: "USD",
      partialNote: "mes en curso, parcial",
      table: { summary: "Ver la tabla", caption: "Ingresos", headers: ["Mes", "Ingresos"] },
    }),
  );
}

/**
 * El alto dibujado de cada barra de un grupo `data-testid`: el del rectángulo
 * más alto del grupo que no es el de fondo transparente (una barra con plata son
 * dos rectángulos, la punta redonda y la base recta).
 */
function drawnHeights(markup: string, testId: string): number[] {
  const groups = new RegExp(String.raw`<g [^>]*data-testid="${testId}"[^>]*>([\s\S]*?)</g>`, "g");
  return [...markup.matchAll(groups)].map(([, body]) => {
    const heights = [...body.matchAll(/<rect [^>]*?height="([\d.]+)"[^>]*?class="([^"]*)"/g)]
      .filter(([, , classes]) => !classes.includes("fill-transparent"))
      .map(([, height]) => Number(height));
    return Math.max(...heights);
  });
}

describe("BarChart", () => {
  test("has a title and a description, and one named bar per datum", () => {
    const markup = barChart();

    expect(markup).toContain('<title id="demo-title">Ingresos por mes</title>');
    expect(markup).toContain('<desc id="demo-desc">Tres meses de ejemplo.</desc>');
    expect(markup).toContain('aria-labelledby="demo-title"');
    expect(markup).toContain('aria-describedby="demo-desc"');
    expect(markup.match(/data-testid="bar"/g)).toHaveLength(3);
    expect(markup).toContain('aria-label="agosto de 2026: USD 1.000,00"');
    expect(markup).toContain('aria-label="octubre de 2026: USD 500,00 (mes en curso, parcial)"');
  });

  test("the scale rounds up to a clean number and every gridline is labelled", () => {
    const markup = barChart();
    // 1.000 dólares: pasos de 200 hasta 1.000.
    for (const tick of ["0", "200", "400", "600", "800", "1000"]) {
      expect(markup).toContain(`>${tick}</text>`);
    }
  });

  test("draws a rounded end on a square base, and a stub for a month without income", () => {
    const markup = barChart();
    expect(markup).toContain('rx="4"');
    // Agosto, septiembre (el tope, el hueco) y octubre: dos rectángulos por barra con plata y uno chico sin ella.
    const stubs = markup.match(/height="2"/g) ?? [];
    expect(stubs).toHaveLength(1);
  });

  test("only the highest bar carries its number all the time; the rest show it on hover", () => {
    const markup = barChart();
    const labels = [...markup.matchAll(/<text[^>]*class="([^"]*font-bold[^"]*tabular-nums[^"]*)"[^>]*>([^<]+)<\/text>/g)];

    const visible = labels.filter(([, classes]) => !classes.includes("opacity-0"));
    expect(visible.map(([, , text]) => text)).toEqual(["USD 1.000,00"]);
    // La parcial usa el valor corto.
    expect(labels.map(([, , text]) => text)).toContain("USD 500");
  });

  test("each bar is as tall as its value against the top of the scale", () => {
    // La escala llega a 1.000 dólares sobre 200 px: 1.000 → 200 px; 500 → 100 px;
    // un mes sin plata deja solo la marca de 2 px.
    expect(drawnHeights(barChart(), "bar")).toEqual([200, 2, 100]);
  });

  test("bar heights keep the proportion between values", () => {
    const data: BarDatum[] = [10_000, 20_000, 40_000].map((value, index) => ({
      key: `2026-0${index + 1}`,
      axisLabel: "m",
      name: `mes ${index + 1}`,
      value,
      valueText: `USD ${value / 100}`,
    }));
    const [small, medium, large] = drawnHeights(barChart(data), "bar");

    expect(medium).toBe(small * 2);
    expect(large).toBe(small * 4);
  });

  test("a partial month is drawn lighter than the complete ones", () => {
    const markup = barChart();
    expect(markup).toContain("fill-zone-soft");
    expect(markup).toContain("fill-zone ");
  });

  test("comes with a table of the same numbers", () => {
    const markup = barChart();
    expect(markup).toContain("<details");
    expect(markup).toContain("<caption");
    expect(markup).toContain("octubre de 2026 (mes en curso, parcial)");
    expect(markup).toContain("USD 500,00");
  });

  test("with no income at all it still draws a readable empty scale", () => {
    const markup = barChart(MONTHS.map((month) => ({ ...month, value: 0 })));
    expect(markup).toContain(">100</text>");
    expect(markup.match(/height="2"/g)).toHaveLength(3);
  });
});

describe("HBarChart", () => {
  const ROWS: HBarRow[] = [
    { key: "a", label: "Plan de juego", value: 200_000, valueText: "USD 2.000,00", detail: "2 ventas · 80 %", title: "80 %" },
    { key: "b", label: "Clase 1 a 1", value: 50_000, valueText: "USD 500,00", detail: "1 venta · 20 %" },
  ];

  test("lists every row with its label, value and detail, in a named list", () => {
    const markup = html(createElement(HBarChart, { rows: ROWS, ariaLabel: "Ingresos por servicio" }));

    expect(markup).toContain('aria-label="Ingresos por servicio"');
    expect(markup.match(/data-testid="hbar-row"/g)).toHaveLength(2);
    for (const text of ["Plan de juego", "USD 2.000,00", "2 ventas · 80 %", "Clase 1 a 1", "USD 500,00"]) {
      expect(markup).toContain(text);
    }
    expect(markup).toContain('title="80 %"');
  });

  test("bars are as long as their value against the highest one", () => {
    const markup = html(createElement(HBarChart, { rows: ROWS, ariaLabel: "x" }));
    // La mayor ocupa todo; la otra, un cuarto. Cada barra son dos rectángulos (punta redonda y arranque recto).
    expect(markup).toContain('width="100%"');
    expect(markup).toContain('width="25%"');
    expect(markup).toContain('width="12.5%"');
    expect(markup).toContain('aria-hidden="true"');
  });
});

describe("MiniBars", () => {
  const bars = (values: number[]): MiniBar[] =>
    values.map((value, index) => ({ key: `m${index}`, name: `mes ${index}`, value, valueText: `USD ${value}` }));
  const render = (values: number[]) =>
    html(createElement(MiniBars, { bars: bars(values), label: "Ingresos", partialNote: "mes en curso" }));

  test("each bar is as tall as its value against the highest month of its own series", () => {
    // 30 px de alto: el mayor lo llena, la mitad llega a 15 y la cuarta parte a 8 (7,5 redondeado).
    expect(drawnHeights(render([10, 20, 40]), "mini-bar")).toEqual([8, 15, 30]);
  });

  test("a month without income keeps a stub so its place does not look empty", () => {
    expect(drawnHeights(render([0, 40]), "mini-bar")).toEqual([2, 30]);
  });
});

describe("Meter", () => {
  function meter(usedPct: number, tone: MeterTone = "accent"): string {
    return html(
      createElement(Meter, {
        usedPct,
        tone,
        label: "Tope usado",
        valueText: `${usedPct} % del tope`,
      }),
    );
  }

  test("is a meter with its value and a text for the screen reader", () => {
    const markup = meter(66.2);
    expect(markup).toContain('role="meter"');
    expect(markup).toContain('aria-label="Tope usado"');
    expect(markup).toContain('aria-valuemin="0"');
    expect(markup).toContain('aria-valuemax="100"');
    expect(markup).toContain('aria-valuenow="66.2"');
    expect(markup).toContain('aria-valuetext="66.2 % del tope"');
    expect(markup).toContain('width="66.2%"');
  });

  test("past the cap the bar is full and the value stays inside the range", () => {
    const markup = meter(125);
    expect(markup).toContain('aria-valuenow="100"');
    expect(markup).toContain('width="100%"');
  });

  test("with nothing used there is only the track", () => {
    expect(meter(0)).not.toContain('data-testid="meter-fill"');
  });

  test("the fill and its track take the color of the tone they are given", () => {
    expect(meter(50, "accent")).toContain("fill-zone");
    expect(meter(90, "warn")).toContain("fill-warn");
    expect(meter(120, "danger")).toContain("fill-danger");
    expect(meter(50, "accent")).toContain("fill-zone/15");
  });
});

describe("DeltaBadge", () => {
  const badge = (pct: number | null) => html(createElement(DeltaBadge, { pct }));

  test("a rise has an arrow, a plus sign and good tone; a drop the opposite", () => {
    const up = badge(12.5);
    expect(up).toContain('data-direction="up"');
    expect(up).toContain("+12,5 %");
    expect(up).toContain("Subió");
    expect(up).toContain("bg-ok-tint");
    const down = badge(-3.2);
    expect(down).toContain('data-direction="down"');
    expect(down).toContain("-3,2 %");
    expect(down).toContain("Bajó");
    expect(down).toContain("bg-danger-tint");
  });

  test("no change is neutral", () => {
    const flat = badge(0);
    expect(flat).toContain('data-direction="flat"');
    expect(flat).toContain("0 %");
    expect(flat).toContain("Sin cambios");
  });

  test("a huge rise is capped instead of printing an absurd number", () => {
    expect(badge(2882.1)).toContain("+999 % o más");
    expect(badge(999)).toContain("+999 %");
    expect(badge(999)).not.toContain("o más");
  });

  test("no previous income reads as no comparison", () => {
    const none = badge(null);
    expect(none).toContain("Sin comparación");
    expect(none).not.toContain("data-direction");
  });
});
