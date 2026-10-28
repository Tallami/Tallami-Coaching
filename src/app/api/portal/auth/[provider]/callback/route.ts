import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { handleCallback } from "@/portal/oauth/endpoints";

/**
 * La vuelta del proveedor después de que el alumno autoriza (o cancela): abre la sesión
 * y vuelve al portal, o vuelve con el aviso de que no se pudo. El contrato completo
 * está en `src/portal/oauth/endpoints.ts`.
 */
export async function GET(request: NextRequest, context: RouteContext<"/api/portal/auth/[provider]/callback">) {
  const { provider } = await context.params;
  return handleCallback(request, provider, { getDb });
}
