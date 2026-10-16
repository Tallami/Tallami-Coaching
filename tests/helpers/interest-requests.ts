// Pedidos de prueba a `/api/interest`, como los manda el sitio: JSON chico, con
// la IP que pone Vercel. Los usan los tests unitarios del endpoint.

export const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

export interface ClickOptions {
  ip?: string | null;
  userAgent?: string | null;
  country?: string;
  /** Texto del cuerpo tal cual; si falta se manda `body` como JSON. */
  raw?: string;
  method?: string;
  /** `content-type` del pedido: JSON por defecto, `null` para no mandar ninguno. */
  contentType?: string | null;
}

export function click(body: unknown = { item: "lesson", locale: "es" }, options: ClickOptions = {}): Request {
  const {
    ip = "203.0.113.9",
    userAgent = CHROME,
    country,
    raw,
    method = "POST",
    contentType = "application/json",
  } = options;
  const headers = new Headers();
  if (contentType !== null) headers.set("content-type", contentType);
  if (ip !== null) headers.set("x-forwarded-for", ip);
  if (userAgent !== null) headers.set("user-agent", userAgent);
  if (country !== undefined) headers.set("x-vercel-ip-country", country);
  return new Request("http://localhost/api/interest", {
    method,
    headers,
    body: method === "GET" ? undefined : (raw ?? JSON.stringify(body)),
  });
}
