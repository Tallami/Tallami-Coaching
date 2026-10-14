import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/admin/auth/require-admin";
import { AdminShell } from "@/admin/ui/admin-shell";
import { PageHeader } from "@/admin/ui/page-header";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Panel" };

/** Provisoria: la Tarea 7 la reemplaza por el resumen del negocio. */
export default async function AdminHomePage() {
  await requireAdmin();

  return (
    <AdminShell active="overview">
      <PageHeader title="Panel" />
      <p className="text-ink-2">Ingresaste con tu contraseña.</p>
      <div className="mt-6">
        <Button asChild>
          <Link href="/admin/ventas/nueva">Cargar una venta</Link>
        </Button>
      </div>
    </AdminShell>
  );
}
