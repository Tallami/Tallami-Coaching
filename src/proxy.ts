import type { NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { guardAdmin, isAdminPath } from "./admin/auth/guard";
import { routing } from "./i18n/routing";

const handleI18nRouting = createMiddleware(routing);

/**
 * Dos mundos en un solo `proxy`:
 * - `/admin…` (el panel, solo en español) NO pasa por next-intl: no se le
 *   agrega prefijo de idioma, y entra solo con sesión (`guardAdmin`);
 * - todo lo demás es el sitio público y lo resuelve next-intl como siempre.
 */
export default async function proxy(request: NextRequest) {
  if (isAdminPath(request.nextUrl.pathname)) {
    return guardAdmin(request);
  }
  return handleI18nRouting(request);
}

export const config = {
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};
