import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { BarChart, type BarDatum } from "@/admin/charts/bar-chart";
import { DeltaBadge } from "@/admin/charts/delta-badge";
import { HBarChart, type HBarRow } from "@/admin/charts/hbar-chart";
import { Meter, meterTone } from "@/admin/charts/meter";

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

describe("Meter", () => {
  function meter(usedPct: number): string {
    return html(
      createElement(Meter, {
        usedPct,
        tone: meterTone(usedPct),
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

  test("the color follows how much was used", () => {
    expect(meterTone(0)).toBe("accent");
    expect(meterTone(79.9)).toBe("accent");
    expect(meterTone(80)).toBe("warn");
    expect(meterTone(99.9)).toBe("warn");
    expect(meterTone(100)).toBe("danger");
    expect(meterTone(250)).toBe("danger");
    expect(meter(50)).toContain("fill-zone");
    expect(meter(90)).toContain("fill-warn");
    expect(meter(120)).toContain("fill-danger");
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
