import type { Metadata } from "next";
import { requireAdmin } from "@/admin/auth/require-admin";
import { SubmitButton } from "@/components/admin/submit-button";
import { logoutAction } from "./actions";

export const metadata: Metadata = { title: "Panel" };

/** Provisoria: la Tarea 7 la reemplaza por el resumen del negocio. */
export default async function AdminHomePage() {
  await requireAdmin();

  return (
    <main className="mx-auto flex min-h-dvh max-w-wrap flex-col items-start gap-6 px-gutter py-16">
      <h1 className="text-4xl font-extrabold">Panel</h1>
      <p className="text-ink-2">Ingresaste con tu contraseña.</p>
      <form action={logoutAction}>
        <SubmitButton variant="ink-outline" pendingLabel="Saliendo…">
          Salir
        </SubmitButton>
      </form>
    </main>
  );
}
