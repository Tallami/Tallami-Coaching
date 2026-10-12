import { describe, expect, test } from "vitest";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import pt from "../../messages/pt.json";

type Messages = { [key: string]: string | Messages };

function flattenMessages(messages: Messages, prefix = ""): [string, unknown][] {
  return Object.entries(messages).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "object" && value !== null
      ? flattenMessages(value, path)
      : [[path, value] as [string, unknown]];
  });
}

function flattenKeys(messages: Messages): string[] {
  return flattenMessages(messages)
    .map(([path]) => path)
    .sort();
}

/**
 * Nombres de los argumentos ICU de un mensaje: `{count}` y también
 * `{count, plural, ...}`. Ignora el texto de las ramas (`one {# item}`).
 */
function placeholderNames(message: string): string[] {
  const names = new Set<string>();
  for (const match of message.matchAll(/\{\s*([A-Za-z_]\w*)\s*(?=[,}])/g)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

function placeholdersByKey(messages: Messages): Map<string, string[]> {
  return new Map(
    flattenMessages(messages).map(([path, value]) => [
      path,
      placeholderNames(String(value)),
    ]),
  );
}

const catalogs: [string, Messages][] = [
  ["es", es],
  ["pt", pt],
  ["en", en],
];

describe("messages", () => {
  test("pt and en define exactly the same message keys as es", () => {
    expect(flattenKeys(pt)).toEqual(flattenKeys(es));
    expect(flattenKeys(en)).toEqual(flattenKeys(es));
  });

  test("pt and en use the same ICU placeholders as es for every key", () => {
    const spanish = placeholdersByKey(es);

    for (const [locale, messages] of [
      ["pt", pt],
      ["en", en],
    ] as const) {
      const translated = placeholdersByKey(messages);
      for (const [path, names] of spanish) {
        expect(translated.get(path), `${locale}: ${path}`).toEqual(names);
      }
    }
  });

  test("home messages declare the ICU arguments the page passes", () => {
    const spanish = placeholdersByKey(es);

    expect(spanish.get("Metadata.description")).toEqual(["count"]);
    expect(spanish.get("Hero.title")).toEqual(["count"]);
    expect(spanish.get("Services.items.lesson.description")).toEqual([
      "packPrice",
      "savings",
      "sessions",
    ]);
    expect(spanish.get("Services.pro.unit")).toEqual([]);
    expect(spanish.get("Faq.items.pro.answer")).toEqual(["price"]);
    expect(spanish.get("Footer.legal")).toEqual(["year"]);
    expect(spanish.get("Reviews.cardLabel")).toEqual(["name"]);
  });

  test("Reviews title and nav link are the same word in every language", () => {
    for (const [, messages] of catalogs) {
      expect(messages).toMatchObject({
        Reviews: { title: "Reviews" },
        Header: { reviews: "Reviews" },
      });
    }
  });

  test.each(catalogs)("no message says freelance in %s", (_locale, messages) => {
    for (const [path, value] of flattenMessages(messages)) {
      expect(String(value), path).not.toMatch(/freelanc/i);
    }
  });

  test.each(catalogs)(
    "no message keeps the hero counters, Academia or monthly unit in %s",
    (_locale, messages) => {
      const paths = flattenMessages(messages).map(([path]) => path);

      expect(paths).not.toContain("Hero.summaryLabel");
      expect(paths).not.toContain("Hero.titlesLabel");
      expect(paths).not.toContain("Hero.firstPlacesLabel");
      expect(paths).not.toContain("Services.items.academy.name");
      expect(paths).not.toContain("Services.units.perMonth");
    },
  );

  test.each(catalogs)("no price is written in %s messages", (_locale, messages) => {
    for (const [path, value] of flattenMessages(messages)) {
      expect(String(value), path).not.toMatch(/USD\s*\d|\$\s*\d/);
    }
  });

  test.each(catalogs)("no message is empty in %s", (_locale, messages) => {
    const leaves = flattenMessages(messages);

    expect(leaves.length).toBeGreaterThan(0);
    for (const [path, value] of leaves) {
      expect(typeof value, path).toBe("string");
      expect((value as string).trim().length, path).toBeGreaterThan(0);
    }
  });
});
