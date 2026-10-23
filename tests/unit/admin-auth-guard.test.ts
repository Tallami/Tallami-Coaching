import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextRequest } from "next/server";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { getMissingConfig } from "@/admin/auth/config";
import { guardAdmin, isAdminPath } from "@/admin/auth/guard";
import { hashPassword } from "@/admin/auth/password";
import { safeNextPath } from "@/admin/auth/redirect";
import { getClientIp, shouldUseSecureCookie } from "@/admin/auth/request";
import { ADMIN_COOKIE, createSessionToken } from "@/admin/auth/session";
import { SetupChecklist } from "@/components/admin/setup-checklist";
import robots from "@/app/robots";
import { config as proxyConfig } from "@/proxy";

// `src/proxy.ts` arma el middleware de next-intl al cargarse, y ese paquete no
// se resuelve bajo Vitest. Acá solo interesa su `config.matcher`.
vi.mock("next-intl/middleware", () => ({ default: () => () => undefined }));

const SECRET = "secreto-de-prueba-de-mas-de-32-caracteres";
const ORIGIN = "http://localhost:3100";

let storedHash: string;

beforeAll(async () => {
  storedHash = await hashPassword("una-clave-larga-de-prueba");
});

beforeEach(() => {
  vi.stubEnv("ADMIN_PASSWORD_HASH", storedHash);
  vi.stubEnv("ADMIN_SESSION_SECRET", SECRET);
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("safeNextPath", () => {
  test.each([
    ["/admin", "/admin"],
    ["/admin/ventas", "/admin/ventas"],
    ["/admin/ventas?mes=2026-10&q=ana", "/admin/ventas?mes=2026-10&q=ana"],
    ["/admin/ventas/", "/admin/ventas/"],
    ["/admin?x=1", "/admin?x=1"],
  ])("keeps the panel path %s", (raw, expected) => {
    expect(safeNextPath(raw)).toBe(expected);
  });

  test.each([
    undefined,
    null,
    42,
    "",
    "admin",
    "/",
    "/es",
    "/admin2",
    "/administrator",
    "/admin.evil.com",
    "/admin@evil.com",
    "//evil.com",
    "///evil.com",
    "//evil.com/admin",
    "/\\evil.com",
    "\\\\evil.com",
    "/\t/evil.com",
    "\n/admin",
    " /admin",
    "https://evil.com/admin",
    "http://localhost:3100/admin",
    "javascript:alert(1)",
    "data:text/html,hola",
    "/admin/../es",
    "/admin/%2e%2e/%2e%2e/es",
    "/admin%0d%0aSet-Cookie:x=1",
    `/admin/${"a".repeat(3000)}`,
  ])("falls back to /admin for the hostile value %j", (raw) => {
    expect(safeNextPath(raw)).toBe("/admin");
  });

  test.each(["/admin/login", "/admin/login?next=/admin/ventas", "/admin/setup"])(
    "does not send you back to %s",
    (raw) => {
      expect(safeNextPath(raw)).toBe("/admin");
    },
  );
});

describe("getClientIp", () => {
  const headersWith = (forwardedFor?: string) =>
    new Headers(forwardedFor === undefined ? {} : { "x-forwarded-for": forwardedFor });

  test.each([
    ["203.0.113.7", "203.0.113.7"],
    [" 203.0.113.7 ", "203.0.113.7"],
    ["203.0.113.7, 70.41.3.18, 150.172.238.178", "203.0.113.7"],
    ["2001:DB8::1", "2001:db8::1"],
  ])("takes the first hop of %j", (header, expected) => {
    expect(getClientIp(headersWith(header))).toBe(expected);
  });

  test.each([undefined, "", "no-es-una-ip", "203.0.113.7:4000", "999.1.1.1", "a".repeat(500)])(
    "falls back to a shared bucket for %j",
    (header) => {
      expect(getClientIp(headersWith(header))).toBe("unknown");
    },
  );
});

describe("shouldUseSecureCookie", () => {
  const request = (headers: Record<string, string>) => new Headers(headers);

  test("is always on in Vercel, whatever the host says", () => {
    vi.stubEnv("VERCEL", "1");

    expect(shouldUseSecureCookie(request({ host: "localhost:3000" }))).toBe(true);
    expect(shouldUseSecureCookie(request({ host: "tallami.com" }))).toBe(true);
  });

  test.each(["localhost:3100", "localhost", "127.0.0.1:3000", "[::1]:3000"])(
    "is off for plain http on the loopback host %s, so local development works",
    (host) => {
      expect(shouldUseSecureCookie(request({ host }))).toBe(false);
    },
  );

  test.each([
    ["a public host", { host: "tallami.com" }],
    ["a LAN address", { host: "192.168.1.5:3000" }],
    ["no host at all", {}],
    ["https behind a proxy, even on localhost", { host: "localhost:3000", "x-forwarded-proto": "https" }],
    ["a proxy chain that starts with https", { host: "localhost:3000", "x-forwarded-proto": "https, http" }],
  ])("is on for %s", (_label, headers) => {
    expect(shouldUseSecureCookie(request(headers))).toBe(true);
  });
});

describe("getMissingConfig", () => {
  test("is empty when everything is set", () => {
    expect(getMissingConfig()).toEqual([]);
  });

  test.each([
    ["ADMIN_PASSWORD_HASH", "", "missing"],
    ["ADMIN_PASSWORD_HASH", "una-clave-en-texto-plano", "invalid"],
    ["ADMIN_SESSION_SECRET", "", "missing"],
    ["ADMIN_SESSION_SECRET", "x".repeat(31), "too-short"],
  ])("flags %s set to %j as %s", (name, value, problem) => {
    vi.stubEnv(name, value);

    expect(getMissingConfig()).toEqual([{ name, problem }]);
  });

  test("asks for DATABASE_URL in Vercel, but not on a local machine", () => {
    expect(getMissingConfig()).toEqual([]);

    vi.stubEnv("VERCEL", "1");
    expect(getMissingConfig()).toEqual([{ name: "DATABASE_URL", problem: "missing" }]);

    vi.stubEnv("DATABASE_URL", "postgres://usuario:clave@host:6543/db");
    expect(getMissingConfig()).toEqual([]);
  });

  test("never reports a value, only names and problems", () => {
    vi.stubEnv("ADMIN_SESSION_SECRET", "corto-secreto");
    vi.stubEnv("ADMIN_PASSWORD_HASH", "texto-plano-secreto");

    const report = JSON.stringify(getMissingConfig());

    expect(report).not.toContain("corto-secreto");
    expect(report).not.toContain("texto-plano-secreto");
  });
});

describe("isAdminPath", () => {
  test.each([
    "/admin",
    "/admin/",
    "/admin/login",
    "/admin/ventas/123",
    "/admin/ventas.csv",
    "/admin.rsc",
    "/admin/login.segments/_tree.segment.rsc",
    "/admin/login.segments/lo-que-sea",
    "/%61dmin",
    "/%61dmin/ventas",
    "/admin%2Fventas",
  ])(
    "%s is the panel",
    (pathname) => {
      expect(isAdminPath(pathname)).toBe(true);
    },
  );

  test.each(["/", "/es", "/es/admin", "/administrator", "/adminx/login", "/api/admin", "/admin.png"])(
    "%s is not the panel",
    (pathname) => {
      expect(isAdminPath(pathname)).toBe(false);
    },
  );
});

describe("guardAdmin", () => {
  /** Una cookie firmada con un id de sesión bien formado: el `proxy` no mira la base. */
  async function validCookie(): Promise<string> {
    return `${ADMIN_COOKIE}=${await createSessionToken(randomBytes(32).toString("base64url"))}`;
  }

  function get(path: string, headers: Record<string, string> = {}, method = "GET") {
    return new NextRequest(`${ORIGIN}${path}`, { method, headers });
  }

  const isPassThrough = (response: Response) => response.headers.get("x-middleware-next") === "1";

  test("sends a visitor without a session to the login, remembering where they were going", async () => {
    const response = await guardAdmin(get("/admin"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/admin/login?next=%2Fadmin`);

    const sales = await guardAdmin(get("/admin/ventas?mes=2026-10"));
    expect(sales.headers.get("location")).toBe(
      `${ORIGIN}/admin/login?next=%2Fadmin%2Fventas%3Fmes%3D2026-10`,
    );
  });

  test("drops the router's own query when remembering the destination", async () => {
    const response = await guardAdmin(get("/admin/ventas?_rsc=abc123"));

    expect(response.headers.get("location")).toBe(`${ORIGIN}/admin/login?next=%2Fadmin%2Fventas`);
  });

  test.each([
    ["a forged value", "una-cookie-inventada"],
    ["a value shaped like a token", "aaa.bbb.ccc"],
  ])("sends %s to the login too", async (_label, value) => {
    const response = await guardAdmin(get("/admin", { cookie: `${ADMIN_COOKIE}=${value}` }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/admin/login");
  });

  test("closes the sessions of the old password: a new ADMIN_PASSWORD_HASH sends them to the login", async () => {
    const cookie = await validCookie();
    const open = await guardAdmin(get("/admin/ventas", { cookie }));
    expect(isPassThrough(open)).toBe(true);

    vi.stubEnv("ADMIN_PASSWORD_HASH", await hashPassword("la-clave-nueva-del-panel"));

    const closed = await guardAdmin(get("/admin/ventas", { cookie }));
    expect(closed.status).toBe(307);
    expect(closed.headers.get("location")).toContain("/admin/login");
    const action = await guardAdmin(get("/admin/ventas", { "next-action": "40abc", cookie }, "POST"));
    expect(action.status).toBe(401);
  });

  test("lets a valid session through, with noindex and no caching", async () => {
    const response = await guardAdmin(get("/admin/ventas", { cookie: await validCookie() }));

    expect(isPassThrough(response)).toBe(true);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("answers 401 to a server action without a valid session, never a redirect", async () => {
    const action = { "next-action": "40abc", "content-type": "text/plain" };

    const anonymous = await guardAdmin(get("/admin/ventas", action, "POST"));
    const forged = await guardAdmin(
      get("/admin/ventas", { ...action, cookie: `${ADMIN_COOKIE}=falsa` }, "POST"),
    );

    for (const response of [anonymous, forged]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("location")).toBeNull();
    }
  });

  test("tells the client of a server action to go to the login, so an expired session ends there and not in an error", async () => {
    // El cliente de Next entiende `x-action-redirect: <ruta>;<push|replace>` como la redirección de una acción
    // (la misma que escribe el servidor cuando una acción llama a `redirect()`). Sin eso, un 401 pelado se vuelve
    // una excepción en el navegador. El pedido sigue sin llegar a la acción: la respuesta es un 401 sin cuerpo.
    const action = { "next-action": "40abc", "content-type": "text/plain" };

    const anonymous = await guardAdmin(get("/admin/ventas/nueva", action, "POST"));
    const forged = await guardAdmin(
      get("/admin/ventas/nueva", { ...action, cookie: `${ADMIN_COOKIE}=falsa` }, "POST"),
    );

    for (const response of [anonymous, forged]) {
      expect(response.status).toBe(401);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("x-action-redirect")).toBe(
        "/admin/login?next=%2Fadmin%2Fventas%2Fnueva;replace",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(response.body).toBeNull();
    }
  });

  test("the action redirect remembers the page with its query, without the router parameter", async () => {
    const response = await guardAdmin(
      get("/admin/ventas?mes=2026-10&_rsc=abc123", { "next-action": "40abc" }, "POST"),
    );

    expect(response.headers.get("x-action-redirect")).toBe(
      "/admin/login?next=%2Fadmin%2Fventas%3Fmes%3D2026-10;replace",
    );
  });

  test("the action redirect cannot be bent into another site or loop on the login", async () => {
    for (const path of ["/admin/login.segments/x", "/admin//evil.com", "/admin/%2e%2e/es"]) {
      const response = await guardAdmin(get(path, { "next-action": "40abc" }, "POST"));
      const redirect = response.headers.get("x-action-redirect") ?? "";
      const [target] = redirect.split(";");

      expect(target.startsWith("/admin/login?next=%2Fadmin"), path).toBe(true);
      expect(redirect.endsWith(";replace"), path).toBe(true);
    }
  });

  test("a server action with a valid session gets no redirect header", async () => {
    const response = await guardAdmin(
      get("/admin/ventas", { "next-action": "40abc", cookie: await validCookie() }, "POST"),
    );

    expect(response.headers.get("x-action-redirect")).toBeNull();
  });

  test("lets a server action with a valid session through", async () => {
    const response = await guardAdmin(
      get("/admin/ventas", { "next-action": "40abc", cookie: await validCookie() }, "POST"),
    );

    expect(isPassThrough(response)).toBe(true);
  });

  test("sends a plain POST without a session to the login with a 303", async () => {
    const response = await guardAdmin(get("/admin/ventas", {}, "POST"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/admin/login");
  });

  test.each(["/admin/login", "/admin/login/", "/admin/setup"])(
    "leaves %s open without a session",
    async (path) => {
      expect(isPassThrough(await guardAdmin(get(path)))).toBe(true);
    },
  );

  test("leaves the login action open without a session", async () => {
    const response = await guardAdmin(get("/admin/login", { "next-action": "40abc" }, "POST"));

    expect(isPassThrough(response)).toBe(true);
  });

  // El segundo paso del ingreso (la llave, o registrar la primera) se hace sin sesión: es justamente lo que la abre.
  test.each([
    "/admin/login/llave",
    "/admin/login/primera-llave",
    "/admin/login/llave/",
    "/admin/login/llave?next=%2Fadmin%2Fventas",
    "/admin/login/llave.rsc",
    "/admin/login/primera-llave.segments/__PAGE__.segment.rsc",
  ])("leaves the login step %s open without a session", async (path) => {
    expect(isPassThrough(await guardAdmin(get(path)))).toBe(true);
  });

  test("leaves the actions of the login steps open without a session", async () => {
    for (const path of ["/admin/login/llave", "/admin/login/primera-llave"]) {
      const response = await guardAdmin(get(path, { "next-action": "40abc" }, "POST"));

      expect(isPassThrough(response), path).toBe(true);
    }
  });

  // Solo lo que está de verdad debajo de `/admin/login/` es una puerta: ni algo que empieza igual, ni una
  // dirección que al decodificarse sube con `..` hasta otra página del panel.
  test.each([
    "/admin/loginx",
    "/admin/loginx/llave",
    "/admin/login.segments/x",
    "/admin/ventas",
    "/admin/login%2F..%2Fventas",
    "/admin/login/..%2Fventas",
    "/admin/login/llave%2F..%2F..%2Fventas",
    "/admin/login/.%2E/ventas",
  ])("still asks for a session on %s", async (path) => {
    const response = await guardAdmin(get(path));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toMatch(/\/admin\/login\?next=/);

    const action = await guardAdmin(get(path, { "next-action": "40abc" }, "POST"));
    expect(action.status).toBe(401);
  });

  test.each(["/%61dmin", "/%61dmin/ventas", "/admin%2Fventas", "/admin/"])(
    "does not let the spelling %s skip the check",
    async (path) => {
      const response = await guardAdmin(get(path));

      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toContain("/admin/login");
    },
  );

  test.each([
    ["/admin/x.csv", "%2Fadmin%2Fx.csv"],
    ["/admin/ventas/2026.10.csv", "%2Fadmin%2Fventas%2F2026.10.csv"],
    ["/admin.rsc", "%2Fadmin"],
    ["/admin/ventas.rsc", "%2Fadmin%2Fventas"],
    ["/admin/ventas.segments/_tree.segment.rsc", "%2Fadmin%2Fventas"],
  ])("protects the file-like and transport address %s too", async (path, next) => {
    const response = await guardAdmin(get(path));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/admin/login?next=${next}`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  test.each([
    "/admin/login.rsc",
    "/admin/login.segments/__PAGE__.segment.rsc",
    "/admin/login.segments/a/b/c.segment.rsc",
    "/admin/setup.rsc",
    "/admin/setup.segments/__PAGE__.segment.rsc",
  ])("leaves the doors open in their transport form %s", async (path) => {
    expect(isPassThrough(await guardAdmin(get(path)))).toBe(true);
  });

  // Next solo entiende `^(/.*)\.segments(/.*)\.segment\.rsc$` y `\.rsc$` como formas de
  // transporte. Cualquier otra cosa que se parezca no es el login, aunque empiece igual.
  test.each([
    "/admin/login.segments/lo-que-sea",
    "/admin/login.segments/",
    "/admin/login.segments/x.segment",
    "/admin/login.segments/x.segment.rsc.rsc",
    "/admin/login.segments.segment.rsc",
    "/admin/login.segments/x.segment.rsc/y",
    "/admin/setup.segments/lo-que-sea",
    "/admin/login.segments/x.segments/y",
    // Un punto escrito como %2E no forma ".rsc": Next no lo toma como transporte.
    "/admin/login%2Ersc",
  ])("does not take %s for a door: it is the panel and needs a session", async (path) => {
    const response = await guardAdmin(get(path));

    expect(response.status).toBe(307);
    // (Con una barra final en la dirección pedida, el redirect la conserva; Next la quita al llegar.)
    expect(response.headers.get("location")).toMatch(/\/admin\/login\/?\?next=/);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("a valid session still gets through those addresses (the page, not the guard, answers)", async () => {
    const cookie = await validCookie();

    for (const path of ["/admin/login.segments/lo-que-sea", "/admin/ventas.segments/x.segment"]) {
      expect(isPassThrough(await guardAdmin(get(path, { cookie }))), path).toBe(true);
    }
  });

  test("strips only the transport form Next defines, and only once", async () => {
    const cases: [string, string][] = [
      // Quita `.segments/<ruta>.segment.rsc` entero, hasta el último `.segments/` (el cuantificador es codicioso).
      ["/admin/ventas.segments/a.segments/b.segment.rsc", "%2Fadmin%2Fventas.segments%2Fa"],
      ["/admin/ventas.segments/_tree.segment.rsc", "%2Fadmin%2Fventas"],
      ["/admin/ventas.rsc", "%2Fadmin%2Fventas"],
      // Una sola pasada: lo que queda después no se vuelve a limpiar.
      ["/admin/ventas.rsc.rsc", "%2Fadmin%2Fventas.rsc"],
    ];

    for (const [path, next] of cases) {
      const response = await guardAdmin(get(path));
      expect(response.headers.get("location"), path).toBe(`${ORIGIN}/admin/login?next=${next}`);
    }
  });

  describe("when the panel is not configured", () => {
    beforeEach(() => {
      vi.stubEnv("ADMIN_PASSWORD_HASH", "");
    });

    test("sends everything to the setup page, valid cookie or not", async () => {
      for (const path of ["/admin", "/admin/login", "/admin/ventas"]) {
        const response = await guardAdmin(get(path));

        expect(response.status).toBe(307);
        expect(response.headers.get("location")).toBe(`${ORIGIN}/admin/setup`);
      }
    });

    test("serves the setup page itself", async () => {
      expect(isPassThrough(await guardAdmin(get("/admin/setup")))).toBe(true);
    });

    test("answers 401 to server actions and sends their client to the setup page", async () => {
      const response = await guardAdmin(get("/admin/login", { "next-action": "40abc" }, "POST"));

      expect(response.status).toBe(401);
      expect(response.headers.get("x-action-redirect")).toBe("/admin/setup;replace");
    });
  });
});

describe("proxy matcher", () => {
  // La función con la que Next convierte `config.matcher` en las expresiones
  // regulares que deciden dónde corre el proxy (suma también las formas
  // `.rsc` y `.segments/…`). Es interna y sin tipos: si Next la renombra, este
  // test falla a la vista en lugar de dejar de probar el matcher.
  const { getMiddlewareMatchers } = createRequire(import.meta.url)(
    "next/dist/build/analysis/get-page-static-info",
  ) as {
    getMiddlewareMatchers: (matcher: unknown, nextConfig: object) => { regexp: string }[];
  };

  function runsProxyOn(pathname: string): boolean {
    return getMiddlewareMatchers(proxyConfig.matcher, {}).some(({ regexp }) =>
      new RegExp(regexp).test(pathname),
    );
  }

  test.each([
    "/admin",
    "/admin/",
    "/admin/login",
    "/admin/x.csv",
    "/admin/ventas/2026.10.csv",
    "/admin/clientes/ana.perez",
    "/admin.rsc",
    "/admin/login.segments/_tree.segment.rsc",
  ])("runs on the panel address %s, dots included", (pathname) => {
    expect(runsProxyOn(pathname)).toBe(true);
  });

  test.each(["/", "/es", "/pt", "/en", "/es/no-existe", "/fr"])(
    "still runs on the public page %s",
    (pathname) => {
      expect(runsProxyOn(pathname)).toBe(true);
    },
  );

  test.each([
    "/robots.txt",
    "/sitemap.xml",
    "/icon.svg",
    "/apple-icon.png",
    "/es.rsc",
    "/_next/static/chunk.js",
    "/_vercel/insights/script.js",
    "/api/interest",
  ])("still skips %s", (pathname) => {
    expect(runsProxyOn(pathname)).toBe(false);
  });
});

describe("SetupChecklist", () => {
  test("names each missing variable and says how to fix it", () => {
    const html = renderToStaticMarkup(
      createElement(SetupChecklist, {
        items: [
          { name: "ADMIN_PASSWORD_HASH", problem: "missing" },
          { name: "ADMIN_SESSION_SECRET", problem: "too-short" },
          { name: "DATABASE_URL", problem: "missing" },
        ],
      }),
    );

    expect(html).toContain("ADMIN_PASSWORD_HASH");
    expect(html).toContain("npm run admin:password");
    expect(html).toContain("ADMIN_SESSION_SECRET");
    expect(html).toContain("32");
    expect(html).toContain("DATABASE_URL");
  });
});

describe("robots.txt", () => {
  test("keeps the public site open and the panel closed", () => {
    const { rules, sitemap } = robots();

    expect(rules).toMatchObject({ userAgent: "*", allow: "/", disallow: "/admin" });
    expect(String(sitemap)).toMatch(/\/sitemap\.xml$/);
  });
});
