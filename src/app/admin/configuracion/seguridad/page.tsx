import type { Metadata } from "next";
import Link from "next/link";
import { listPasskeys } from "@/admin/auth/passkeys";
import { getAdminSession, requireAdmin } from "@/admin/auth/require-admin";
import { listActiveSessions } from "@/admin/auth/sessions";
import { getWebAuthnConfig } from "@/admin/auth/webauthn-config";
import { ADMIN_ROUTES } from "@/admin/routes";
import { SecurityView } from "@/admin/security/security-view";
import { PageHeader } from "@/admin/ui/page-header";
import { PanelShell } from "@/app/admin/panel-shell";
import { Button } from "@/components/ui/button";
import { getDb } from "@/db/client";

export const metadata: Metadata = { title: "Seguridad" };

/** Configuración → Seguridad: las llaves de acceso, el código para otro dispositivo y las sesiones abiertas. */
export default async function SecurityPage() {
  await requireAdmin();
  const session = await getAdminSession();
  const db = await getDb();
  const [passkeys, sessions] = await Promise.all([listPasskeys(db), listActiveSessions(db)]);

  return (
    <PanelShell active="settings">
      <PageHeader
        title="Seguridad"
        description="Cómo se entra al panel: tus llaves de acceso, los dispositivos y las sesiones abiertas."
        actions={
          <Button asChild variant="ink-outline" size="sm">
            <Link href={ADMIN_ROUTES.settings} prefetch={false}>
              Volver a Configuración
            </Link>
          </Button>
        }
      />
      <SecurityView
        passkeys={passkeys}
        sessions={sessions}
        currentSessionId={session.id}
        // El nombre que propone el navegador de este dispositivo ("Chrome en Windows") es el de la sesión.
        defaultKeyName={session.device}
        origin={getWebAuthnConfig().origin}
      />
    </PanelShell>
  );
}
