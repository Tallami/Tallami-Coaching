// `POST /api/interest`: el sitio público avisa que alguien tocó un botón de
// reserva. La ruta (`src/app/api/interest/route.ts`) solo llama a esta función;
// vive acá para probarla con una base en memoria y un reloj propio.
//
// Contrato:
//   204  guardado; también "aceptado y descartado" (ver abajo)
//   400  el cuerpo no es JSON o no es `{ item, locale }` con valores de las listas cerradas
//   413  cuerpo de más de `MAX_BODY_BYTES`
//   415  `Content-Type` que no es `application/json` (el aviso del sitio —el Blob del
//        beacon y el `fetch` de respaldo— siempre lo manda). Un POST entre sitios sin
//        CORS solo puede mandar texto plano, formulario o multipart: así no entra, y uno
//        con `application/json` necesita un permiso CORS que esta ruta nunca da
//   429  más de 30 eventos en el último minuto del mismo visitante (con `Retry-After: 60`)
//   500  fallo inesperado de la base (se registra en el servidor, sin datos del pedido)
// Todas las respuestas llevan `Cache-Control: no-store` y un cuerpo fijo: nunca
// se repite nada de lo que mandó el visitante. Otros métodos los rechaza Next con 405.
//
// Se acepta y se descarta (204 sin guardar) cuando:
//   - el `user-agent` es de un bot o falta (`isBotUserAgent`): no se le dice
//     nada, ni siquiera si su cuerpo era válido;
//   - el sitio entero ya guardó `INTEREST_GLOBAL_MAX_PER_WINDOW` clics en el último
//     minuto: es el tope contra quien rota IPs, y en silencio para no enseñarle nada;
//   - falta `ADMIN_SESSION_SECRET`: sin él no se puede calcular el hash de la IP
//     y la IP en claro nunca se guarda; el panel avisa la falta en `/admin/setup`;
//   - la base no está configurada (`DbNotConfiguredError`, por ejemplo en Vercel
//     sin `DATABASE_URL`).
// En esos casos el sitio público sigue igual: el aviso es un beacon que nadie espera.
//
// Quién es "el mismo visitante" y cómo se guarda (IPv6 por /64, IPv4 mapeada como
// IPv4, hash con la fecha de Argentina) está en `ip-key.ts`; cuánto se guarda
// (400 días), en `retention.ts`.

import { getSessionSecret } from "@/admin/auth/config";
import { getClientIp } from "@/admin/auth/request";
import { todayInArgentina } from "@/admin/dates";
import { DbNotConfiguredError, type Db } from "@/db/client";
import { isBotUserAgent } from "./bots";
import { interestIpHash } from "./ip-key";
import { parseInterestPayload, readCountry } from "./payload";
import { recordInterest } from "./record";

/** El cuerpo real mide unos 40 bytes; 1 KB sobra y corta cualquier abuso. */
export const MAX_BODY_BYTES = 1024;
const RETRY_AFTER_SECONDS = "60";

export interface InterestDeps {
  getDb: () => Promise<Db>;
  now?: () => Date;
}

const HEADERS = { "Cache-Control": "no-store" } as const;
const JSON_MEDIA_TYPE = "application/json";

/** ¿El `Content-Type` es `application/json` (con o sin parámetros como `charset`, sin distinguir mayúsculas)? */
function isJsonContentType(header: string | null): boolean {
  return header?.split(";")[0].trim().toLowerCase() === JSON_MEDIA_TYPE;
}

function empty(status: number, extra: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...HEADERS, ...extra } });
}

/** Un error con cuerpo fijo: el código dice qué pasó, nunca el valor que llegó. */
function failure(status: number, code: string, extra: Record<string, string> = {}): Response {
  return Response.json({ error: code }, { status, headers: { ...HEADERS, ...extra } });
}

/**
 * Lee el cuerpo como texto sin pasarse de `maxBytes`. Devuelve `null` si lo
 * supera, ya sea porque lo declara `content-length` o porque llega más de lo
 * que dijo (cuerpo en partes): en ese caso corta la lectura.
 */
async function readLimitedText(request: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

/** Atiende un `POST /api/interest`. */
export async function handleInterestRequest(request: Request, deps: InterestDeps): Promise<Response> {
  if (isBotUserAgent(request.headers.get("user-agent"))) return empty(204);
  if (!isJsonContentType(request.headers.get("content-type"))) return failure(415, "unsupported_media_type");

  const text = await readLimitedText(request, MAX_BODY_BYTES);
  if (text === null) return failure(413, "payload_too_large");
  const payload = parseInterestPayload(text);
  if (!payload) return failure(400, "invalid_request");

  // Sin secreto no hay hash de IP, y la IP en claro no se guarda: se descarta.
  if (!getSessionSecret()) return empty(204);

  const now = deps.now?.() ?? new Date();
  try {
    const db = await deps.getDb();
    const result = await recordInterest(
      db,
      {
        ...payload,
        country: readCountry(request.headers),
        ipHash: interestIpHash(getClientIp(request.headers), todayInArgentina(now)),
      },
      now,
    );
    // `dropped` (tope global) es un 204 como cualquier otro: no se le cuenta nada a quien insiste.
    return result === "rate-limited"
      ? failure(429, "rate_limited", { "Retry-After": RETRY_AFTER_SECONDS })
      : empty(204);
  } catch (error) {
    if (error instanceof DbNotConfiguredError) return empty(204);
    // Solo el tipo de error: el mensaje puede traer la dirección de la base.
    console.error("[interest] no se pudo guardar un clic:", error instanceof Error ? error.name : "error");
    return failure(500, "unavailable");
  }
}
