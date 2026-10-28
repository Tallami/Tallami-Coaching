// Servidor OAuth 2.0 falso para los e2e del portal del alumno: el "proveedor de
// prueba" (`PORTAL_OAUTH_TEST_ISSUER`). Node puro, sin dependencias; lo arranca
// Playwright (`playwright.config.ts`) y nunca es parte de la web.
//
//   node tests/helpers/mock-oauth-server.mjs      # puerto MOCK_OAUTH_PORT (3110 por defecto)
//
// Habla como Discord o Google, sin pantallas:
//
//   GET  /authorize  Vuelve enseguida (302) al `redirect_uri` con un `code` y el `state`
//                    recibido. El alumno se elige con `login_hint` o, si no viene, con la
//                    cookie `mock_oauth_student` (el navegador no puede agregar un
//                    `login_hint` a la redirección que le manda el sitio, pero el test sí
//                    puede poner la cookie en su contexto). Sin ninguno de los dos vuelve
//                    con `error=invalid_request`: no hay una identidad compartida por
//                    defecto, así un test que falla a medias no deja a nadie vinculado para
//                    el reintento ni para el siguiente. Con `deny=1` vuelve con
//                    `error=access_denied`, como cuando el alumno cancela. Exige el flujo
//                    con PKCE S256.
//   POST /token      Cambia el código por un token de acceso. El código vale una sola
//                    vez y solo con el `code_verifier` cuyo SHA-256 es el
//                    `code_challenge` de `/authorize`, el mismo `redirect_uri` y el
//                    mismo cliente.
//   GET  /userinfo   El perfil del alumno del token (`Authorization: Bearer …`):
//                    `{ sub, name, email }`.
//   GET  /health     200: Playwright espera esta dirección para saber que arrancó.
//
// Escucha solo en esta máquina (127.0.0.1 y ::1).

import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_OAUTH_PORT ?? 3110);
/** Un alumno de prueba: letras minúsculas, números y guiones. */
const STUDENT_ID = /^[a-z0-9-]{1,64}$/;
/** La cookie con la que un test elige al alumno cuando el navegador no puede mandar `login_hint`. */
const STUDENT_COOKIE = "mock_oauth_student";
const PKCE_VALUE = /^[A-Za-z0-9._~-]{43,128}$/;
const CODE_TTL_MS = 60_000;
const MAX_BODY_BYTES = 16 * 1024;

/** Los códigos entregados y todavía sin usar: código → lo que se pidió en `/authorize`. */
const codes = new Map();
/** Los tokens de acceso entregados: token → alumno. */
const tokens = new Map();

function randomValue() {
  return randomBytes(32).toString("base64url");
}

/** @param {string} id */
function studentFor(id) {
  return { sub: id, name: `Alumno ${id}`, email: `${id}@example.com` };
}

/** @param {string} verifier */
function s256(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function send(response, status, body, headers = {}) {
  response.writeHead(status, { "Cache-Control": "no-store", ...headers });
  response.end(body);
}

function sendJson(response, status, value) {
  send(response, status, JSON.stringify(value), { "Content-Type": "application/json" });
}

/** ¿Es una dirección de vuelta de esta máquina? El proveedor de prueba no vuelve a ningún otro lado. */
function isLocalRedirect(value) {
  if (!value || !URL.canParse(value)) return false;
  const url = new URL(value);
  return url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}

function redirectBack(response, redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  send(response, 302, "", { Location: url.toString() });
}

/**
 * El valor de la cookie `name` del encabezado `Cookie`, o `null` si no está. Sin decodificar
 * de más: el valor se valida enseguida con `STUDENT_ID`.
 * @param {string | undefined} header
 * @param {string} name
 */
function cookieValue(header, name) {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key !== name) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return null; // Un valor con un `%` roto no es un alumno.
    }
  }
  return null;
}

function authorize(url, request, response) {
  const params = url.searchParams;
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state") ?? "";
  if (!isLocalRedirect(redirectUri)) return send(response, 400, "redirect_uri inválido");
  if (params.get("deny") === "1") return redirectBack(response, redirectUri, { error: "access_denied", state });
  if (params.get("response_type") !== "code" || !params.get("client_id") || !state) {
    return redirectBack(response, redirectUri, { error: "invalid_request", state });
  }
  const challenge = params.get("code_challenge") ?? "";
  if (params.get("code_challenge_method") !== "S256" || !PKCE_VALUE.test(challenge)) {
    return redirectBack(response, redirectUri, { error: "invalid_request", state });
  }
  const hint = params.get("login_hint") || cookieValue(request.headers.cookie, STUDENT_COOKIE) || "";
  if (!STUDENT_ID.test(hint)) return redirectBack(response, redirectUri, { error: "invalid_request", state });

  const code = randomValue();
  codes.set(code, {
    challenge,
    redirectUri,
    clientId: params.get("client_id"),
    student: hint,
    expiresAt: Date.now() + CODE_TTL_MS,
  });
  return redirectBack(response, redirectUri, { code, state });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("cuerpo demasiado grande"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

async function token(request, response) {
  const contentType = request.headers["content-type"] ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded")) {
    return sendJson(response, 400, { error: "invalid_request" });
  }
  const params = new URLSearchParams(await readBody(request));
  const code = params.get("code") ?? "";
  const grant = codes.get(code);
  // El código vale una sola vez, salga bien o mal (RFC 6749, 4.1.2).
  codes.delete(code);
  const verifier = params.get("code_verifier") ?? "";
  const isValid =
    grant !== undefined &&
    grant.expiresAt > Date.now() &&
    params.get("grant_type") === "authorization_code" &&
    params.get("redirect_uri") === grant.redirectUri &&
    params.get("client_id") === grant.clientId &&
    Boolean(params.get("client_secret")) &&
    PKCE_VALUE.test(verifier) &&
    s256(verifier) === grant.challenge;
  if (!isValid) return sendJson(response, 400, { error: "invalid_grant" });

  const accessToken = randomValue();
  tokens.set(accessToken, grant.student);
  return sendJson(response, 200, { access_token: accessToken, token_type: "Bearer", expires_in: 3600 });
}

function userinfo(request, response) {
  const [scheme, value] = (request.headers.authorization ?? "").split(" ");
  const student = scheme === "Bearer" ? tokens.get(value) : undefined;
  if (!student) return sendJson(response, 401, { error: "invalid_token" });
  return sendJson(response, 200, studentFor(student));
}

async function handle(request, response) {
  const url = new URL(request.url ?? "/", `http://localhost:${PORT}`);
  const route = `${request.method} ${url.pathname}`;
  try {
    if (route === "GET /health") return send(response, 200, "ok");
    if (route === "GET /authorize") return authorize(url, request, response);
    if (route === "POST /token") return await token(request, response);
    if (route === "GET /userinfo") return userinfo(request, response);
    return send(response, 404, "no existe");
  } catch {
    if (!response.headersSent) send(response, 400, "pedido inválido");
  }
}

// Las dos direcciones de esta máquina: `localhost` puede ser una u otra según el sistema.
for (const host of ["127.0.0.1", "::1"]) {
  const server = createServer((request, response) => void handle(request, response));
  server.on("error", (error) => {
    // Sin IPv6 en la máquina, alcanza con IPv4.
    if (host === "::1" && error.code === "EADDRNOTAVAIL") return;
    console.error(`Servidor OAuth falso: no pudo escuchar en ${host}:${PORT} (${error.code ?? error.name}).`);
    process.exit(1);
  });
  server.listen(PORT, host);
}
