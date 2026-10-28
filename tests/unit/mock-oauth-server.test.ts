// El servidor OAuth falso de los e2e del portal (`tests/helpers/mock-oauth-server.mjs`) se
// arranca de verdad, en un puerto libre, y se le habla como lo hace el sitio y el navegador.
// Lo que se cuida acá: nadie entra con una identidad compartida. El alumno se elige con
// `login_hint` o con la cookie `mock_oauth_student`; sin ninguno de los dos, el servidor
// devuelve un error (antes entraba siempre como `alumno-1`, y un test que fallaba a medias
// lo dejaba vinculado para el reintento y para el siguiente).

import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const REDIRECT_URI = "http://localhost:3100/api/portal/auth/test/callback";
const STUDENT_COOKIE = "mock_oauth_student";

let child: ChildProcess;
let base: string;

/** Un puerto que nadie usa ahora: se abre uno en el 0 y se suelta. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function waitUntilUp(): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
    } catch {
      // Todavía no escucha.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("El servidor OAuth falso no arrancó.");
}

beforeAll(async () => {
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["tests/helpers/mock-oauth-server.mjs"], {
    env: { ...process.env, MOCK_OAUTH_PORT: String(port) },
    stdio: "ignore",
  });
  await waitUntilUp();
}, 30_000);

afterAll(() => {
  child.kill();
});

interface Pkce {
  verifier: string;
  challenge: string;
}

function newPkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/** Pide `/authorize` como el navegador (sin seguir la redirección) y devuelve a dónde manda. */
async function authorize(
  pkce: Pkce,
  { query = {}, cookie }: { query?: Record<string, string>; cookie?: string } = {},
): Promise<URL> {
  const url = new URL(`${base}/authorize`);
  for (const [name, value] of Object.entries({
    response_type: "code",
    client_id: "tallami-portal-test",
    redirect_uri: REDIRECT_URI,
    state: "s".repeat(43),
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    ...query,
  })) {
    url.searchParams.set(name, value);
  }
  const response = await fetch(url, { redirect: "manual", headers: cookie ? { cookie } : {} });
  expect(response.status).toBe(302);
  return new URL(response.headers.get("location") ?? "");
}

/** Cambia el código por un token y pide el perfil, como lo hace el sitio. */
async function profileOf(code: string, pkce: Pkce): Promise<Record<string, unknown>> {
  const token = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: pkce.verifier,
      redirect_uri: REDIRECT_URI,
      client_id: "tallami-portal-test",
      client_secret: "secreto",
    }),
  });
  expect(token.status).toBe(200);
  const { access_token } = (await token.json()) as { access_token: string };
  const profile = await fetch(`${base}/userinfo`, { headers: { Authorization: `Bearer ${access_token}` } });
  return (await profile.json()) as Record<string, unknown>;
}

describe("which student the fake provider signs in", () => {
  test("the one in the `login_hint`", async () => {
    const pkce = newPkce();

    const back = await authorize(pkce, { query: { login_hint: "alumno-hint" } });

    expect(back.searchParams.get("state")).toBe("s".repeat(43));
    expect(await profileOf(back.searchParams.get("code") ?? "", pkce)).toMatchObject({ sub: "alumno-hint" });
  });

  test("the one in the `mock_oauth_student` cookie, when there is no hint (the browser cannot add a hint to a redirect)", async () => {
    const pkce = newPkce();

    const back = await authorize(pkce, { cookie: `${STUDENT_COOKIE}=alumno-cookie` });

    expect(await profileOf(back.searchParams.get("code") ?? "", pkce)).toMatchObject({
      sub: "alumno-cookie",
      name: "Alumno alumno-cookie",
      email: "alumno-cookie@example.com",
    });
  });

  test("the cookie is found among other cookies of the same host", async () => {
    const pkce = newPkce();

    const back = await authorize(pkce, { cookie: `tallami_alumno=otra; ${STUDENT_COOKIE}=alumno-entre; theme=dark` });

    expect(await profileOf(back.searchParams.get("code") ?? "", pkce)).toMatchObject({ sub: "alumno-entre" });
  });

  test("the hint wins over the cookie", async () => {
    const pkce = newPkce();

    const back = await authorize(pkce, {
      query: { login_hint: "alumno-hint" },
      cookie: `${STUDENT_COOKIE}=alumno-cookie`,
    });

    expect(await profileOf(back.searchParams.get("code") ?? "", pkce)).toMatchObject({ sub: "alumno-hint" });
  });

  test("nobody when there is neither: an `invalid_request` error back to the site, with the state and no code", async () => {
    const back = await authorize(newPkce());

    expect(back.searchParams.get("error")).toBe("invalid_request");
    expect(back.searchParams.get("state")).toBe("s".repeat(43));
    expect(back.searchParams.has("code")).toBe(false);
  });

  test.each(["", "Con Espacios", "MAYUSCULAS", "a".repeat(65), "../x"])(
    "nobody when the cookie holds something that is not a student id (%j)",
    async (value) => {
      const back = await authorize(newPkce(), { cookie: `${STUDENT_COOKIE}=${encodeURIComponent(value)}` });

      expect(back.searchParams.get("error")).toBe("invalid_request");
      expect(back.searchParams.has("code")).toBe(false);
    },
  );

  test("a student who denies at the provider needs no identity: `access_denied`", async () => {
    const back = await authorize(newPkce(), { query: { deny: "1" } });

    expect(back.searchParams.get("error")).toBe("access_denied");
  });
});
