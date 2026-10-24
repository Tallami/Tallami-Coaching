import { describe, expect, test } from "vitest";
import { loginPath } from "@/admin/auth/redirect";
import { sameOriginReferer } from "@/admin/auth/referer";

// Cuando la sesión terminó en medio de una acción, el único dato de "dónde estaba la
// persona" es el `Referer` del pedido (la página del formulario). Solo vale si es de este
// mismo sitio; lo que venga de afuera, o no venga, no se usa.

function request(headers: Record<string, string>): Headers {
  return new Headers(headers);
}

describe("sameOriginReferer", () => {
  test("is the path and query of the page the action was sent from", () => {
    expect(
      sameOriginReferer(request({ host: "localhost:3100", referer: "http://localhost:3100/admin/ventas/nueva" })),
    ).toBe("/admin/ventas/nueva");
    expect(
      sameOriginReferer(
        request({ host: "tallami.com", referer: "https://tallami.com/admin/ventas?mes=2026-10&q=ana#tabla" }),
      ),
    ).toBe("/admin/ventas?mes=2026-10&q=ana");
  });

  test("trusts the forwarded host, as it is behind a proxy", () => {
    expect(
      sameOriginReferer(
        request({
          host: "interno:3000",
          "x-forwarded-host": "tallami.com",
          referer: "https://tallami.com/admin/facturacion",
        }),
      ),
    ).toBe("/admin/facturacion");
  });

  test.each([
    ["another site", { host: "tallami.com", referer: "https://sitio-malo.com/admin/ventas" }],
    ["a look-alike host", { host: "tallami.com", referer: "https://tallami.com.sitio-malo.com/admin/ventas" }],
    ["a user-info trick", { host: "tallami.com", referer: "https://tallami.com@sitio-malo.com/admin/ventas" }],
    ["another port", { host: "localhost:3100", referer: "http://localhost:3000/admin/ventas" }],
    ["no referer", { host: "tallami.com" }],
    ["an empty referer", { host: "tallami.com", referer: "" }],
    ["a referer that is not a URL", { host: "tallami.com", referer: "/admin/ventas" }],
    ["no host to compare with", { referer: "https://tallami.com/admin/ventas" }],
  ])("is nothing for %s", (_label, headers) => {
    expect(sameOriginReferer(request(headers))).toBeUndefined();
  });

  test("leaves out the one-shot flags of a result page: coming back must not show \"guardada\" over data that was not saved", () => {
    const from = (referer: string) => sameOriginReferer(request({ host: "tallami.com", referer }));

    expect(from("https://tallami.com/admin/configuracion?guardada=1")).toBe("/admin/configuracion");
    expect(from("https://tallami.com/admin/facturacion?guardada=facturadas&cantidad=3&periodo=este-mes")).toBe(
      "/admin/facturacion?periodo=este-mes",
    );
    expect(from("https://tallami.com/admin/alumnos/6a3f?guardado=editado")).toBe("/admin/alumnos/6a3f");
    expect(from("https://tallami.com/admin/ventas?exportacion=error&q=ana")).toBe("/admin/ventas?q=ana");
    expect(from("https://tallami.com/admin/ventas/6a3f?factura=pendiente")).toBe("/admin/ventas/6a3f");
    // `factura` en la lista de ventas es un filtro de verdad.
    expect(from("https://tallami.com/admin/ventas?factura=issued")).toBe("/admin/ventas?factura=issued");
  });

  test("goes through the login path's own safety check: only panel pages come back", () => {
    const toLogin = (referer: string) =>
      loginPath({ next: sameOriginReferer(request({ host: "tallami.com", referer })), error: "vencida" });

    expect(toLogin("https://tallami.com/admin/ventas/nueva")).toBe(
      "/admin/login?next=%2Fadmin%2Fventas%2Fnueva&error=vencida",
    );
    expect(toLogin("https://tallami.com/es")).toBe("/admin/login?error=vencida");
    expect(toLogin("https://tallami.com/admin/login?error=invalid")).toBe("/admin/login?error=vencida");
    expect(toLogin("https://tallami.com/admin")).toBe("/admin/login?error=vencida");
  });
});
