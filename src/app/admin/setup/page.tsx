import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getMissingConfig } from "@/admin/auth/config";
import { LOGIN_PATH } from "@/admin/auth/redirect";
import { SetupChecklist } from "@/components/admin/setup-checklist";

export const metadata: Metadata = { title: "Falta configurar" };

/**
 * Página pública (hace falta justo cuando todavía no se puede entrar): dice qué
 * variables de entorno faltan, por nombre, y nunca muestra valores. Cuando no
 * falta nada manda al login, así no queda como una página fantasma.
 */
export default async function SetupPage() {
  // Lee variables de entorno: tiene que mirarse en cada pedido, no al hacer el build.
  await connection();

  const missing = getMissingConfig();
  if (missing.length === 0) redirect(LOGIN_PATH);

  return <SetupChecklist items={missing} />;
}
