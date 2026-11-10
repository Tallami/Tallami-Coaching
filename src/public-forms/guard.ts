// Lo que comparten los formularios públicos del sitio (aplicación a la Temporada Pro y, más
// adelante, los pedidos del sitio): una trampa para bots y un límite por conexión y por sitio. En los
// pedidos del sitio el tope del sitio se cuenta por tipo: una ola de contactos no puede dejar sin
// botón de arrepentimiento ni de baja. El de la conexión los cuenta juntos.
// Como en `/api/interest`, de la conexión solo se guarda un HMAC con el día de Argentina, nunca la IP.
//
// El cupo se mira antes de guardar: dos pedidos a la vez pueden pasarse por uno, que en un
// formulario de uso humano no importa.

import { and, count, eq, gt } from "drizzle-orm";
import { todayInArgentina } from "@/admin/dates";
import { getClientIp } from "@/admin/auth/request";
import { interestIpHash } from "@/admin/interest/ip-key";
import type { Db } from "@/db/client";
import { proApplications, siteRequests } from "@/db/schema";
import type { SiteRequestKind } from "@/payments/policy";

/** Envíos que acepta una misma conexión por hora. */
export const PUBLIC_FORM_MAX_PER_HOUR = 5;
/** Envíos que acepta el sitio entero por hora, en cada formulario (en los pedidos del sitio, de cada tipo). */
export const PUBLIC_FORM_GLOBAL_MAX_PER_HOUR = 100;
const HOUR_MS = 60 * 60 * 1000;
/** El campo que un humano no ve y un bot llena. */
export const HONEYPOT_FIELD = "website";

const TABLES = { proApplications, siteRequests } as const;

/** Qué formulario se mira: las aplicaciones, o un tipo de pedido del sitio. */
export type PublicFormScope = { table: "proApplications" } | { table: "siteRequests"; kind: SiteRequestKind };

/** Lo que cuenta para el tope del sitio: en los pedidos del sitio, solo los de ese tipo. */
function siteWideFilter(scope: PublicFormScope) {
  return scope.table === "siteRequests" ? eq(siteRequests.kind, scope.kind) : undefined;
}

/** El hash de la conexión del pedido, o `null` si no se puede calcular (falta `ADMIN_SESSION_SECRET`). */
export function publicFormIpHash(headers: Headers, now: Date): string | null {
  try {
    return interestIpHash(getClientIp(headers), todayInArgentina(now));
  } catch {
    return null;
  }
}

/** ¿Pasó algún tope en la última hora? Sin hash de conexión solo vale el del sitio. */
export async function isOverPublicFormLimit(
  db: Db,
  scope: PublicFormScope,
  ipHash: string | null,
  now: Date,
): Promise<boolean> {
  const { table } = scope;
  const { ipHash: ipColumn, createdAt } = TABLES[table];
  const since = gt(createdAt, new Date(now.getTime() - HOUR_MS));
  const [site] = await db.select({ total: count() }).from(TABLES[table]).where(and(since, siteWideFilter(scope)));
  if ((site?.total ?? 0) >= PUBLIC_FORM_GLOBAL_MAX_PER_HOUR) return true;
  if (ipHash === null) return false;
  const [visitor] = await db
    .select({ total: count() })
    .from(TABLES[table])
    .where(and(since, eq(ipColumn, ipHash)));
  return (visitor?.total ?? 0) >= PUBLIC_FORM_MAX_PER_HOUR;
}

/** ¿Llenaron el campo trampa? Un campo vacío o con solo espacios es de una persona. */
export function isHoneypotFilled(formData: FormData): boolean {
  const value = formData.get(HONEYPOT_FIELD);
  return typeof value === "string" && value.trim() !== "";
}
