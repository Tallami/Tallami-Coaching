import { describe, expect, test } from "vitest";
import { ONE_SHOT_PARAMS, dropOneShotParams, returnPath } from "@/admin/auth/return-path";

// A dónde se vuelve después de entrar. Después de guardar, algunas pantallas quedan en una dirección con un aviso
// de un solo uso (`/admin/configuracion?guardada=1`). Si la sesión termina ahí y se vuelve a esa dirección, el
// aviso de «guardada» se vería sobre datos que no se guardaron: esos parámetros no viajan en el `next`.

describe("dropOneShotParams", () => {
  test.each([
    ["/admin/configuracion?guardada=1", "/admin/configuracion"],
    ["/admin/facturacion?guardada=facturadas&cantidad=3", "/admin/facturacion"],
    ["/admin/facturacion?guardada=sin-factura&cantidad=1", "/admin/facturacion"],
    ["/admin/alumnos/6a3f?guardado=editado", "/admin/alumnos/6a3f"],
    ["/admin/alumnos/6a3f?guardado=creado", "/admin/alumnos/6a3f"],
    ["/admin/ventas?exportacion=demasiadas", "/admin/ventas"],
    ["/admin/facturacion?exportacion=error", "/admin/facturacion"],
    ["/admin/ventas?guardada=creada", "/admin/ventas"],
  ])("drops the one-shot flags of %s", (raw, expected) => {
    expect(dropOneShotParams(raw)).toBe(expected);
  });

  test("keeps the filters that travel with the flag, in their order", () => {
    expect(dropOneShotParams("/admin/ventas?desde=2026-10-01&guardada=editada&q=ana&pagina=2")).toBe(
      "/admin/ventas?desde=2026-10-01&q=ana&pagina=2",
    );
    expect(dropOneShotParams("/admin/ventas?exportacion=error&servicio=lesson")).toBe("/admin/ventas?servicio=lesson");
  });

  test("drops a flag however many times it is repeated", () => {
    expect(dropOneShotParams("/admin/configuracion?guardada=1&guardada=2")).toBe("/admin/configuracion");
  });

  test("the sale page's `factura` flag is one-shot there, but the sales list's own filter", () => {
    expect(dropOneShotParams("/admin/ventas/6a3f?factura=pendiente")).toBe("/admin/ventas/6a3f");
    expect(dropOneShotParams("/admin/ventas/6a3f?factura=no-cobrada&guardada=editada")).toBe("/admin/ventas/6a3f");
    expect(dropOneShotParams("/admin/ventas?factura=issued")).toBe("/admin/ventas?factura=issued");
    expect(dropOneShotParams("/admin/ventas?factura=issued&guardada=creada")).toBe("/admin/ventas?factura=issued");
  });

  test.each([
    "/admin",
    "/admin/ventas?mes=2026-10&q=a%20b",
    "/admin/ventas/nueva",
    "/admin/facturacion?periodo=este-mes",
    "/admin/ventas?q=guardada",
    "/admin/ventas?guardadas=1",
  ])("leaves %s exactly as it is when it has no flag", (raw) => {
    expect(dropOneShotParams(raw)).toBe(raw);
  });

  test.each(["", "//evil.com?guardada=1", "https://evil.com/admin?guardada=1", "no-es-una-ruta?guardada=1"])(
    "hands %j back untouched for the safety check to judge",
    (raw) => {
      expect(dropOneShotParams(raw)).toBe(raw);
    },
  );

  test("lists the flags the panel leaves in the address after saving", () => {
    expect([...ONE_SHOT_PARAMS].sort()).toEqual(["cantidad", "exportacion", "guardada", "guardado"]);
  });
});

describe("returnPath", () => {
  test("is the safe path to come back to, without the one-shot flags", () => {
    expect(returnPath("/admin/configuracion?guardada=1")).toBe("/admin/configuracion");
    expect(returnPath("/admin/facturacion?guardada=facturadas&cantidad=3&periodo=este-mes")).toBe(
      "/admin/facturacion?periodo=este-mes",
    );
    expect(returnPath("/admin/ventas/nueva")).toBe("/admin/ventas/nueva");
  });

  test.each(["//evil.com", "https://evil.com/admin", "/es?guardada=1", "/admin/login?guardada=1", undefined, 42])(
    "falls back to the panel for the hostile value %j",
    (raw) => {
      expect(returnPath(raw)).toBe("/admin");
    },
  );
});
