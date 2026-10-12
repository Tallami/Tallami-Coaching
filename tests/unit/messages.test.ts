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

  test.each(catalogs)("no message is empty in %s", (_locale, messages) => {
    const leaves = flattenMessages(messages);

    expect(leaves.length).toBeGreaterThan(0);
    for (const [path, value] of leaves) {
      expect(typeof value, path).toBe("string");
      expect((value as string).trim().length, path).toBeGreaterThan(0);
    }
  });
});
