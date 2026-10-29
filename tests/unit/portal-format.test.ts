import { describe, expect, test } from "vitest";
import { formatPortalDay, formatPortalMoment, formatPortalMoney, linkDomain } from "@/portal/format";

// Lo que el alumno lee de una compra: el monto en la moneda de la venta y las fechas, en el
// idioma de la página. A diferencia del panel (solo es-AR), el portal está en es, pt y en.

describe("formatPortalMoney", () => {
  test("writes the currency code and the amount, without cents when there are none", () => {
    expect(formatPortalMoney(3000, "USD", "es")).toBe("USD 30");
    expect(formatPortalMoney(3000, "USD", "pt")).toBe("USD 30");
    expect(formatPortalMoney(3000, "USD", "en")).toBe("USD 30");
  });

  test("shows both cents when there are any", () => {
    expect(formatPortalMoney(3050, "USD", "es")).toBe("USD 30,50");
    expect(formatPortalMoney(3005, "USD", "en")).toBe("USD 30.05");
  });

  test("groups the thousands the way each language does", () => {
    expect(formatPortalMoney(123_456_789, "USD", "es")).toBe("USD 1.234.567,89");
    expect(formatPortalMoney(123_456_789, "USD", "pt")).toBe("USD 1.234.567,89");
    expect(formatPortalMoney(123_456_789, "USD", "en")).toBe("USD 1,234,567.89");
    expect(formatPortalMoney(5_000_000, "ARS", "es")).toBe("ARS 50.000");
    expect(formatPortalMoney(5_000_000, "ARS", "en")).toBe("ARS 50,000");
  });

  test("keeps the code of every currency of the sale", () => {
    expect(formatPortalMoney(15_000, "BRL", "pt")).toBe("BRL 150");
    expect(formatPortalMoney(4500, "USDT", "es")).toBe("USDT 45");
  });

  test("does not lose a cent to the floating point of a division by 100", () => {
    // 1.005 * 100 no es 100.5 en coma flotante: los montos son enteros de centavos y así se escriben.
    expect(formatPortalMoney(100_501, "USD", "en")).toBe("USD 1,005.01");
    expect(formatPortalMoney(1, "USD", "en")).toBe("USD 0.01");
    expect(formatPortalMoney(29, "USD", "es")).toBe("USD 0,29");
  });
});

describe("formatPortalDay", () => {
  test("writes a day of payment the way each language does", () => {
    expect(formatPortalDay("2026-10-12", "es")).toBe("12 oct 2026");
    expect(formatPortalDay("2026-10-12", "pt")).toBe("12 de out. de 2026");
    expect(formatPortalDay("2026-10-12", "en")).toBe("Oct 12, 2026");
  });

  test("is the day written, whatever the time zone of the server: it is text, not an instant", () => {
    expect(formatPortalDay("2026-01-01", "en")).toBe("Jan 1, 2026");
    expect(formatPortalDay("2026-12-31", "en")).toBe("Dec 31, 2026");
  });

  test("hands back what is not a day instead of inventing one", () => {
    expect(formatPortalDay("pronto", "es")).toBe("pronto");
    expect(formatPortalDay("2026-02-30", "es")).toBe("2026-02-30");
  });
});

describe("formatPortalMoment", () => {
  test("writes the day of an instant in Argentina, like the panel, even when it is already tomorrow in UTC", () => {
    // 01:30 UTC del 13 son las 22:30 del 12 en Buenos Aires.
    expect(formatPortalMoment("2026-10-13T01:30:00.000Z", "es")).toBe("12 oct 2026");
    expect(formatPortalMoment("2026-10-13T01:30:00.000Z", "en")).toBe("Oct 12, 2026");
    expect(formatPortalMoment("2026-10-13T12:00:00.000Z", "pt")).toBe("13 de out. de 2026");
  });

  test("hands back what is not an instant instead of inventing one", () => {
    expect(formatPortalMoment("ayer", "es")).toBe("ayer");
  });
});

describe("linkDomain", () => {
  test("is the domain a link goes to, to show it next to the button", () => {
    expect(linkDomain("https://drive.google.com/file/d/1AbC/view?usp=sharing")).toBe("drive.google.com");
    expect(linkDomain("https://www.ejemplo.com/guia")).toBe("www.ejemplo.com");
  });

  test("does not show the user, the password, the port or the path", () => {
    expect(linkDomain("https://ejemplo.com:8443/privado?token=secreto")).toBe("ejemplo.com");
  });

  test("is null for what is not a link", () => {
    expect(linkDomain("no es un link")).toBeNull();
    expect(linkDomain("")).toBeNull();
  });
});
