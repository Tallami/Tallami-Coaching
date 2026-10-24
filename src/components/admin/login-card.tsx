import Link from "next/link";
import type { ReactNode } from "react";
import { PANEL_PATH } from "@/admin/auth/redirect";
import { Monogram } from "@/admin/ui/monogram";
import { buttonVariants } from "@/components/ui/button";

interface LoginCardProps {
  /** La línea bajo el título: en qué paso del ingreso se está. */
  subtitle: string;
  children: ReactNode;
}

/** La tarjeta de las pantallas del ingreso (contraseña, llave, primera llave), sobre el azul escenario. */
export function LoginCard({ subtitle, children }: LoginCardProps) {
  return (
    <main className="stage grid min-h-dvh place-items-center px-gutter py-12">
      <div className="on-paper w-full max-w-sm border-t-[6px] border-gold bg-paper p-8 text-ink">
        <Monogram />
        <h1 className="mt-5 text-3xl font-extrabold leading-tight">Panel de Tallami</h1>
        <p className="mt-1 text-ink-2">{subtitle}</p>
        {children}
      </div>
    </main>
  );
}

/**
 * Un paso del ingreso pedido con la sesión ya abierta: después de entrar (la
 * página se vuelve a dibujar mientras el navegador va al panel) o al volver
 * "atrás". No hay nada más que hacer acá.
 */
export function LoginDoneCard() {
  return (
    <LoginCard subtitle="Ya entraste.">
      <Link href={PANEL_PATH} className={buttonVariants({ className: "mt-8 w-full" })}>
        Ir al panel
      </Link>
    </LoginCard>
  );
}
