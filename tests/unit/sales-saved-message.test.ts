import { describe, expect, test } from "vitest";
import { savedSaleMessage } from "@/admin/sales/saved-message";

describe("savedSaleMessage", () => {
  test("writes the notice for the two ways of saving a sale", () => {
    expect(savedSaleMessage("creada")).toBe("Venta guardada.");
    expect(savedSaleMessage("editada")).toBe("Cambios guardados.");
  });

  test("takes the first value when the parameter is repeated", () => {
    expect(savedSaleMessage(["editada", "creada"])).toBe("Cambios guardados.");
  });

  test.each([undefined, "", "otra-cosa", "CREADA", " creada", []])("says nothing for %j", (value) => {
    expect(savedSaleMessage(value)).toBeUndefined();
  });

  test.each([
    "__proto__",
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "__defineGetter__",
  ])("says nothing for the object property %s, instead of returning the property", (value) => {
    expect(savedSaleMessage(value)).toBeUndefined();
    expect(savedSaleMessage([value])).toBeUndefined();
  });
});
