import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { PanelError } from "@/components/admin/panel-error";

// `error.tsx` lee la dirección con los hooks de `next/navigation`: acá se
// simulan para ver a dónde apunta el enlace al ingreso.
const navigation = vi.hoisted(() => ({
  pathname: "/admin/ventas/nueva" as string | null,
  search: "" as string,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}));

const noop = () => undefined;

// Un error como el que llega de un Server Component en producción: Next deja el
// mensaje genérico y un `digest`, pero uno de desarrollo (o de un componente de
// cliente) trae el texto real. Nada de eso se muestra.
function technicalError(): Error & { digest?: string } {
  return Object.assign(new Error("connect ECONNREFUSED db.interno:5432 (password authentication failed)"), {
    digest: "3141592653",
    stack: "Error: connect ECONNREFUSED\n    at TCPConnectWrap.afterConnect (node:net:1555:16)",
  });
}

describe("PanelError", () => {
  test("says in Spanish that something went wrong and offers to try again or to sign in", () => {
    const markup = renderToStaticMarkup(createElement(PanelError, { retry: noop, loginHref: "/admin/login" }));

    expect(markup).toContain("<h1");
    expect(markup).toContain("Algo salió mal");
    expect(markup).toContain("Volver a intentar");
    expect(markup).toMatch(/<a [^>]*href="\/admin\/login"[^>]*>\s*Ir al ingreso\s*<\/a>/);
    expect(markup).toContain("<button");
    expect(markup).toContain('type="button"');
  });

  test("tells what may have happened without blaming the visitor, and that the last thing may not be saved", () => {
    const markup = renderToStaticMarkup(createElement(PanelError, { retry: noop, loginHref: "/admin/login" }));

    expect(markup).toContain("sesión");
    expect(markup).toContain("no se haya guardado");
  });

  test("the retry button runs the function it is given", () => {
    const retry = vi.fn();
    const tree = PanelError({ retry, loginHref: "/admin/login" });

    const button = findElement(tree, (element) => typeof element.props.onClick === "function");

    expect(button).toBeDefined();
    (button?.props as { onClick: () => void }).onClick();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe("the panel's error.tsx", () => {
  beforeEach(() => {
    navigation.pathname = "/admin/ventas/nueva";
    navigation.search = "";
  });

  async function render(error: Error & { digest?: string } = technicalError()): Promise<string> {
    const { default: AdminError } = await import("@/app/admin/error");
    return renderToStaticMarkup(createElement(AdminError, { error, reset: noop, retry: noop }));
  }

  test("shows the Spanish page, with no message, stack or digest of the error", async () => {
    const markup = await render();

    expect(markup).toContain("Algo salió mal");
    expect(markup).toContain("Volver a intentar");
    for (const leak of ["ECONNREFUSED", "db.interno", "password", "TCPConnectWrap", "3141592653", "digest", "Application error"]) {
      expect(markup, leak).not.toContain(leak);
    }
  });

  test("the link to the login remembers the page the visitor was on", async () => {
    expect(await render()).toContain('href="/admin/login?next=%2Fadmin%2Fventas%2Fnueva"');

    navigation.pathname = "/admin/alumnos";
    navigation.search = "q=ana&page=2";
    expect(await render()).toContain('href="/admin/login?next=%2Fadmin%2Falumnos%3Fq%3Dana%26page%3D2"');
  });

  test("from the overview, or without a known address, it links to the plain login", async () => {
    navigation.pathname = "/admin";
    expect(await render()).toContain('href="/admin/login"');

    navigation.pathname = null;
    expect(await render()).toContain('href="/admin/login"');
  });

  test("never sends the visitor outside the panel, whatever the address says", async () => {
    navigation.pathname = "//sitio-malo.com/admin";
    const markup = await render();

    expect(markup).toContain('href="/admin/login"');
    expect(markup).not.toContain("sitio-malo");
  });
});

type ElementLike = { type: unknown; props: { children?: unknown } & Record<string, unknown> };

/** Recorre el árbol de elementos de React que devuelve un componente y trae el primero que cumple. */
function findElement(node: unknown, matches: (element: ElementLike) => boolean): ElementLike | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, matches);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof node !== "object" || node === null || !("props" in node)) return undefined;
  const element = node as ElementLike;
  if (matches(element)) return element;
  return findElement(element.props.children, matches);
}
