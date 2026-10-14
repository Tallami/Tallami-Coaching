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
  matcher: [
    // El sitio público: todo menos `/api`, `/_next`, `/_vercel` y los archivos
    // (cualquier ruta con un punto, como `/robots.txt`).
    "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
    // El panel va aparte y completo, también con puntos (`/admin/ventas.csv`,
    // `/admin/clientes/ana.perez`) y en sus formas de transporte (`/admin.rsc`,
    // `/admin/…segment.rsc`: Next las suma a cada entrada). Sin esto, un
    // archivo del panel quedaría sin sesión, sin `no-store` y sin `noindex`.
    // `:path*` incluye `/admin` solo.
    "/admin/:path*",
  ],
};
