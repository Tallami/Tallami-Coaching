import type { NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { handleLogout } from "@/portal/oauth/endpoints";

/**
 * "Salir" del portal: cierra la sesión del alumno. Solo `POST`: Next contesta 405 a
 * cualquier otro método, así un link o una imagen de otro sitio no cierran nada. El
 * contrato completo está en `src/portal/oauth/endpoints.ts`.
 */
export async function POST(request: NextRequest) {
  return handleLogout(request, { getDb });
}
