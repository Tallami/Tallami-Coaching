import type { NextRequest } from "next/server";
import { handleSignInStart } from "@/portal/oauth/endpoints";

/**
 * Empieza el ingreso de un alumno con Discord, Google o el proveedor de prueba: deja la
 * cookie del ingreso y manda al proveedor. El contrato completo está en
 * `src/portal/oauth/endpoints.ts`.
 */
export async function GET(request: NextRequest, context: RouteContext<"/api/portal/auth/[provider]">) {
  const { provider } = await context.params;
  return handleSignInStart(request, provider);
}
